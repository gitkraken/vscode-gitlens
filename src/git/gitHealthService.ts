import type { ConfigurationChangeEvent, Disposable, Event } from 'vscode';
import { EventEmitter } from 'vscode';
import type {
	GitHealthDurationBucket,
	GitHealthLever,
	GitHealthReport,
	GitHealthSlowness,
	GitOptimizationTier,
} from '@gitlens/git/gitHealth.js';
import {
	computeHealthReport,
	computeLevers,
	getAutoMaintenanceTasks,
	getAutoOptimizations,
} from '@gitlens/git/gitHealth.js';
import type { RepositoryChangeEvent } from '@gitlens/git/models/repositoryChangeEvent.js';
import type { GitHealthDetails, GitMaintenanceTask, GitOptimizationId } from '@gitlens/git/providers/maintenance.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../container.js';
import { configuration } from '../system/-webview/configuration.js';
import type { GlRepository } from './models/repository.js';

/** The auto-tier maintenance pass runs at most once per this window per repo (via `gk.maintenanceLastRun`). */
const dailyPassIntervalMs = 24 * 60 * 60 * 1000;
/** Debounce for persisting the passive-slowness summary to workspace storage. */
const persistSlownessDebounceMs = 5000;
/** Debounce for change-driven re-probes so a burst of index events collapses to one probe. */
const probeDebounceMs = 2000;
/**
 * Git subcommands GitLens itself issues for background maintenance (the auto-tier pass + the demand-cadence
 * commit-graph write). These are legitimately slow and don't block the user, so they must NOT count as passive
 * "slowness" — else our own optimization work would justify suggesting more of it.
 *
 * Name matching is a BACKSTOP only. The primary mechanism is the exec layer's `selfMaintenance` run option,
 * which the maintenance provider sets explicitly: a subcommand name can't tell our work from the user's,
 * since the same `update-index`/`status` also serve real staging and status calls.
 */
const selfMaintenanceOperations = new Set(['maintenance', 'commit-graph', 'repack', 'gc', 'prune', 'pack-refs']);
/** Slowness entries idle longer than this are dropped at hydrate time so removed repos don't accrue forever. */
const slownessMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

/** Coarsens a maintenance duration into a telemetry-friendly bucket. */
function bucketDuration(ms: number): GitHealthDurationBucket {
	if (ms < 1000) return '<1s';
	if (ms < 5000) return '1-5s';
	if (ms < 15000) return '5-15s';
	if (ms < 60000) return '15-60s';
	return '>60s';
}

/**
 * Host-side orchestrator for the Git Health feature. Runs the cheap per-session shape probe, accumulates
 * passive slowness (via the exec-layer `onSlowCommand` hook), runs the once-a-day auto-tier maintenance
 * pass, and exposes report/apply/revert entry points for the Git Health view (Phase 2).
 *
 * In-memory state is keyed by repo path; the auto-pass timestamp lives in the shared `.git/gk/config`
 * (`gk.maintenanceLastRun`), so worktrees of the same repo naturally throttle each other's daily pass.
 * Everything is gated on `gitlens.gitOptimizations.enabled` and on the per-repo maintenance capability
 * (`repo.git.maintenance != null`), which is absent on web builds and virtual repos.
 */
export class GitHealthService implements Disposable {
	private readonly _disposables: Disposable[] = [];
	private readonly _onDidChange = new EventEmitter<string>();
	get onDidChange(): Event<string> {
		return this._onDidChange.event;
	}

	// Latest computed report per repo path (a key's presence also marks the repo as probed this session).
	private readonly _reports = new Map<string, GitHealthReport>();
	// Per-lever view rows, computed at probe time from the same snapshot + capabilities the report used —
	// so the view can never disagree with the report about what's enabled or who enabled it.
	private readonly _levers = new Map<string, GitHealthLever[]>();
	// Passive-slowness accumulator per repo path (hydrated lazily from workspace storage).
	private _slowness: Map<string, GitHealthSlowness> | undefined;
	// Common-git-dir paths with an in-flight auto pass (per-common-path serialization).
	private readonly _runningPasses = new Set<string>();
	// In-memory last-pass times — the session-local throttle backstop when the gk-config stamp can't persist.
	private readonly _lastPassAt = new Map<string, number>();
	// In-flight probes per repo path so concurrent callers share one probe.
	private readonly _inflightProbes = new Map<string, Promise<GitHealthReport | undefined>>();
	// Last-sent `gitHealth/probe` payload per repo path (dedupes the frequent re-probe events).
	private readonly _lastProbeTelemetry = new Map<string, string>();
	private readonly _probeTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private _disposed = false;
	// Aborts an IN-FLIGHT auto-tier pass on dispose. `queueAutoPass` already re-checks `_disposed` at
	// dequeue time, so a pass still queued behind another repo's simply never starts — this covers the
	// other half: a pass already past that check and running a (possibly minutes-long) maintenance task
	// or config-lever apply when dispose() runs, which would otherwise keep spawning git and mutating the
	// user's config after the extension was told to shut down.
	private readonly _disposeAbort = new AbortController();
	private readonly _persistSlownessDebounced: Deferrable<() => void>;

	constructor(private readonly container: Container) {
		this._persistSlownessDebounced = debounce(() => void this.persistSlowness(), persistSlownessDebounceMs);
		this._disposables.push(
			this._onDidChange,
			container.git.onDidChangeRepositories(e => {
				void this.probeSequentially(e.added);
				for (const repo of e.removed) {
					this.evict(repo);
				}
			}),
			container.git.onDidChangeRepository(e => this.onRepositoryChanged(e)),
			configuration.onDidChange(e => this.onConfigurationChanged(e), this),
		);

		// Probe repos already open at construction time.
		void this.probeSequentially(container.git.openRepositories);
	}

	/** Probes one repo at a time — the fs fan-out bypasses the GitQueue, so N-at-once would burst syscalls. */
	private async probeSequentially(repos: readonly GlRepository[]): Promise<void> {
		for (const repo of repos) {
			await this.probeAndMaybeRun(repo);
		}
	}

	dispose(): void {
		// Stops any auto pass still queued behind an in-flight one from starting after teardown, and
		// signals a pass already running (the git commands it's mid-`await` on) to cancel.
		this._disposed = true;
		this._disposeAbort.abort();
		for (const timer of this._probeTimers.values()) {
			clearTimeout(timer);
		}
		this._probeTimers.clear();
		// Best-effort flush of a pending write — deactivate-time persistence isn't guaranteed.
		this._persistSlownessDebounced.flush();
		this._persistSlownessDebounced.cancel();
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
	}

	/**
	 * Records a slow git command against its repo. Called from the exec-layer `onSlowCommand` hook, so it
	 * MUST stay synchronous and resolve the repo via the in-memory registry only — never invoke git (that
	 * would recurse through the exec layer that just fired this hook).
	 */
	recordSlowCommand(cwd: string | undefined, duration: number, operation: string | undefined): void {
		if (cwd == null || cwd.length === 0) return;
		if (!configuration.get('gitOptimizations.enabled')) return;
		// Don't let GitLens's own background maintenance/commit-graph writes register as user slowness.
		if (operation != null && selfMaintenanceOperations.has(operation)) return;

		const repo = this.container.git.getRepository(cwd);
		if (repo == null) return;

		const slowness = this.getSlowness();
		const prev = slowness.get(repo.path);
		slowness.set(repo.path, {
			count: (prev?.count ?? 0) + 1,
			lastAt: Date.now(),
			maxDurationMs: Math.max(prev?.maxDurationMs ?? 0, Math.round(duration)),
		});
		this._persistSlownessDebounced();

		// A cached report is computed from the slowness known at probe time, so newly observed slowness
		// would otherwise not reach the UI until an unrelated repo change or the next session. Re-probe
		// only on the FIRST slow command: `computeHealthReport` gates on `count > 0`, so that's the one
		// transition that can change a recommendation — and re-probing per slow command would itself run
		// git, re-arming this hook.
		if (prev == null) {
			this.scheduleProbe(repo);
		}
	}

	/** Returns the current report for a repo, probing on first request. */
	async getReport(repoPath: string): Promise<GitHealthReport | undefined> {
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return undefined;

		if (!this._reports.has(repo.path)) {
			await this.probeAndMaybeRun(repo);
		}
		return this._reports.get(repo.path);
	}

	/** Per-lever rows for the Git Health view, probing on first request like {@link getReport}. */
	async getLevers(repoPath: string): Promise<GitHealthLever[]> {
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return [];

		if (!this._levers.has(repo.path)) {
			await this.probeAndMaybeRun(repo);
		}
		return this._levers.get(repo.path) ?? [];
	}

	/** On-demand commit count + `count-objects` breakdown for the Git Health view. */
	async getDetails(repoPath: string, cancellation?: AbortSignal): Promise<GitHealthDetails> {
		const maintenance = this.getMaintenance(repoPath);
		if (maintenance == null) return { commitCount: undefined, countObjects: undefined };

		return maintenance.getHealthDetails(cancellation);
	}

	/**
	 * Applies an optimization lever, then re-probes. Returns whether it took effect. This is the ask-tier
	 * (user-clicked) path, so a genuine failure PROPAGATES to the caller (the view surfaces it); the re-probe
	 * runs in a `finally` so the view's state stays fresh even when the apply threw.
	 */
	async applyFix(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<boolean> {
		const resolved = this.resolveMaintenance(repoPath);
		if (resolved == null) return false;

		try {
			return await this.applyOptimizationWithTelemetry(repoPath, id, 'ask', cancellation);
		} finally {
			await this.reprobe(resolved.repo);
		}
	}

	/** Reverts an optimization lever, then re-probes. Propagates failures (ask-tier); re-probes in a `finally`. */
	async revertFix(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<void> {
		const resolved = this.resolveMaintenance(repoPath);
		if (resolved == null) return;

		try {
			await resolved.maintenance.revertOptimization(id, cancellation);
		} finally {
			await this.reprobe(resolved.repo);
		}
	}

	/**
	 * Enables or disables GitLens's automatic commit-graph maintenance for this repo, then re-probes. Ask-tier
	 * (user-clicked): a genuine write failure PROPAGATES; the re-probe runs in a `finally` so the view's state
	 * stays fresh even when the toggle threw.
	 */
	async setCommitGraphEnabled(repoPath: string, enabled: boolean, cancellation?: AbortSignal): Promise<void> {
		const resolved = this.resolveMaintenance(repoPath);
		if (resolved == null) return;

		try {
			await resolved.maintenance.setCommitGraphDisabled(!enabled, cancellation);
			this.container.telemetry.sendEvent('gitOptimizations/commitGraph/toggled', { enabled: enabled });
		} finally {
			await this.reprobe(resolved.repo);
		}
	}

	/**
	 * Runs all maintenance tasks now (the "Run Maintenance Now" action), then re-probes. Returns per-task
	 * results (`ran` is false for a task the installed git can't run). Ask-tier: a genuine task failure
	 * propagates the git error to the view; the re-probe still runs in a `finally`.
	 */
	async runMaintenanceNow(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<{ task: GitMaintenanceTask; ran: boolean }[]> {
		const resolved = this.resolveMaintenance(repoPath);
		if (resolved == null) return [];

		const tasks: GitMaintenanceTask[] = ['commit-graph', 'loose-objects', 'incremental-repack'];

		// Join the SAME single-flight the auto pass uses. This is now reachable from a button, and opening
		// the Health view is itself what queues a pass — so without this a click lands straight on top of
		// it, and concurrent `git maintenance run` invocations collide on git's per-repo lock (the losers
		// no-op at exit 0 while telemetry counts them as runs). Report `ran: false` rather than pretending.
		const commonPath = await this.resolveCommonPath(resolved.repo);
		if (this._runningPasses.has(commonPath)) {
			return tasks.map(task => ({ task: task, ran: false }));
		}

		this._runningPasses.add(commonPath);

		const results: { task: GitMaintenanceTask; ran: boolean }[] = [];
		try {
			// Sequential for the same reason: they contend on that one lock.
			for (const task of tasks) {
				results.push({ task: task, ran: await this.runTaskWithTelemetry(repoPath, task, cancellation) });
			}
		} finally {
			this._runningPasses.delete(commonPath);
			await this.reprobe(resolved.repo);
		}
		return results;
	}

	/** Probes AFTER any in-flight probe settles — a post-mutation refresh must not ride a pre-mutation probe. */
	private async reprobe(repo: GlRepository): Promise<GitHealthReport | undefined> {
		await this._inflightProbes.get(repo.path);
		return this.probe(repo);
	}

	private getMaintenance(repoPath: string): GlRepository['git']['maintenance'] {
		return this.resolveMaintenance(repoPath)?.maintenance;
	}

	private resolveMaintenance(
		repoPath: string,
	): { repo: GlRepository; maintenance: NonNullable<GlRepository['git']['maintenance']> } | undefined {
		const repo = this.container.git.getRepository(repoPath);
		const maintenance = repo?.git.maintenance;
		if (repo == null || maintenance == null) return undefined;

		return { repo: repo, maintenance: maintenance };
	}

	/**
	 * Reacts to `gitlens.gitOptimizations.enabled` changing mid-session. Point-in-time gates elsewhere (the
	 * probe, the auto pass, the slow-command hook) only re-check the setting on their own next trigger, so
	 * without this: turning it ON does nothing until an unrelated repo event; turning it OFF leaves the last
	 * report/levers served as if nothing changed.
	 */
	private onConfigurationChanged(e: ConfigurationChangeEvent): void {
		if (!configuration.changed(e, 'gitOptimizations.enabled')) return;

		if (configuration.get('gitOptimizations.enabled')) {
			// Same startup path as construction-time: probe every currently open repo, which also queues the
			// auto pass for each.
			void this.probeSequentially(this.container.git.openRepositories);
			return;
		}

		this._reports.clear();
		this._levers.clear();
		for (const repo of this.container.git.openRepositories) {
			this._onDidChange.fire(repo.path);
		}
	}

	private onRepositoryChanged(e: RepositoryChangeEvent): void {
		// Re-probe only on changes that can alter object-store / working-tree shape. Crucially, a coarse
		// `gkConfig` change (which our own `gk.maintenanceLastRun` write echoes back as) is NOT in this set,
		// so a maintenance-timestamp write can never re-trigger the daily pass.
		if (!e.changed('heads', 'index', 'remotes')) return;

		const repo = this.container.git.getRepository(e.repository.path);
		if (repo == null) return;

		this.scheduleProbe(repo);
	}

	private scheduleProbe(repo: GlRepository): void {
		const existing = this._probeTimers.get(repo.path);
		if (existing != null) {
			clearTimeout(existing);
		}
		this._probeTimers.set(
			repo.path,
			setTimeout(() => {
				this._probeTimers.delete(repo.path);
				void this.probeAndMaybeRun(repo);
			}, probeDebounceMs),
		);
	}

	private async probeAndMaybeRun(repo: GlRepository): Promise<void> {
		const report = await this.probe(repo);
		if (report == null) return;

		// Fire-and-forget: the daily pass can spend minutes in `incremental-repack`, and neither the view's
		// `getReport` nor the startup probe chain may block on it. It re-probes and fires `onDidChange` when
		// it finishes, so the report still refreshes once the work lands.
		this.queueAutoPass(repo);
	}

	// Auto passes run one at a time across ALL repos: detaching them from the (sequential) probe chain
	// would otherwise let every open repo start repacking at once on startup. Nothing awaits this chain.
	private _autoPassQueue: Promise<void> = Promise.resolve();

	private queueAutoPass(repo: GlRepository): void {
		this._autoPassQueue = this._autoPassQueue
			.then(async () => {
				// Everything is revalidated on DEQUEUE, never captured at enqueue: this may have waited
				// behind other repos' passes, and in that window the user can have disabled the feature,
				// closed the repo, or set one of the levers themselves. Acting on enqueue-time state would
				// silently apply an optimization they had just opted out of.
				if (this._disposed || this._disposeAbort.signal.aborted) return;
				if (!configuration.get('gitOptimizations.enabled')) return;
				if (this.container.git.getRepository(repo.path) == null) return;

				// Re-PROBE rather than reading the cached report: a config-only change doesn't schedule a
				// re-probe (`onRepositoryChanged` filters to heads/index/remotes), so a lever the user set
				// during the wait would be invisible in the cached report and silently overridden here.
				const report = await this.probe(repo);
				if (report == null) return;

				await this.runAutoPassIfDue(repo, report);
			})
			.catch((ex: unknown) => Logger.error(ex, 'GitHealthService.queueAutoPass'));
	}

	private async probe(repo: GlRepository): Promise<GitHealthReport | undefined> {
		if (!configuration.get('gitOptimizations.enabled')) return undefined;

		const maintenance = repo.git.maintenance;
		if (maintenance == null) return undefined;

		// Concurrent same-repo callers ride the in-flight probe instead of duplicating the fs/git work.
		const inflight = this._inflightProbes.get(repo.path);
		if (inflight != null) return inflight;

		const promise = this.probeCore(repo, maintenance).finally(() => this._inflightProbes.delete(repo.path));
		this._inflightProbes.set(repo.path, promise);
		return promise;
	}

	private async probeCore(
		repo: GlRepository,
		maintenance: NonNullable<GlRepository['git']['maintenance']>,
	): Promise<GitHealthReport | undefined> {
		try {
			const [snapshotResult, capabilitiesResult] = await Promise.allSettled([
				maintenance.getHealthSnapshot(),
				maintenance.getCapabilities(),
			]);

			const snapshot = getSettledValue(snapshotResult);
			if (snapshot == null) return undefined;

			// The repo may have been removed (evicted) while the probe was in flight — don't resurrect it.
			if (this.container.git.getRepository(repo.path) == null) return undefined;

			const capabilities = getSettledValue(capabilitiesResult) ?? [];
			const slowness = this.getSlowness().get(repo.path);
			const report = computeHealthReport(snapshot, slowness, capabilities);

			this._reports.set(repo.path, report);
			this._levers.set(repo.path, computeLevers(snapshot, capabilities, report));
			const event = {
				'packs.count': snapshot.packCount,
				'packs.bytes': snapshot.packBytes,
				'estimate.looseObjects': report.estimatedLooseObjects,
				'estimate.trackedFiles': report.estimatedTrackedFiles,
				'estimate.trackedFilesExact': report.trackedFilesExact,
				'commitGraph.present': snapshot.commitGraph.present,
				multiPackIndex: snapshot.multiPackIndex,
				// Telemetry stays boolean — an unreadable registration coarsens to `false` here, but the report
				// itself (and the lever's `unavailable` status) still tracks the tri-state distinction.
				maintenanceRegistered: snapshot.maintenanceRegistered ?? false,
				clearlyLarge: report.clearlyLarge,
				'findings.total': report.findings.length,
				'findings.auto': report.findings.filter(f => f.tier === 'auto').length,
				'findings.ask': report.findings.filter(f => f.tier === 'ask').length,
				'slowness.count': slowness?.count ?? 0,
			};
			// Re-probes are frequent (debounced index changes, post-fix refreshes) — only report changes.
			const serialized = JSON.stringify(event);
			if (this._lastProbeTelemetry.get(repo.path) !== serialized) {
				this._lastProbeTelemetry.set(repo.path, serialized);
				this.container.telemetry.sendEvent('gitHealth/probe', event);
			}

			// Repo-open (and each re-probe) hints the commit-graph write so the cache stays warm across the
			// whole extension, not just the Commit Graph webview. Fire-and-forget — the maintenance service's
			// demand throttle decides whether anything runs.
			maintenance.request('commit-graph');

			this._onDidChange.fire(repo.path);

			return report;
		} catch (ex) {
			Logger.error(ex, 'GitHealthService.probe');
			return undefined;
		}
	}

	private async runAutoPassIfDue(repo: GlRepository, report: GitHealthReport): Promise<void> {
		const tasks = getAutoMaintenanceTasks(report);
		const optimizations = getAutoOptimizations(report);
		if (tasks.length === 0 && optimizations.length === 0) return;

		const maintenance = repo.git.maintenance;
		if (maintenance == null) return;

		// Resolve the common git dir so worktrees of the same repo serialize against one another. The gk
		// timestamp is already common-scoped (setGkConfig writes the shared `.git/gk/config`), so this
		// only adds same-session concurrency protection on top of that shared throttle.
		const commonPath = await this.resolveCommonPath(repo);
		// Claim synchronously with the check — an await in between would let two worktree siblings
		// both pass the guard and run concurrent passes.
		if (this._runningPasses.has(commonPath)) return;

		this._runningPasses.add(commonPath);

		try {
			// The persisted stamp is the cross-session/cross-window throttle; the in-memory time is the
			// backstop so a repo where the stamp write persistently fails can't re-run every probe.
			const lastPassAt = this._lastPassAt.get(commonPath);
			if (lastPassAt != null && Date.now() - lastPassAt < dailyPassIntervalMs) return;

			// Claim the day as ONE atomic operation in the provider. Reading the stamp here and writing it
			// separately would let two VS Code windows both observe an expired value and both run a pass —
			// the "once a day" guarantee (and its telemetry) has to hold across processes, not just within
			// one. The claim also stamps BEFORE the work, so a window probing during a minutes-long pass
			// sees it taken. The write echoes back as a coarse `gkConfig` repository change, which
			// `onRepositoryChanged` deliberately ignores so the pass can never re-trigger itself.
			const claimed = await maintenance.claimMaintenancePass(dailyPassIntervalMs).catch((ex: unknown) => {
				Logger.error(ex, 'GitHealthService.runAutoPassIfDue.claim');
				return false;
			});
			if (!claimed) return;

			this._lastPassAt.set(commonPath, Date.now());

			// Sequential on purpose: concurrent `git maintenance run` invocations collide on git's
			// per-repo maintenance lock, and git config writes are kept serialized by convention.
			// Auto tier: catch+log per-lever — the background pass must never break on one lever's failure.
			for (const task of tasks) {
				// Re-checked every iteration, not just after the loop: a task already running finishes, but
				// dispose/opt-out mid-loop must stop the next one from starting.
				if (this._disposed || this._disposeAbort.signal.aborted) return;
				if (!configuration.get('gitOptimizations.enabled')) return;

				try {
					await this.runTaskWithTelemetry(repo.path, task, this._disposeAbort.signal);
				} catch (ex) {
					Logger.error(ex, `GitHealthService.runAutoPassIfDue.task(${task})`);
				}
			}
			// Re-derive the levers from a FRESH probe rather than reusing the pre-task recommendation. The
			// tasks above can run for minutes on a large repo, and in that window the user can disable the
			// feature or set one of these keys themselves — applying the stale recommendation would silently
			// override a choice they just made. This is the auto tier's last chance to notice.
			if (this._disposed || !configuration.get('gitOptimizations.enabled')) return;

			const current = await this.probe(repo);
			if (current == null) return;

			for (const id of getAutoOptimizations(current)) {
				try {
					await this.applyOptimizationWithTelemetry(repo.path, id, 'auto', this._disposeAbort.signal);
				} catch (ex) {
					Logger.error(ex, `GitHealthService.runAutoPassIfDue.optimization(${id})`);
				}
			}

			// Re-probe so the report reflects the post-maintenance object store.
			await this.probe(repo);
		} finally {
			this._runningPasses.delete(commonPath);
		}
	}

	/**
	 * Applies a lever and reports it. The auto tier mutates a user's repo config with no prompt, so the
	 * thresholds driving it need the same telemetry the maintenance tasks already emit.
	 */
	private async applyOptimizationWithTelemetry(
		repoPath: string,
		id: GitOptimizationId,
		tier: GitOptimizationTier,
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const maintenance = this.getMaintenance(repoPath);
		if (maintenance == null) return false;

		const start = Date.now();
		const applied = await maintenance.applyOptimization(id, cancellation);
		// No event for a lever that turned out not to apply — the event means "we changed the repo".
		if (!applied) return false;

		const duration = Date.now() - start;
		this.container.telemetry.sendEvent('gitOptimizations/optimization/applied', {
			optimization: id,
			tier: tier,
			duration: duration,
			'duration.bucket': bucketDuration(duration),
		});
		return true;
	}

	/**
	 * Runs one maintenance task and, if it actually ran, reports telemetry. Returns whether it ran. A genuine
	 * task failure PROPAGATES (the ask-tier caller surfaces it; the auto-tier caller catches+logs).
	 */
	private async runTaskWithTelemetry(
		repoPath: string,
		task: GitMaintenanceTask,
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const maintenance = this.getMaintenance(repoPath);
		if (maintenance == null) return false;

		const start = Date.now();
		const ran = await maintenance.runMaintenanceTask(task, cancellation);
		// No event for unsupported (not-applicable) attempts — the event means "a maintenance task actually ran".
		if (!ran) return false;

		const duration = Date.now() - start;
		this.container.telemetry.sendEvent('gitOptimizations/maintenance/run', {
			task: task,
			duration: duration,
			'duration.bucket': bucketDuration(duration),
		});
		return true;
	}

	private async resolveCommonPath(repo: GlRepository): Promise<string> {
		try {
			const gitDir = await repo.git.config.getGitDir?.();
			return (gitDir?.commonUri ?? gitDir?.uri)?.fsPath ?? repo.path;
		} catch {
			return repo.path;
		}
	}

	private evict(repo: GlRepository): void {
		this._reports.delete(repo.path);
		this._levers.delete(repo.path);
		this._lastProbeTelemetry.delete(repo.path);
		this._inflightProbes.delete(repo.path);
		const timer = this._probeTimers.get(repo.path);
		if (timer != null) {
			clearTimeout(timer);
			this._probeTimers.delete(repo.path);
		}
	}

	private getSlowness(): Map<string, GitHealthSlowness> {
		if (this._slowness == null) {
			const stored = this.container.storage.getWorkspace('gitHealth:slowness') ?? {};
			// Age-prune at hydrate so entries for long-gone repos don't accumulate in workspace storage
			// forever (entries are deliberately kept across repo close/reopen within the window).
			const cutoff = Date.now() - slownessMaxAgeMs;
			this._slowness = new Map<string, GitHealthSlowness>(
				Object.entries(stored).filter(([, value]) => value.lastAt >= cutoff),
			);
		}
		return this._slowness;
	}

	private async persistSlowness(): Promise<void> {
		if (this._slowness == null) return;

		try {
			await this.container.storage.storeWorkspace('gitHealth:slowness', Object.fromEntries(this._slowness));
		} catch (ex) {
			Logger.error(ex, 'GitHealthService.persistSlowness');
		}
	}
}
