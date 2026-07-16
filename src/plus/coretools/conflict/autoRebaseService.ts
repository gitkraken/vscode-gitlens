import type { Disposable, Event } from 'vscode';
import { CancellationTokenSource, EventEmitter } from 'vscode';
import { PausedOperationAbortError } from '@gitlens/git/errors.js';
import { uuid } from '@gitlens/utils/crypto.js';
import { wait } from '@gitlens/utils/promise.js';
import type { StoredAutoRebaseUndo } from '../../../constants.storage.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { toAbortSignal } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type {
	AutoRebaseChangeEvent,
	AutoRebaseHandoff,
	AutoRebaseSession,
	AutoRebaseUndoResult,
	AutoRebaseUndoValidation,
	EscalatedStepSnapshot,
} from './autoRebase.types.js';
import type { AutoRebaseLoopPorts } from './autoRebaseCore.js';
import { runAutoRebaseLoop } from './autoRebaseCore.js';
import type { ConflictToolsIntegration } from './integration.js';
import type { Resolution } from './types.js';

export interface AutoRebaseStartOptions {
	upstream: string;
	branch?: string;
	onto?: string;
	updateRefs?: boolean;
	source: Source;
}

interface ActiveAutoRebase {
	session: AutoRebaseSession;
	cts: CancellationTokenSource;
	source: Source;
	handoff?: AutoRebaseHandoff;
	/** Durable copy of the escalated step's pre-resolution state (survives handoff consumption), so a
	 *  resume can record the human-resolved step in the summary. Set on escalation, cleared on resume. */
	escalatedStep?: EscalatedStepSnapshot;
	detachRequested?: boolean;
}

const runningPhases = new Set(['starting', 'resolving', 'applying', 'continuing']);

/** A dirty working tree that `undo()` can recover by stashing — the autostash either re-applied
 *  cleanly (`reapplied`) or was left in the stash after a conflicted re-apply (`left-in-stash`) — as
 *  opposed to genuine user changes (`none`), which undo refuses. Shared so the undo gate and the
 *  actual undo can't drift. */
function autostashRecoverable(autostash: StoredAutoRebaseUndo['autostash']): boolean {
	return autostash === 'reapplied' || autostash === 'left-in-stash';
}

/**
 * Runs a rebase from start to finish, resolving each conflicted step with AI (applying, staging,
 * and continuing automatically), escalating to the Resolve panel instead of guessing, and
 * recording an undoable per-step summary of every resolution. One session per repo; the loop is
 * in-memory only (a reload mid-run degrades to the normal paused-operation UX), while the undo
 * record persists in workspace storage.
 */
export class AutoRebaseService implements Disposable {
	private readonly _onDidChange = new EventEmitter<AutoRebaseChangeEvent>();
	get onDidChange(): Event<AutoRebaseChangeEvent> {
		return this._onDidChange.event;
	}

	private readonly _sessions = new Map<string, ActiveAutoRebase>();
	private _integration: Promise<ConflictToolsIntegration | undefined> | undefined;

	constructor(private readonly container: Container) {}

	dispose(): void {
		for (const active of this._sessions.values()) {
			active.cts.cancel();
			active.cts.dispose();
		}
		this._sessions.clear();
		this._onDidChange.dispose();
	}

	getSession(repoPath: string): AutoRebaseSession | undefined {
		return this._sessions.get(repoPath)?.session;
	}

	/**
	 * Starts a fresh automatic rebase of `options.branch` (or the current branch) onto
	 * `options.upstream`. Resolves when the run reaches a terminal phase — inspect
	 * `session.phase` for the outcome. Throws only for pre-flight refusals (AI unavailable,
	 * an operation already in progress, …).
	 */
	async start(svc: GitRepositoryService, options: AutoRebaseStartOptions): Promise<AutoRebaseSession> {
		const integration = await this.ensureAvailable(svc);

		const existing = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
		if (existing != null) {
			throw new Error(
				existing.type === 'rebase'
					? 'A rebase is already in progress — use "Continue Rebase with AI" to automate it.'
					: `A ${existing.type} is already in progress.`,
			);
		}

		const [branch, headRev, status, stashMessages] = await Promise.all([
			options.branch ?? svc.branches.getBranch().then(b => b?.name),
			svc.revision.resolveRevision(options.branch ?? 'HEAD'),
			svc.status?.getStatus?.(),
			this.listStashMessages(svc),
		]);
		const headSha = headRev.sha;
		const stashCount = stashMessages.length;

		const session: AutoRebaseSession = {
			id: uuid(),
			repoPath: svc.path,
			mode: 'started',
			phase: 'starting',
			preRun: {
				branch: branch,
				headSha: headSha,
				upstream: options.upstream,
				hadWorkingChanges: status?.hasChanges ?? false,
				// We start from no in-progress operation and autostash (if any) is created by our own
				// rebase after this point, so there's no pre-existing autostash to account for.
				hadAutostash: false,
				stashCount: stashCount,
				startedAt: Date.now(),
			},
			steps: [],
		};
		const active = this.trackSession(session, options.source);

		try {
			const result = await svc.ops!.rebase(options.upstream, {
				branch: options.branch,
				onto: options.onto,
				updateRefs: options.updateRefs,
				// Suppress any message editing headlessly (interactive isn't used, but a
				// rebase.autosquash config could still trigger message edits)
				messageEditor: 'true',
				source: options.source,
			});

			if (!result.conflicted) {
				await this.finalize(svc, active);
			} else {
				await this.runLoop(svc, active, integration, options.source);
			}
		} catch (ex) {
			this.fail(active, ex);
		}
		return session;
	}

	/** Takes over an existing paused rebase and automates its remaining steps. */
	async takeover(svc: GitRepositoryService, source: Source): Promise<AutoRebaseSession> {
		const integration = await this.ensureAvailable(svc);

		const status = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
		if (status?.type !== 'rebase') {
			throw new Error('No rebase is in progress.');
		}
		if (!status.isPaused) {
			throw new Error('The rebase is not paused.');
		}

		// Resume our own escalated run in place — reuse the existing session (id, preRun, and the
		// steps already recorded before the escalation) instead of discarding them via a fresh
		// takeover session, so the end-of-run summary spans the whole rebase.
		const existing = this._sessions.get(svc.path);
		if (existing?.session.phase === 'escalated') {
			return this.resumeEscalatedSession(svc, existing, integration, source);
		}

		// The rebase we're taking over may have already autostashed before we arrived — record whether
		// an autostash entry is present now, since our `stashCount` baseline includes it (a conflicted
		// re-apply won't grow the count, so `finalize` detects it by the entry still being present).
		const [branch, stashMessages] = await Promise.all([
			(status.incoming != null && 'name' in status.incoming ? status.incoming.name : undefined) ??
				svc.branches.getBranch().then(b => b?.name),
			this.listStashMessages(svc),
		]);

		const session: AutoRebaseSession = {
			id: uuid(),
			repoPath: svc.path,
			mode: 'takeover',
			phase: 'starting',
			preRun: {
				branch: branch,
				// orig-head — the branch tip before the rebase started
				headSha: status.source.ref,
				// The rebase we're taking over was started elsewhere, so carry its `onto` target as the
				// upstream so the summary keeps the "onto <upstream>" context (as the started path does).
				upstream: status.onto?.name ?? status.onto?.ref,
				hadWorkingChanges: undefined,
				hadAutostash: stashMessages[0] === 'autostash',
				stashCount: stashMessages.length,
				startedAt: Date.now(),
			},
			steps: [],
		};
		const active = this.trackSession(session, source);

		try {
			await this.runLoop(svc, active, integration, source);
		} catch (ex) {
			this.fail(active, ex);
		}
		return session;
	}

	/**
	 * Re-engages automation on our own escalated run, in place. Rearms the existing session (fresh
	 * cancellation, phase back to running) while preserving its `id` (the run's AI conversation, so
	 * refinement/retries stay in one billed session), `preRun`, and already-recorded `steps` — so the
	 * summary spans the whole rebase. Deliberately does NOT go through {@link trackSession}, which
	 * would replace the session object (wiping its steps) and fire a fresh `started` event.
	 */
	private async resumeEscalatedSession(
		svc: GitRepositoryService,
		active: ActiveAutoRebase,
		integration: ConflictToolsIntegration,
		source: Source,
	): Promise<AutoRebaseSession> {
		const { session } = active;

		// The prior cts is spent (the escalated loop returned); the one-shot handoff is stale.
		active.cts.dispose();
		active.cts = new CancellationTokenSource();
		active.source = source;
		active.detachRequested = false;
		active.handoff = undefined;
		session.escalation = undefined;
		session.phase = 'starting';
		session.progressMessage = undefined;
		this.container.telemetry.sendEvent('autoRebase/resumed', { step: active.escalatedStep?.stepNumber }, source);
		this.fireChange(session);

		try {
			await this.runLoop(svc, active, integration, source);
		} catch (ex) {
			this.fail(active, ex);
		}
		return session;
	}

	/**
	 * Stops a running session. `abort` (default) aborts the rebase (`git rebase --abort` restores
	 * the pre-rebase state, including the autostash); `detach` leaves the rebase paused and just
	 * stops automating. Takes effect at the loop's next checkpoint — an in-flight continue settles
	 * first; if the run finishes before the cancellation lands, it completes normally.
	 */
	cancel(repoPath: string, mode: 'abort' | 'detach' = 'abort'): void {
		const active = this._sessions.get(repoPath);
		if (active == null || !runningPhases.has(active.session.phase)) return;

		if (mode === 'detach') {
			active.detachRequested = true;
		}
		active.cts.cancel();
	}

	/**
	 * One-shot consume of the escalated step's resolutions so the Resolve panel can open
	 * pre-populated. Returns `undefined` if there's nothing to hand off (or it was already taken).
	 */
	takeEscalationHandoff(repoPath: string): AutoRebaseHandoff | undefined {
		const active = this._sessions.get(repoPath);
		if (active?.session.phase !== 'escalated') return undefined;

		const handoff = active.handoff;
		active.handoff = undefined;
		return handoff;
	}

	/** Validation-only probe for the summary UI's Undo button state. */
	async canUndo(repoPath: string): Promise<AutoRebaseUndoValidation> {
		const record = this.getStoredUndo(repoPath);
		if (record == null) {
			return { ok: false, reason: 'no-record', message: 'There is no automatic rebase to undo.' };
		}
		return this.validateUndo(this.container.git.getRepositoryService(repoPath), record);
	}

	/**
	 * Rolls the branch back to its pre-rebase tip. Refuses if the branch has moved since the run
	 * completed (or was switched, or another operation started). A dirty working tree defaults by
	 * the run's autostash outcome: `reapplied` changes get the same treatment autostash gave them
	 * (`stash` → reset → pop, leaving the stash entry intact if the pop conflicts); a conflicted
	 * autostash application (`left-in-stash`) is stashed without re-applying (`stash`, no pop) — its
	 * diff is relative to the post-rebase tip, so popping it onto the pre-rebase tip would only
	 * re-conflict, and the original autostash entry (created from the pre-rebase tree) remains below
	 * it as the clean recovery path; anything else (new user changes) refuses. `options.ifDirty`
	 * overrides, though `discard` is only honored for the conflicted-autostash case.
	 */
	async undo(
		repoPath: string,
		options?: { ifDirty?: 'refuse' | 'stash' | 'discard' },
	): Promise<AutoRebaseUndoResult> {
		const result = await this.undoCore(repoPath, options);
		if (result.ok) {
			this.container.telemetry.sendEvent('autoRebase/undo/completed');
		} else {
			this.container.telemetry.sendEvent('autoRebase/undo/refused', { reason: result.reason });
		}
		return result;
	}

	private async undoCore(
		repoPath: string,
		options?: { ifDirty?: 'refuse' | 'stash' | 'discard' },
	): Promise<AutoRebaseUndoResult> {
		const record = this.getStoredUndo(repoPath);
		if (record == null) {
			return { ok: false, reason: 'no-record', message: 'There is no automatic rebase to undo.' };
		}

		const svc = this.container.git.getRepositoryService(repoPath);
		// Undo needs the ops (reset) provider. Guard here so an environment that lacks it (e.g. a
		// stub/web repo service) returns a clean refusal instead of throwing a TypeError past the
		// ok/refused telemetry branch.
		const ops = svc.ops;
		if (ops == null) {
			return { ok: false, reason: 'unavailable', message: 'Undo isn’t available in this environment.' };
		}

		const validation = await this.validateUndo(svc, record);

		let warning: 'changes-left-in-stash' | undefined;
		let popAfterReset = false;
		if (!validation.ok) {
			if (validation.reason !== 'dirty') return validation;

			const ifDirty = options?.ifDirty ?? (autostashRecoverable(record.autostash) ? 'stash' : 'refuse');
			switch (ifDirty) {
				case 'stash':
					if (svc.stash == null) return validation;

					await svc.stash.saveStash('Automatic rebase undo', undefined, { includeUntracked: true });
					// A conflicted autostash application is the post-rebase tree (markers + any manual
					// fixes) whose diff is relative to the post-rebase tip — popping it back onto the
					// pre-rebase tip would re-conflict. Leave it stashed; the original autostash entry
					// below it applies cleanly and is the user's recovery path.
					if (record.autostash === 'left-in-stash') {
						warning = 'changes-left-in-stash';
					} else {
						popAfterReset = true;
					}
					break;
				case 'discard':
					// Only safe when the dirtiness is the conflicted application of an autostash
					// whose changes remain in the stash — otherwise it would destroy work.
					if (record.autostash !== 'left-in-stash') return validation;

					warning = 'changes-left-in-stash';
					break;
				default:
					return validation;
			}
		}

		await ops.reset(record.preRebaseSha, { mode: 'hard' });

		if (popAfterReset) {
			try {
				const applied = await svc.stash!.applyStash('stash@{0}', { deleteAfter: true });
				if (applied.conflicted) {
					warning = 'changes-left-in-stash';
				}
			} catch {
				// The pop conflicted against the pre-rebase tree — the entry is left in the stash
				warning = 'changes-left-in-stash';
			}
		}

		await this.container.storage.deleteWorkspace(this.undoStorageKey(repoPath));

		const active = this._sessions.get(repoPath);
		if (active?.session.phase === 'completed') {
			active.session.phase = 'undone';
			this.fireChange(active.session);
		}

		return { ok: true, restoredTo: record.preRebaseSha, warning: warning };
	}

	/** Drops a terminal session and its stored undo record (the summary was dismissed). */
	async dismiss(repoPath: string): Promise<void> {
		await this.container.storage.deleteWorkspace(this.undoStorageKey(repoPath));

		const active = this._sessions.get(repoPath);
		if (active == null || runningPhases.has(active.session.phase)) return;

		// An escalated session whose handoff was never consumed still owns its AI conversation —
		// flush it so BYOK usage is reported (a consumed handoff transfers that to the panel).
		if (active.session.phase === 'escalated' && active.handoff != null) {
			void this.container.ai.flushBYOKUsage(active.session.id);
		}

		this._sessions.delete(repoPath);
		active.cts.dispose();
		this._onDidChange.fire({ repoPath: repoPath, session: undefined });
	}

	getStoredUndo(repoPath: string): StoredAutoRebaseUndo | undefined {
		return this.container.storage.getWorkspace(this.undoStorageKey(repoPath))?.data;
	}

	private undoStorageKey(repoPath: string): `autoRebase:undo:${string}` {
		return `autoRebase:undo:${repoPath}`;
	}

	private async runLoop(
		svc: GitRepositoryService,
		active: ActiveAutoRebase,
		integration: ConflictToolsIntegration,
		source: Source,
	): Promise<void> {
		const signal = toAbortSignal(active.cts.token)!;
		const ports: AutoRebaseLoopPorts = {
			getPausedOperationStatus: force => svc.pausedOps!.getPausedOperationStatus({ force: force }),
			listUnmergedEntries: () => integration.listUnmergedEntries(svc),
			listUnmergedPaths: () => integration.listUnmergedPaths(svc),
			readWorkingFiles: paths => integration.readWorkingFiles(svc, paths),
			resolveConflicts: args =>
				integration.resolveAllParallel(
					{
						svc: svc,
						entries: args.entries,
						context: args.context,
						signal: signal,
						onProgress: args.onProgress,
						conversationId: active.session.id,
					},
					{ source: source.source, detail: 'autoRebase' },
				),
			applyResolutions: resolutions => integration.applyBatch({ svc: svc, resolutions: resolutions }),
			stageFiles: paths => svc.staging!.stageFiles(paths),
			hasStagedChanges: async () => (await svc.status?.getStatus?.())?.files.some(f => f.staged) ?? false,
			continueOperation: options => svc.pausedOps!.continuePausedOperation({ ...options, messageEditor: 'true' }),
			getConfidenceThreshold: () => configuration.get('ai.autoRebase.confidenceThreshold'),
			delay: wait,
		};

		// Watch for newly-recorded steps on each loop tick to emit per-step telemetry — keeps the
		// loop itself telemetry-free (and unit-testable without the container). Start from the count
		// already recorded so a resume (which reuses the session's pre-escalation steps) reports only
		// the new steps rather than re-emitting the ones already sent by the original run.
		let reportedSteps = active.session.steps.length;
		const onLoopChange = () => {
			const { steps } = active.session;
			while (reportedSteps < steps.length) {
				const step = steps[reportedSteps++];
				this.container.telemetry.sendEvent(
					'autoRebase/step/resolved',
					{
						step: step.stepNumber,
						'steps.total': step.totalSteps,
						'files.count': step.files.length,
						'result.strategy.ai.count': step.files.filter(f => f.strategy === 'ai').length,
						'result.strategy.takeOurs.count': step.files.filter(f => f.strategy === 'take-ours').length,
						'result.strategy.takeTheirs.count': step.files.filter(f => f.strategy === 'take-theirs').length,
						'result.strategy.deleted.count': step.files.filter(f => f.strategy === 'deleted').length,
						'confidence.min': step.files.reduce((min, f) => Math.min(min, f.confidence), 1),
					},
					active.source,
				);
			}
			this.fireChange(active.session);
		};

		// Rebuild the resolutions recorded so far (empty for a fresh run) so a resume keeps the loop's
		// cross-step consistency memory instead of restarting it blank after an escalation.
		const priorResolutions: Resolution[] = active.session.steps.flatMap(step =>
			step.files
				.filter(f => f.resolvedContent != null)
				.map(f => ({
					filePath: f.path,
					content: f.resolvedContent!,
					strategy: f.strategy,
					confidence: f.confidence,
					description: f.description,
					note: f.note,
				})),
		);

		const result = await runAutoRebaseLoop(active.session, ports, signal, onLoopChange, {
			escalatedStep: active.escalatedStep,
			previousResolutions: priorResolutions,
		});
		switch (result.type) {
			case 'completed':
			case 'cancelled':
				// The run reached a non-escalated terminal state — the escalated-step snapshot (which
				// can hold large conflicted-file contents) has served its purpose recording a resumed
				// step, so drop it rather than retain it for the terminal session's lifetime. A
				// re-escalation takes the `escalated` branch below and re-sets a fresh snapshot.
				active.escalatedStep = undefined;
				if (result.type === 'completed') {
					await this.finalize(svc, active, { fromLoop: true });
				} else {
					await this.handleCancelled(svc, active);
				}
				break;
			case 'escalated':
				active.session.escalation = result.escalation;
				active.handoff = result.handoff;
				// Persist the escalated step's pre-resolution snapshot durably (the handoff itself is
				// consumed one-shot by the Resolve panel), so a later resume can record the step.
				active.escalatedStep =
					result.handoff != null
						? {
								stepNumber: result.escalation.stepNumber,
								conflictedContents: result.handoff.conflictedContents,
								resolutions: result.handoff.resolutions.map(r => ({
									filePath: r.filePath,
									strategy: r.strategy,
									description: r.description,
								})),
							}
						: undefined;
				active.session.phase = 'escalated';
				active.session.progressMessage = undefined;
				this.sendEscalatedEvent(active);
				this.fireChange(active.session);
				break;
		}
	}

	private async finalize(
		svc: GitRepositoryService,
		active: ActiveAutoRebase,
		options?: { fromLoop?: boolean },
	): Promise<void> {
		const { session } = active;
		const headSha = (await svc.revision.resolveRevision('HEAD')).sha;

		// The loop reported completion but the tip is back at the start: the rebase was aborted
		// externally (`git rebase --abort`) while we were driving it — there is nothing to undo (or
		// summarize as applied). Gate on `fromLoop` rather than `steps.length` so an abort *before* the
		// first step is recorded is still caught, without misclassifying `start()`'s "already up to
		// date" no-op (which reaches finalize directly, never from the loop, also with 0 steps).
		if (options?.fromLoop && headSha === session.preRun.headSha) {
			session.phase = 'aborted';
			session.progressMessage = undefined;
			this.fireChange(session);
			void this.container.ai.flushBYOKUsage(session.id);
			return;
		}

		const stashMessages = await this.listStashMessages(svc);
		const autostashPresent = stashMessages[0] === 'autostash';
		let autostash: 'none' | 'reapplied' | 'left-in-stash';
		if (session.preRun.hadAutostash) {
			// Takeover of a rebase that had already autostashed: the baseline count includes that entry,
			// so a conflicted re-apply leaves it in place (count unchanged) — detect it by the autostash
			// still being present rather than by the count growing.
			autostash =
				autostashPresent && stashMessages.length >= session.preRun.stashCount ? 'left-in-stash' : 'reapplied';
		} else if (autostashPresent && stashMessages.length > session.preRun.stashCount) {
			// Our own run autostashed and its re-apply conflicted, leaving the entry behind.
			autostash = 'left-in-stash';
		} else {
			autostash = session.preRun.hadWorkingChanges ? 'reapplied' : 'none';
		}

		session.postRun = { headSha: headSha, autostash: autostash, finishedAt: Date.now() };

		// A no-op rebase (already up to date) has nothing to undo
		if (headSha !== session.preRun.headSha) {
			await this.container.storage.storeWorkspace(this.undoStorageKey(session.repoPath), {
				v: 1,
				data: {
					branch: session.preRun.branch,
					preRebaseSha: session.preRun.headSha,
					postRebaseSha: headSha,
					autostash: autostash,
				},
				timestamp: Date.now(),
			});
		}

		session.phase = 'completed';
		session.progressMessage = undefined;
		this.container.telemetry.sendEvent(
			'autoRebase/completed',
			{
				...this.lifecycleData(session),
				'files.count': session.steps.reduce((sum, s) => sum + s.files.length, 0),
				autostash: autostash,
			},
			active.source,
		);
		this.fireChange(session);
		void this.container.ai.flushBYOKUsage(session.id);
	}

	private async handleCancelled(svc: GitRepositoryService, active: ActiveAutoRebase): Promise<void> {
		const { session } = active;
		if (active.detachRequested) {
			session.escalation = {
				reason: 'stopped',
				message: 'Automation stopped — the rebase is paused for you to continue manually.',
			};
			session.phase = 'escalated';
			session.progressMessage = undefined;
			this.sendEscalatedEvent(active);
			this.fireChange(session);
			return;
		}

		try {
			await svc.pausedOps?.abortPausedOperation?.();
		} catch (ex) {
			// The operation may already be gone (finished/aborted externally) — that's fine
			if (!PausedOperationAbortError.is(ex, 'nothingToAbort')) {
				this.fail(active, ex);
				return;
			}

			// Nothing to abort — the rebase already ended. If HEAD moved past the pre-rebase tip the
			// run actually finished (a cancel that raced the final successful continue), so finalize
			// it (summary + undo record) instead of misreporting an unchanged branch. Only when HEAD
			// is still at the pre-rebase tip is "aborted — branch unchanged" literally true.
			const headSha = (await svc.revision.resolveRevision('HEAD')).sha;
			if (headSha !== session.preRun.headSha) {
				await this.finalize(svc, active, { fromLoop: true });
				return;
			}
		}

		session.phase = 'aborted';
		session.progressMessage = undefined;
		this.container.telemetry.sendEvent('autoRebase/cancelled', this.lifecycleData(session), active.source);
		this.fireChange(session);
		void this.container.ai.flushBYOKUsage(session.id);
	}

	private fail(active: ActiveAutoRebase, ex: unknown): void {
		const { session } = active;
		session.failure = ex instanceof Error ? ex.message : String(ex);
		session.phase = 'failed';
		session.progressMessage = undefined;
		this.container.telemetry.sendEvent('autoRebase/failed', this.lifecycleData(session), active.source);
		this.fireChange(session);
		void this.container.ai.flushBYOKUsage(session.id);
	}

	private sendEscalatedEvent(active: ActiveAutoRebase): void {
		const { session } = active;
		if (session.escalation == null) return;

		this.container.telemetry.sendEvent(
			'autoRebase/escalated',
			{
				...this.lifecycleData(session),
				reason: session.escalation.reason,
				'confidence.threshold': configuration.get('ai.autoRebase.confidenceThreshold'),
				step: session.escalation.stepNumber,
			},
			active.source,
		);
	}

	private async ensureAvailable(svc: GitRepositoryService): Promise<ConflictToolsIntegration> {
		if (!this.container.ai.allowed) {
			throw new Error('AI features are disabled.');
		}

		const integration = await this.getIntegration();
		if (integration == null || svc.ops == null || svc.pausedOps == null || svc.staging == null) {
			throw new Error('Automatic rebase is not available in this environment.');
		}

		const existing = this._sessions.get(svc.path);
		if (existing != null && runningPhases.has(existing.session.phase)) {
			throw new Error('An automatic rebase is already running for this repository.');
		}

		return integration;
	}

	private getIntegration(): Promise<ConflictToolsIntegration | undefined> {
		// Lazily import the node-only conflict-tools integration on demand (browser resolves to a
		// stub returning `undefined`, so the feature gates off in VS Code Web)
		this._integration ??= import('@env/coretools/conflict.js').then(m =>
			m.createConflictToolsIntegration(this.container),
		);
		return this._integration;
	}

	/** Registers a new session for its repo, invalidating any previous terminal session + undo record. */
	private trackSession(session: AutoRebaseSession, source: Source): ActiveAutoRebase {
		const previous = this._sessions.get(session.repoPath);
		// An escalated session being replaced still owns its AI conversation if its handoff was never
		// consumed — flush its BYOK usage before dropping it (matching dismiss()).
		if (previous?.session.phase === 'escalated' && previous.handoff != null) {
			void this.container.ai.flushBYOKUsage(previous.session.id);
		}
		previous?.cts.dispose();
		// A new run invalidates the previous run's rollback point
		void this.container.storage.deleteWorkspace(this.undoStorageKey(session.repoPath));

		const active: ActiveAutoRebase = { session: session, cts: new CancellationTokenSource(), source: source };
		this._sessions.set(session.repoPath, active);
		this.container.telemetry.sendEvent('autoRebase/started', { takeover: session.mode === 'takeover' }, source);
		this.fireChange(session);
		return active;
	}

	private lifecycleData(session: AutoRebaseSession): {
		takeover: boolean;
		'steps.count': number;
		duration: number;
	} {
		return {
			takeover: session.mode === 'takeover',
			'steps.count': session.steps.length,
			duration: Date.now() - session.preRun.startedAt,
		};
	}

	private async validateUndo(
		svc: GitRepositoryService,
		record: StoredAutoRebaseUndo,
	): Promise<AutoRebaseUndoValidation> {
		const pausedOp = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
		if (pausedOp != null) {
			return {
				ok: false,
				reason: 'operation-in-progress',
				message: `Can't undo while a ${pausedOp.type} is in progress.`,
			};
		}

		if (record.branch != null) {
			const branch = await svc.branches.getBranch();
			if (branch?.name !== record.branch) {
				return {
					ok: false,
					reason: 'branch-changed',
					message: `Can't undo — ${record.branch} is no longer checked out.`,
				};
			}
		}

		const headSha = (await svc.revision.resolveRevision('HEAD')).sha;
		if (headSha !== record.postRebaseSha) {
			return {
				ok: false,
				reason: 'branch-moved',
				message: `Can't undo — ${record.branch ?? 'the branch'} has moved since the rebase completed.`,
			};
		}

		const status = await svc.status?.getStatus?.();
		if (status?.hasChanges) {
			return {
				ok: false,
				reason: 'dirty',
				message: 'The working tree has changes that would be lost.',
				autostashConflict: record.autostash === 'left-in-stash',
				// undo() recovers this by stashing (same condition it uses to decide `ifDirty`), so the
				// summary can still offer Undo — unlike genuine user changes (autostash `none`).
				recoverable: autostashRecoverable(record.autostash),
			};
		}

		return { ok: true };
	}

	private async listStashMessages(svc: GitRepositoryService): Promise<string[]> {
		const git = svc.createUnsafeGit();
		if (git == null) return [];

		try {
			// `%gs` is the reflog subject — a conflicted autostash re-apply stores its entry with
			// the literal subject `autostash`
			const result = await git.run(['stash', 'list', '--format=%gs']);
			return result.stdout.split('\n').filter(s => s.length > 0);
		} catch {
			return [];
		}
	}

	private fireChange(session: AutoRebaseSession): void {
		this._onDidChange.fire({ repoPath: session.repoPath, session: session });
	}
}
