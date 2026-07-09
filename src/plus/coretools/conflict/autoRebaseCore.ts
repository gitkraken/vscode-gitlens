import { PausedOperationContinueError } from '@gitlens/git/errors.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type {
	AutoRebaseEscalation,
	AutoRebaseHandoff,
	AutoRebaseSession,
	AutoRebaseStepRecord,
} from './autoRebase.types.js';
import type { ConflictProgressEvent, Resolution, ResolutionContext, StepResult, UnmergedEntry } from './types.js';

/**
 * Keep the most recent N resolutions (with content) as `previousResolutions` context for later
 * steps, so a region that conflicts repeatedly resolves consistently across the run. Bounded for
 * prompt-size safety — repeated conflicts are nearly always within adjacent steps.
 */
const previousResolutionsCap = 30;

/** Trims `resolutions` in place to the most recent {@link previousResolutionsCap} entries. */
function capRecent(resolutions: Resolution[]): void {
	if (resolutions.length > previousResolutionsCap) {
		resolutions.splice(0, resolutions.length - previousResolutionsCap);
	}
}

/** Extra iterations allowed beyond `steps.total * 2` before the runaway backstop trips. */
const iterationCapSlack = 10;

/**
 * The git/AI surface the loop drives — injected so the loop is unit-testable without a repo.
 * All operations are scoped to the session's repository.
 */
export interface AutoRebaseLoopPorts {
	getPausedOperationStatus(force: boolean): Promise<GitPausedOperationStatus | undefined>;
	listUnmergedEntries(): Promise<UnmergedEntry[]>;
	listUnmergedPaths(): Promise<Set<string>>;
	readWorkingFiles(paths: readonly string[]): Promise<Map<string, string>>;
	resolveConflicts(args: {
		entries: readonly UnmergedEntry[];
		context: ResolutionContext;
		onProgress: (event: ConflictProgressEvent) => void;
	}): Promise<StepResult>;
	applyResolutions(resolutions: readonly Resolution[]): Promise<void>;
	stageFiles(paths: string[]): Promise<void>;
	/** Whether the index has staged changes — distinguishes a resolved-and-staged pause (continue)
	 *  from a genuine non-conflict stop like an interactive `edit`/`break` (escalate) */
	hasStagedChanges(): Promise<boolean>;
	/** Continue (or skip) the paused operation headlessly; throws {@link PausedOperationContinueError} */
	continueOperation(options?: { skip?: boolean }): Promise<void>;
	/** Minimum confidence required to auto-apply — read per step so it's live-tunable mid-run */
	getConfidenceThreshold(): number;
	delay(ms: number): Promise<void>;
}

export type AutoRebaseLoopResult =
	| { type: 'completed' }
	| { type: 'cancelled' }
	| { type: 'escalated'; escalation: AutoRebaseEscalation; handoff?: AutoRebaseHandoff };

/**
 * Drives a paused rebase to completion: at each conflicted step, resolves with AI, gates on
 * confidence, applies + stages, and continues — recording every paused step on the session.
 * Stops (escalates) rather than guesses on anything it can't handle confidently; never writes
 * anything for the step being escalated. On cancellation it returns without aborting — the
 * caller owns `git rebase --abort`.
 */
export async function runAutoRebaseLoop(
	session: AutoRebaseSession,
	ports: AutoRebaseLoopPorts,
	signal: AbortSignal,
	onDidChange: () => void,
): Promise<AutoRebaseLoopResult> {
	const previousResolutions: Resolution[] = [];
	let iterations = 0;
	let maxIterations: number | undefined;
	let previousIterationKey: string | undefined;
	let lastKnownTotalSteps: number | undefined;

	const escalate = (
		escalation: AutoRebaseEscalation,
		handoff?: Omit<AutoRebaseHandoff, 'sessionId'>,
	): AutoRebaseLoopResult => ({
		type: 'escalated',
		escalation: {
			totalSteps: escalation.stepNumber != null ? lastKnownTotalSteps : undefined,
			...escalation,
		},
		handoff: handoff != null ? { sessionId: session.id, ...handoff } : undefined,
	});

	/**
	 * Continues the paused operation, classifying failures. Returns an escalation result to
	 * propagate, or `undefined` to keep looping. `conflicts`/`unmergedFiles` failures keep looping:
	 * `git rebase --continue` continues the WHOLE rebase, so a LATER step's conflict makes the
	 * continue itself exit non-zero even though the current step committed fine — a continue that
	 * made no progress at all re-surfaces the same step + conflict set and trips the stall
	 * detector, which remains the escalation path for a genuinely raced continue.
	 */
	const continueStep = async (
		stepNumber: number | undefined,
		recordedStep?: AutoRebaseStepRecord,
	): Promise<AutoRebaseLoopResult | undefined> => {
		try {
			await ports.continueOperation();
		} catch (ex) {
			if (!PausedOperationContinueError.is(ex)) {
				return escalate({
					reason: 'continue-error',
					message: ex instanceof Error ? ex.message : String(ex),
					stepNumber: stepNumber,
				});
			}

			switch (ex.details?.reason) {
				case 'emptyCommit':
					// Deterministic: the change is already upstream, so the resolved commit is empty.
					// Skip it (the same action the manual flow recommends) and record it.
					try {
						await ports.continueOperation({ skip: true });
					} catch (skipEx) {
						return escalate({
							reason: 'continue-error',
							message: skipEx instanceof Error ? skipEx.message : String(skipEx),
							stepNumber: stepNumber,
						});
					}
					if (recordedStep != null) {
						recordedStep.kind = 'empty-skipped';
						onDidChange();
					}
					return undefined;
				case 'conflicts':
				case 'unmergedFiles':
					return undefined;
				default:
					return escalate({
						reason: 'continue-error',
						message: ex.message,
						stepNumber: stepNumber,
					});
			}
		}
		return undefined;
	};

	while (true) {
		let status = await ports.getPausedOperationStatus(true);
		// No paused operation left — the rebase ran to completion. Check this BEFORE the abort
		// signal so a cancel that lands during the final successful continue reports completion
		// (with its summary + undo record), not a spurious "branch unchanged" abort.
		if (status == null) return { type: 'completed' };
		if (signal.aborted) return { type: 'cancelled' };

		if (status.type !== 'rebase') {
			return escalate({
				reason: 'non-conflict-pause',
				message: `A ${status.type} is in progress instead of the rebase.`,
			});
		}

		// Right after a continue there can be a transient window where the rebase directory exists
		// but REBASE_HEAD doesn't yet — retry once before concluding it needs attention.
		if (!status.isPaused) {
			await ports.delay(150);
			status = await ports.getPausedOperationStatus(true);
			if (status == null) return { type: 'completed' };
			if (status.type !== 'rebase' || !status.isPaused) {
				return escalate({
					reason: 'non-conflict-pause',
					message: 'The rebase stopped for a reason that can’t be handled automatically.',
				});
			}
		}

		const stepNumber = status.steps.current.number;
		const totalSteps = status.steps.total;
		lastKnownTotalSteps = totalSteps;
		maxIterations ??= totalSteps * 2 + iterationCapSlack;
		if (++iterations > maxIterations) {
			return escalate({
				reason: 'step-cap',
				message: 'The automatic rebase exceeded its step limit.',
				stepNumber: stepNumber,
			});
		}

		const entries = await ports.listUnmergedEntries();

		// Stall detection: a continued step must either finish the rebase or change the paused
		// state — seeing the same step with the same conflict set (possibly empty) means no
		// progress. This is also the escalation path for a continue genuinely raced by external
		// changes, and the backstop for the staged-resume continue below.
		const iterationKey = `${stepNumber}|${entries
			.map(e => e.path)
			.sort()
			.join('\0')}`;
		if (iterationKey === previousIterationKey) {
			return escalate({
				reason: 'step-cap',
				message: 'The rebase is not advancing.',
				stepNumber: stepNumber,
			});
		}

		previousIterationKey = iterationKey;

		if (entries.length === 0) {
			// Paused with nothing conflicted. When the index has staged changes, the step was
			// resolved externally (e.g. via the Resolve panel after an escalation, before a
			// takeover) and is ready — continue it. Otherwise it's a genuine non-conflict stop
			// (an interactive `edit`/`break`) that needs a human.
			if (await ports.hasStagedChanges()) {
				session.phase = 'continuing';
				session.progressMessage = `Step ${stepNumber}/${totalSteps} · Continuing…`;
				onDidChange();

				const escalated = await continueStep(stepNumber);
				if (escalated != null) return escalated;
				continue;
			}

			return escalate({
				reason: 'non-conflict-pause',
				message: 'The rebase paused without conflicts and needs your attention.',
				stepNumber: stepNumber,
			});
		}

		const stepPrefix = `Step ${stepNumber}/${totalSteps}`;
		session.phase = 'resolving';
		session.progressMessage = `${stepPrefix} · Resolving ${
			entries.length === 1 ? '1 conflict' : `${entries.length} conflicts`
		} with AI…`;
		onDidChange();

		// Snapshot the conflicted (marker) content BEFORE resolving — both for the summary's
		// before/after diff and for the external-modification guard below.
		const snapshot = await ports.readWorkingFiles(entries.map(e => e.path));

		// During a rebase HEAD is the already-rebased side ("ours") and the commit being applied
		// (REBASE_HEAD) is the incoming side ("theirs").
		const stepCommit = status.steps.current.commit;
		const result = await ports.resolveConflicts({
			entries: entries,
			context: {
				refs: {
					ours: status.HEAD?.ref ?? 'HEAD',
					theirs: stepCommit?.ref ?? status.incoming?.ref ?? 'REBASE_HEAD',
					...(status.mergeBase != null ? { base: status.mergeBase } : {}),
				},
				...(stepCommit?.message ? { commitMessage: stepCommit.message } : {}),
				...(previousResolutions.length > 0 ? { previousResolutions: [...previousResolutions] } : {}),
			},
			onProgress: event => {
				switch (event.type) {
					case 'conflict:found':
						session.progressMessage = `${stepPrefix} · Analyzing ${event.filePath}…`;
						break;
					case 'resolution:applied':
						session.progressMessage = `${stepPrefix} · Resolved ${event.filePath}`;
						break;
					case 'resolution:failed':
						session.progressMessage = `${stepPrefix} · Couldn’t resolve ${event.filePath}`;
						break;
					default:
						return;
				}
				onDidChange();
			},
		});

		if (signal.aborted) return { type: 'cancelled' };

		// ---- Gates — all evaluated before anything is written to disk ----

		const handoff = {
			resolutions: result.resolutions,
			conflictedContents: snapshot,
			errors: result.errors.map(e => ({ filePath: e.filePath, message: e.error.message })),
			skipped: (result.skipped ?? []).map(s => ({ filePath: s.filePath, reason: s.reason })),
		};

		if (result.errors.length > 0) {
			return escalate(
				{
					reason: 'resolve-errors',
					message: `The AI couldn’t resolve ${result.errors.length === 1 ? result.errors[0].filePath : `${result.errors.length} files`}.`,
					stepNumber: stepNumber,
					files: result.errors.map(e => ({ path: e.filePath, error: e.error.message })),
				},
				handoff,
			);
		}

		if (result.skipped != null && result.skipped.length > 0) {
			return escalate(
				{
					reason: 'skipped-files',
					message: `${result.skipped.length === 1 ? result.skipped[0].filePath : `${result.skipped.length} files`} can’t be resolved automatically (no conflict markers).`,
					stepNumber: stepNumber,
					files: result.skipped.map(s => ({ path: s.filePath })),
				},
				handoff,
			);
		}

		// A `skipped`-strategy resolution means the AI resolved zero markers (`content: ''`) — it
		// passes the confidence gate but would apply nothing, letting the loop stage the still-
		// marker-laden file and commit raw conflict markers into history. Escalate instead. Gate
		// before low-confidence so a high-confidence skip (the exact bug) is caught here.
		const skippedResolutions = result.resolutions.filter(r => r.strategy === 'skipped');
		if (skippedResolutions.length > 0) {
			return escalate(
				{
					reason: 'skipped-files',
					message: `${skippedResolutions.length === 1 ? skippedResolutions[0].filePath : `${skippedResolutions.length} files`} can’t be resolved automatically (no conflict markers were resolved).`,
					stepNumber: stepNumber,
					files: skippedResolutions.map(r => ({ path: r.filePath })),
				},
				handoff,
			);
		}

		// `deleted` resolutions are deterministic (both-deleted), not AI guesses — exempt.
		const threshold = ports.getConfidenceThreshold();
		const lowConfidence = result.resolutions.filter(r => r.strategy !== 'deleted' && r.confidence < threshold);
		if (lowConfidence.length > 0) {
			return escalate(
				{
					reason: 'low-confidence',
					message: `AI confidence was too low for ${lowConfidence.length === 1 ? lowConfidence[0].filePath : `${lowConfidence.length} files`}.`,
					stepNumber: stepNumber,
					files: lowConfidence.map(r => ({ path: r.filePath, confidence: r.confidence })),
				},
				handoff,
			);
		}

		// ---- External-modification guard: refuse to write over anything that changed while the
		// AI was working (edited file, externally continued/aborted rebase, …) ----

		const [stillUnmerged, recheck] = await Promise.all([
			ports.listUnmergedPaths(),
			ports.readWorkingFiles(result.resolutions.map(r => r.filePath)),
		]);
		const externallyModified =
			result.resolutions.some(r => !stillUnmerged.has(r.filePath)) ||
			result.resolutions.some(r => recheck.get(r.filePath) !== snapshot.get(r.filePath));
		let recheckedStatus: GitPausedOperationStatus | undefined;
		if (
			externallyModified ||
			(recheckedStatus = await ports.getPausedOperationStatus(true)) == null ||
			recheckedStatus.type !== 'rebase' ||
			recheckedStatus.steps.current.number !== stepNumber
		) {
			return escalate({
				reason: 'external-modification',
				message: 'The working tree or rebase state changed while resolving — nothing was applied.',
				stepNumber: stepNumber,
			});
		}

		session.phase = 'applying';
		session.progressMessage = `${stepPrefix} · Applying resolutions…`;
		onDidChange();

		await ports.applyResolutions(result.resolutions);
		// `applyResolutions` stages content but not deletions — stage every applied path once
		// (idempotent for the rest) so the step can be continued.
		await ports.stageFiles(result.resolutions.map(r => r.filePath));

		const step: AutoRebaseStepRecord = {
			stepNumber: stepNumber,
			totalSteps: totalSteps,
			commit: { sha: stepCommit?.ref, message: stepCommit?.message },
			kind: 'conflicts',
			files: result.resolutions.map(r => ({
				path: r.filePath,
				strategy: r.strategy,
				confidence: r.confidence,
				description: r.description,
				note: r.note,
				conflictedContent: snapshot.get(r.filePath),
				resolvedContent: r.strategy !== 'skipped' ? r.content : undefined,
			})),
		};
		session.steps.push(step);

		previousResolutions.push(...result.resolutions);
		capRecent(previousResolutions);

		session.phase = 'continuing';
		session.progressMessage = `${stepPrefix} · Continuing…`;
		onDidChange();

		const escalated = await continueStep(stepNumber, step);
		if (escalated != null) return escalated;
	}
}
