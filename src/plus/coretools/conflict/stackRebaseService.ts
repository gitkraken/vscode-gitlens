import type { Disposable, Event } from 'vscode';
import { EventEmitter, l10n } from 'vscode';
import { uuid } from '@gitlens/utils/crypto.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { getPresentableErrorMessage } from '../../../errors.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import type { AutoRebaseSession } from './autoRebase.types.js';
import type {
	StackRebaseChangeEvent,
	StackRebasePhase,
	StackRebasePlan,
	StackRebaseSession,
	StackRebaseStep,
} from './stackRebase.types.js';
import { formatStackPosition } from './stackRebase.utils.js';

export interface StackRebaseStartOptions {
	/** `manual` stops at each conflict; `ai` delegates each layer to the Auto-Rebase engine. */
	mode: 'manual' | 'ai';
	source: Source;
}

/** Phases in which the cascade still owns the repository — `paused` included, since the chain is
 *  waiting on the user for one layer and will pick the rest back up on its own. */
const livePhases = new Set<StackRebasePhase>(['starting', 'running', 'paused']);

interface ActiveStackRebase {
	session: StackRebaseSession;
	plan: StackRebasePlan;
	svc: GitRepositoryService;
	source: Source;
	/** Every subscription the run owns — disposed on any terminal transition and in `dispose()` */
	disposables: Disposable[];
	/** Resolves `start()`'s promise once the cascade settles (terminal, or paused for the user) */
	settle: (() => void) | undefined;
	/** Set while a layer is delegated to the `AutoRebaseService` — gates the bridge below */
	awaitingAi: boolean;
	/** The delegated Auto-Rebase session's id, adopted from its `starting` event; `undefined` between steps */
	aiSessionId: string | undefined;
	/** Guards the manual-mode repository-change bridge against re-entrant signals */
	resuming: boolean;
	/** The repository-change subscription watching a manual-mode conflict pause; cleared on resume */
	pauseWatch: Disposable | undefined;
}

/**
 * Rebases every branch of a stacked-pull-request chain, bottom to top, so each layer lands on the
 * rewritten layer below it. The bottom layer rebases onto the stack's trunk; every layer above runs
 * `git rebase --onto <layerBelow> <layerBelowsPreRebaseTip> <layer>`, which is why each step records
 * its tip BEFORE it is rewritten (see `StackRebaseStep.preSha`).
 *
 * Two modes, one cascade: `manual` runs each rebase directly and parks on conflicts; `ai` hands each
 * layer to the `AutoRebaseService` and parks on its escalations. Either park is temporary — the run
 * watches for the user finishing that one layer and then continues the rest of the stack unattended.
 *
 * One chain per repository; the cascade is in-memory only (a reload mid-run leaves the repository in
 * whatever state it reached, recoverable with the normal paused-operation UX).
 */
export class StackRebaseService implements Disposable {
	private readonly _onDidChange = new EventEmitter<StackRebaseChangeEvent>();
	get onDidChange(): Event<StackRebaseChangeEvent> {
		return this._onDidChange.event;
	}

	private readonly _sessions = new Map<string, ActiveStackRebase>();

	constructor(private readonly container: Container) {}

	dispose(): void {
		for (const active of this._sessions.values()) {
			this.teardown(active);
		}
		this._sessions.clear();
		this._onDidChange.dispose();
	}

	getSession(repoPath: string): StackRebaseSession | undefined {
		return this._sessions.get(repoPath)?.session;
	}

	/**
	 * The stack's branches that still have something to publish. Empty when the repository has no
	 * session, its cascade didn't reach `completed`, or every branch is already in sync — which is what
	 * lets a durable Force Push Stack offer decide whether to show itself at all.
	 *
	 * Pushability is read from each branch's own upstream state (unpublished, or ahead of its remote)
	 * rather than from this run's before/after SHAs. Those only answer "did THIS cascade rewrite it",
	 * which is the wrong question for a durable offer: running the cascade a second time rewrites
	 * nothing, replaces the session, and would otherwise report nothing to push while the first run's
	 * rewrites sat unpublished. Asking git instead survives a repeat run, a no-op run after a real one,
	 * and a push that only partly succeeded.
	 */
	async getPushableBranches(repoPath: string): Promise<StackRebaseStep[]> {
		const active = this._sessions.get(repoPath);
		if (active?.session.phase !== 'completed') return [];

		const svc = this.container.git.getRepositoryService(repoPath);

		const pushable: StackRebaseStep[] = [];
		for (const step of active.session.steps) {
			// Pushed by this run — short-circuits the read below, which can still be serving the pre-push
			// ahead count for a moment afterwards
			if (step.pushed) continue;

			const branch = await svc.branches.getBranch(step.branchName);
			if (branch == null) continue;

			if (branch.upstream == null || branch.upstream.state.ahead > 0) {
				pushable.push(step);
			}
		}

		return pushable;
	}

	/** Records that `branchNames` were force pushed, retiring them from {@link getPushableBranches}, and
	 *  announces it so any surface showing the offer re-renders. */
	markPushed(repoPath: string, branchNames: readonly string[]): void {
		const active = this._sessions.get(repoPath);
		if (active == null) return;

		const names = new Set(branchNames);
		let changed = false;
		for (const step of active.session.steps) {
			if (step.pushed || !names.has(step.branchName)) continue;

			step.pushed = true;
			changed = true;
		}

		if (!changed) return;

		this.fireChange(active.session);
	}

	/**
	 * Runs `plan`'s cascade. Resolves when the chain settles — either at a terminal phase or at a
	 * pause that hands the user one layer — so inspect `session.phase` for the outcome and keep
	 * following {@link onDidChange} past a `paused` result. Throws only for pre-flight refusals (an
	 * operation already in progress, a dirty working tree, a chain already running).
	 */
	async start(
		svc: GitRepositoryService,
		plan: StackRebasePlan,
		options: StackRebaseStartOptions,
	): Promise<StackRebaseSession> {
		await this.ensureAvailable(svc, options.mode);

		const current = await svc.branches.getBranch();
		const session: StackRebaseSession = {
			id: uuid(),
			repoPath: svc.path,
			stackNumber: plan.stackNumber,
			mode: options.mode,
			upstreamRef: plan.upstreamRef,
			remoteName: plan.remoteName,
			startedOnBranch: current?.detached ? undefined : current?.name,
			steps: plan.steps,
			startedAt: Date.now(),
			index: 0,
			phase: 'starting',
		};

		const active = this.track(session, plan, svc, options.source);
		const settled = new Promise<void>(resolve => (active.settle = resolve));

		this.container.telemetry.sendEvent(
			'stackRebase/started',
			{
				mode: session.mode,
				'branches.count': session.steps.length,
				'branches.missing.count': session.steps.reduce((n, s) => (s.createFromRef != null ? n + 1 : n), 0),
			},
			options.source,
		);
		this.fireChange(session);

		void this.advance(active, 0).catch((ex: unknown) => this.fail(active, ex, 'unexpected-error'));
		await settled;
		return session;
	}

	/**
	 * Stops the cascade without touching the repository: the layers already rebased stay rebased, and
	 * the layer in flight is left exactly as the user sees it. A delegated Auto-Rebase is *detached*
	 * rather than aborted for the same reason — a resolved-but-uncommitted step is work we must not
	 * silently discard. Aborting is the user's call, through the normal paused-operation UX.
	 */
	cancel(repoPath: string): void {
		const active = this._sessions.get(repoPath);
		if (active == null || !livePhases.has(active.session.phase)) return;

		if (active.awaitingAi) {
			active.awaitingAi = false;
			this.container.autoRebase.cancel(repoPath, 'detach');
		}

		this.stop(active, l10n.t('Stack rebase stopped.'));
	}

	/** The pre-flight refusals — all knowable before anything is touched, so a refused start leaves no
	 *  session behind and the caller just surfaces the message. */
	private async ensureAvailable(svc: GitRepositoryService, mode: 'manual' | 'ai'): Promise<void> {
		if (svc.ops == null) {
			throw new Error(l10n.t('Rebasing a pull request stack is not available in this environment.'));
		}

		if (mode === 'ai' && !this.container.ai.allowed) {
			throw new Error(l10n.t('AI features are disabled.'));
		}

		const existing = this._sessions.get(svc.path);
		if (existing != null && livePhases.has(existing.session.phase)) {
			throw new Error(l10n.t('A stack rebase is already running for this repository.'));
		}

		const paused = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
		if (paused != null) {
			throw new Error(l10n.t('Finish or abort the operation in progress before rebasing the stack.'));
		}

		// The cascade checks out a different branch at every layer, so an autostash would be re-applied
		// onto whichever branch the run happened to end on — refuse instead of relocating their work.
		const status = await svc.status?.getStatus?.();
		if (status?.hasChanges) {
			throw new Error(l10n.t('Commit or stash your changes before rebasing the stack.'));
		}
	}

	private track(
		session: StackRebaseSession,
		plan: StackRebasePlan,
		svc: GitRepositoryService,
		source: Source,
	): ActiveStackRebase {
		const previous = this._sessions.get(session.repoPath);
		if (previous != null) {
			this.teardown(previous);
		}

		const active: ActiveStackRebase = {
			session: session,
			plan: plan,
			svc: svc,
			source: source,
			disposables: [],
			settle: undefined,
			awaitingAi: false,
			aiSessionId: undefined,
			resuming: false,
			pauseWatch: undefined,
		};
		this._sessions.set(session.repoPath, active);

		if (session.mode === 'ai') {
			this.bridgeAutoRebase(active);
		}

		return active;
	}

	/**
	 * Walks the cascade from `from` to the top. Each layer records its pre-rebase tip, rebases onto the
	 * layer below (or the trunk, at the bottom), and either completes or parks — parking returns, and
	 * one of the two bridges below re-enters here with the next index once the user is done.
	 */
	private async advance(active: ActiveStackRebase, from: number): Promise<void> {
		const { session, plan, svc } = active;

		for (let i = from; i < session.steps.length; i++) {
			if (!livePhases.has(session.phase)) return;

			const step = session.steps[i];
			session.index = i;
			session.phase = 'running';
			session.message =
				session.mode === 'ai'
					? l10n.t('{0} — rebasing with AI…', formatStackPosition(plan, i))
					: l10n.t('{0} — rebasing…', formatStackPosition(plan, i));
			step.status = 'running';
			this.fireChange(session);

			// A layer that isn't checked out locally yet is materialized from its remote-tracking ref, so
			// the chain has something to rebase and the layers above it keep a valid base
			if (step.createFromRef != null) {
				if (svc.branches.createBranch == null) {
					this.fail(
						active,
						new Error(l10n.t('{0} has no local branch and one cannot be created.', step.headRef)),
						'missing-branch',
						i,
					);
					return;
				}

				try {
					await svc.branches.createBranch?.(step.branchName, step.createFromRef);
				} catch (ex) {
					this.fail(active, ex, 'missing-branch', i);
					return;
				}
			}

			// Read BEFORE the rebase — this is the `<oldBase>` the layer above replays from, and after the
			// rewrite the old commits are only reachable by this SHA
			try {
				step.preSha = (await svc.revision.resolveRevision(step.branchName)).sha;
			} catch (ex) {
				this.fail(active, ex, 'missing-branch', i);
				return;
			}

			const below = i > 0 ? session.steps[i - 1] : undefined;
			if (below != null && below.preSha == null) {
				this.fail(
					active,
					new Error(l10n.t('The pre-rebase tip of {0} was not recorded.', below.branchName)),
					'unexpected-error',
					i,
				);
				return;
			}

			// Bottom layer: `git rebase <trunk> <branch>`. Above it: `git rebase --onto <below> <belowsOldTip> <branch>`
			const upstream = below?.preSha ?? plan.upstreamRef;
			const onto = below?.branchName;

			if (session.mode === 'ai') {
				this.startAiStep(active, i, upstream, onto);
				return;
			}

			let conflicted: boolean;
			try {
				const result = await svc.ops!.rebase(upstream, {
					branch: step.branchName,
					onto: onto,
					// `updateRefs` is deliberately left to the user's git config: each layer's `preSha` is
					// read immediately before that layer is rebased, so even a config-driven `--update-refs`
					// that moved a ref early can't desynchronize the chain.
					source: active.source,
				});
				conflicted = result.conflicted;
			} catch (ex) {
				this.fail(active, ex, 'rebase-error', i);
				return;
			}

			if (conflicted) {
				this.pause(active, i, 'conflicts');
				return;
			}

			await this.completeStep(active, i);
		}

		await this.finish(active);
	}

	/**
	 * Hands one layer to the Auto-Rebase engine. Deliberately NOT awaited: that promise resolves on an
	 * escalation too, while the rebase is merely paused, and the cascade has to keep following the very
	 * same Auto-Rebase session through the user's manual takeover — which only `onDidChange` reports.
	 * The promise is still caught, because a pre-flight refusal (no AI model, an operation already in
	 * progress) produces no event to react to.
	 */
	private startAiStep(active: ActiveStackRebase, index: number, upstream: string, onto: string | undefined): void {
		const { session, plan, svc } = active;
		active.awaitingAi = true;
		active.aiSessionId = undefined;

		void this.container.autoRebase
			.start(svc, {
				upstream: upstream,
				branch: session.steps[index].branchName,
				onto: onto,
				progressPrefix: formatStackPosition(plan, index),
				source: active.source,
			})
			.catch((ex: unknown) => {
				active.awaitingAi = false;
				this.fail(active, ex, 'rebase-error', index);
			});
	}

	/**
	 * The single hook that makes "Continue with Auto-Rebase" resume the REST of the stack for free.
	 *
	 * An escalated layer parks the cascade instead of tearing it down. The user resolves that layer by
	 * hand and invokes the existing `gitlens.ai.continueRebase`, whose takeover re-arms the SAME
	 * Auto-Rebase session (same id) and drives it to `completed`. This listener sees that completion,
	 * records the layer, and walks on to the next branch — no stack-specific resume command, and no
	 * second place that knows how to continue a chain.
	 */
	private bridgeAutoRebase(active: ActiveStackRebase): void {
		const subscription = this.container.autoRebase.onDidChange(e => {
			if (e.repoPath !== active.session.repoPath || e.session == null) return;

			this.onAutoRebaseChanged(active, e.session);
		});
		active.disposables.push(subscription);
	}

	private onAutoRebaseChanged(active: ActiveStackRebase, aiSession: AutoRebaseSession): void {
		if (!active.awaitingAi || !livePhases.has(active.session.phase)) return;

		if (active.aiSessionId == null) {
			// Adopt the run we asked for from its `starting` event — `AutoRebaseService` fires that both
			// for a fresh run and for a takeover resuming an escalated one (which keeps the same id), the
			// exact pair this bridge has to follow
			if (aiSession.phase !== 'starting') return;

			active.aiSessionId = aiSession.id;
		} else if (aiSession.id !== active.aiSessionId) {
			// A different Auto-Rebase replaced ours — the cascade no longer owns this branch, so stop
			// rather than advance on someone else's outcome
			this.stop(active, l10n.t('Stack rebase stopped — another rebase took over this repository.'));
			return;
		}

		const index = active.session.index;
		switch (aiSession.phase) {
			case 'starting':
				// Either our own step beginning, or the user's takeover re-arming an escalated one
				this.markResumed(active, index);
				break;

			case 'completed':
				active.awaitingAi = false;
				active.aiSessionId = undefined;
				this.markResumed(active, index);
				void this.advanceAfterStep(active, index).catch((ex: unknown) =>
					this.fail(active, ex, 'unexpected-error', index),
				);
				break;

			case 'escalated':
				// The layer needs the user — park, don't tear down (see {@link bridgeAutoRebase})
				this.pause(active, index, 'escalated');
				break;

			case 'aborted':
				active.awaitingAi = false;
				this.stop(active, l10n.t('Stack rebase stopped — the rebase was cancelled.'));
				break;

			case 'failed':
				active.awaitingAi = false;
				this.fail(
					active,
					new Error(aiSession.failure ?? l10n.t('The Auto-Rebase failed.')),
					'rebase-error',
					index,
				);
				break;

			default:
				break;
		}
	}

	/**
	 * Parks the cascade on the layer the user now owns. `conflicts` also arms a repository-change watch,
	 * since a manual rebase gives no other signal that it finished; an `escalated` pause needs none —
	 * the Auto-Rebase bridge already follows that session through the takeover.
	 */
	private pause(active: ActiveStackRebase, index: number, reason: 'conflicts' | 'escalated'): void {
		const { session, plan } = active;
		if (!livePhases.has(session.phase)) return;

		session.index = index;
		session.phase = 'paused';
		session.steps[index].status = 'paused';
		session.message =
			reason === 'conflicts'
				? l10n.t('{0} — paused on conflicts', formatStackPosition(plan, index))
				: l10n.t('{0} — paused, Auto-Rebase needs your help', formatStackPosition(plan, index));

		this.container.telemetry.sendEvent(
			'stackRebase/paused',
			{ ...this.lifecycleData(session), reason: reason },
			active.source,
		);

		if (reason === 'conflicts') {
			this.watchForManualResume(active, index);
		}

		this.fireChange(session);
		this.settleRun(active);
	}

	/** Watches the repository for a manual-mode pause clearing — the only signal that the user finished
	 *  (or abandoned) the layer they were handed. */
	private watchForManualResume(active: ActiveStackRebase, index: number): void {
		const repo = this.container.git.getRepository(active.session.repoPath);
		if (repo == null) return;

		active.pauseWatch = repo.onDidChange(e => {
			if (!e.changed('pausedOp', 'rebase', 'head')) return;

			void this.onManualResumeSignal(active, index);
		});
	}

	private clearPauseWatch(active: ActiveStackRebase): void {
		active.pauseWatch?.dispose();
		active.pauseWatch = undefined;
	}

	private async onManualResumeSignal(active: ActiveStackRebase, index: number): Promise<void> {
		if (active.resuming || active.session.phase !== 'paused') return;

		active.resuming = true;
		try {
			const status = await active.svc.pausedOps?.getPausedOperationStatus?.({ force: true });
			// Still paused — the user hasn't finished with this layer yet
			if (status != null) return;

			const step = active.session.steps[index];
			const sha = (await active.svc.revision.resolveRevision(step.branchName)).sha;
			this.clearPauseWatch(active);

			// The tip moved, so the rebase was continued to the end; unchanged means it was aborted. A
			// rebase whose every commit went empty would also leave the tip unmoved and reads as an abort —
			// the conservative call, since stopping strands nothing and rebasing on is unrecoverable.
			if (sha === step.preSha) {
				this.stop(active, l10n.t('Stack rebase stopped — the rebase was aborted.'));
				return;
			}

			this.markResumed(active, index);
			await this.advanceAfterStep(active, index);
		} catch (ex) {
			this.fail(active, ex, 'unexpected-error', index);
		} finally {
			active.resuming = false;
		}
	}

	/** Announces that a parked chain is moving again. A no-op when the chain was never parked, so both
	 *  bridges can call it unconditionally on the signal that woke them. */
	private markResumed(active: ActiveStackRebase, index: number): void {
		const { session } = active;
		if (session.phase !== 'paused') return;

		this.clearPauseWatch(active);
		session.phase = 'running';
		this.container.telemetry.sendEvent(
			'stackRebase/resumed',
			{ mode: session.mode, index: index + 1, 'branches.count': session.steps.length },
			active.source,
		);
		this.fireChange(session);
	}

	private async advanceAfterStep(active: ActiveStackRebase, index: number): Promise<void> {
		await this.completeStep(active, index);
		await this.advance(active, index + 1);
	}

	private async completeStep(active: ActiveStackRebase, index: number): Promise<void> {
		const { session } = active;
		const step = session.steps[index];

		try {
			step.postSha = (await active.svc.revision.resolveRevision(step.branchName)).sha;
		} catch (ex) {
			// Only needed to report what a force push would publish — not worth failing the chain over
			Logger.error(ex, 'StackRebaseService', 'completeStep');
		}

		step.status = 'completed';
		this.container.telemetry.sendEvent(
			'stackRebase/branch/completed',
			{ mode: session.mode, index: index + 1, 'branches.count': session.steps.length },
			active.source,
		);
		this.fireChange(session);
	}

	private async finish(active: ActiveStackRebase): Promise<void> {
		const { session } = active;
		if (!livePhases.has(session.phase)) return;

		await this.restoreStartingBranch(active);

		session.phase = 'completed';
		session.message = undefined;
		session.finishedAt = Date.now();
		this.container.telemetry.sendEvent('stackRebase/completed', this.lifecycleData(session), active.source);
		this.teardown(active);
		this.fireChange(session);
		this.settleRun(active);
	}

	private stop(active: ActiveStackRebase, message: string): void {
		const { session } = active;
		if (!livePhases.has(session.phase)) return;

		session.phase = 'stopped';
		session.message = message;
		session.finishedAt = Date.now();
		this.container.telemetry.sendEvent('stackRebase/stopped', this.lifecycleData(session), active.source);
		this.teardown(active);
		this.fireChange(session);
		this.settleRun(active);
	}

	private fail(
		active: ActiveStackRebase,
		ex: unknown,
		reason: 'rebase-error' | 'missing-branch' | 'unexpected-error',
		index?: number,
	): void {
		const { session } = active;
		if (!livePhases.has(session.phase)) return;

		const message = getPresentableErrorMessage(ex);
		if (index != null) {
			session.steps[index].status = 'failed';
			session.steps[index].error = message;
		}

		session.failure = message;
		session.phase = 'failed';
		session.message = undefined;
		session.finishedAt = Date.now();
		this.container.telemetry.sendEvent(
			'stackRebase/failed',
			{ ...this.lifecycleData(session), reason: reason },
			active.source,
		);
		this.teardown(active);
		this.fireChange(session);
		this.settleRun(active);
	}

	/** Puts the user back where they started, best-effort — skipped when that branch is gone or the
	 *  working tree isn't clean, since neither is worth failing (or disturbing) a finished cascade over. */
	private async restoreStartingBranch(active: ActiveStackRebase): Promise<void> {
		const { session, svc } = active;
		const name = session.startedOnBranch;
		if (name == null || session.steps.at(-1)?.branchName === name) return;

		try {
			const [branch, status] = await Promise.all([svc.branches.getBranch(name), svc.status?.getStatus?.()]);
			if (branch == null || status?.hasChanges) return;

			await svc.switch(name, { progress: false });
		} catch (ex) {
			Logger.error(ex, 'StackRebaseService', 'restoreStartingBranch');
		}
	}

	private lifecycleData(session: StackRebaseSession): {
		mode: 'manual' | 'ai';
		'branches.count': number;
		'branches.completed.count': number;
		duration: number;
	} {
		return {
			mode: session.mode,
			'branches.count': session.steps.length,
			'branches.completed.count': session.steps.reduce((n, s) => (s.status === 'completed' ? n + 1 : n), 0),
			duration: Date.now() - session.startedAt,
		};
	}

	/** Drops every subscription the run owns. The session itself stays in the map so a progress surface
	 *  can still read the terminal outcome, exactly as the `AutoRebaseService` keeps its last session. */
	private teardown(active: ActiveStackRebase): void {
		this.clearPauseWatch(active);
		for (const d of active.disposables) {
			d.dispose();
		}
		active.disposables.length = 0;
	}

	private settleRun(active: ActiveStackRebase): void {
		active.settle?.();
		active.settle = undefined;
	}

	private fireChange(session: StackRebaseSession): void {
		this._onDidChange.fire({ repoPath: session.repoPath, session: session });
	}
}
