import type { ConsultedTool } from './consultation.js';
import type { Resolution } from './types.js';

/**
 * Lifecycle of an automatic rebase session.
 *
 * Running: `starting` → (`resolving` → `applying` → `continuing`)* per conflicted step.
 * Terminal: `completed` (rebase finished; undo available), `escalated` (automation stopped,
 * rebase left paused for the user), `aborted` (cancelled — `git rebase --abort` restored the
 * pre-rebase state), `failed` (unexpected error), `undone` (completed run rolled back).
 */
export type AutoRebasePhase =
	| 'starting'
	| 'resolving'
	| 'applying'
	| 'continuing'
	| 'completed'
	| 'escalated'
	| 'aborted'
	| 'failed'
	| 'undone';

export type AutoRebaseEscalationReason =
	/** One or more resolutions fell below the configured confidence threshold */
	| 'low-confidence'
	/** The AI failed to resolve one or more files */
	| 'resolve-errors'
	/** AI became unavailable mid-run (out of credits, rate-limited, offline, access revoked) — every
	 *  remaining step would fail the same way, so it's the run that stopped, not a file that resisted */
	| 'ai-unavailable'
	/** One or more files had no parseable conflict markers (binary, symlink, …) */
	| 'skipped-files'
	/** The rebase paused for something other than conflicts (edit/break todo entry, …) */
	| 'non-conflict-pause'
	/** The rebase stopped at a `reword`/`squash` whose message needs the user (the commit exists
	 *  with its original/auto-generated message — amend it, then resume) */
	| 'message-edit'
	/** The conflicted step is one the user marked `edit` — its resolutions were applied and staged,
	 *  but continuing would commit and move on (git's conflict stop IS the edit stop), so the run
	 *  stops here to give the user their requested editing window */
	| 'edit-step'
	/** A conflicted file or the rebase state changed externally while resolving */
	| 'external-modification'
	/** The loop stopped advancing or hit its iteration backstop */
	| 'step-cap'
	/** `git rebase --continue` failed for a reason automation can't handle */
	| 'continue-error'
	/** The user detached automation, leaving the rebase paused */
	| 'stopped'
	/** An unexpected error stopped automation */
	| 'unexpected-error';

export interface AutoRebaseEscalation {
	reason: AutoRebaseEscalationReason;
	message: string;
	stepNumber?: number;
	totalSteps?: number;
	files?: { path: string; confidence?: number; error?: string }[];
}

export interface AutoRebaseFileRecord {
	path: string;
	strategy: Resolution['strategy'];
	confidence: number;
	/** The AI's rationale for the resolution */
	description: string;
	note?: string;
	/** Working-tree content (with conflict markers) snapshotted before the resolution was applied */
	conflictedContent?: string;
	/** The resolved content that was applied */
	resolvedContent?: string;
	/** Repo-inspection tool calls the AI made resolving this file, when it consulted the repository */
	toolCallCount?: number;
	/** Model round-trips for this file — tool calls plus validation re-prompts */
	stepCount?: number;
	/** What the AI consulted to reach this resolution, so the summary can cite its evidence and not
	 *  just its verdict. Capped — see {@link ConsultedTool}; `toolCallCount` stays the exact count. */
	consulted?: ConsultedTool[];
}

export interface AutoRebaseStepRecord {
	/** The rebase step (msgnum) at which the pause occurred */
	stepNumber: number;
	totalSteps: number;
	commit: { sha: string | undefined; message: string | undefined };
	/** `empty-skipped`: the step's resolution made the commit empty and it was skipped.
	 *  `manual`: the step escalated and the user resolved it; recorded when automation resumed */
	kind: 'conflicts' | 'empty-skipped' | 'manual';
	files: AutoRebaseFileRecord[];
}

export interface AutoRebaseSession {
	/** Session id — also used as the AI conversation id for the whole run */
	readonly id: string;
	readonly repoPath: string;
	readonly mode: 'started' | 'takeover' | 'handoff';
	phase: AutoRebasePhase;
	readonly preRun: {
		/** The branch being rebased */
		branch: string | undefined;
		/** The branch tip before the rebase started (orig-head) */
		headSha: string;
		upstream?: string;
		/** Whether the working tree had changes when the run started (autostash engages); unknown for takeover */
		hadWorkingChanges?: boolean;
		/** Whether an autostash entry was already present when we started (takeover of a rebase that
		 *  autostashed before we took over) — its `stashCount` baseline already includes that entry, so
		 *  a conflicted re-apply doesn't grow the count and must be detected by the entry still being present */
		hadAutostash?: boolean;
		/** Stash entry count at run start — used to detect an autostash left in the stash */
		stashCount: number;
		startedAt: number;
	};
	/** Only paused (conflicted/skipped) steps are recorded — clean picks never surface */
	readonly steps: AutoRebaseStepRecord[];
	postRun?: {
		headSha: string;
		/** What happened to the autostash: `left-in-stash` means its re-apply conflicted and the
		 *  changes remain in the stash (the working tree is left with the conflicted application) */
		autostash: 'none' | 'reapplied' | 'left-in-stash';
		finishedAt: number;
	};
	escalation?: AutoRebaseEscalation;
	/** Error message when phase is `failed` */
	failure?: string;
	/** Transient human-readable progress while running */
	progressMessage?: string;
	/** The rebase step the loop is on, while running — cleared on every terminal transition. Progress
	 *  surfaces read this rather than parsing the `Step 3/7 · …` prefix out of {@link progressMessage}. */
	current?: { stepNumber: number; totalSteps: number };
}

/**
 * Durable copy of an escalated step's pre-resolution state, captured at escalation time so a
 * resumed run can record the human-resolved step in the summary. Kept independent of the one-shot
 * {@link AutoRebaseHandoff}, which the Resolve panel consumes (clearing it) before the user resumes.
 */
export interface EscalatedStepSnapshot {
	/** The rebase step (msgnum) that escalated — matched against the paused step on resume */
	stepNumber: number | undefined;
	/** Working-tree (marker) snapshots of the step's files, keyed by path — the "before" side */
	conflictedContents: Map<string, string>;
	/** The AI's attempted resolutions for the step (strategy + rationale), informational */
	resolutions: { filePath: string; strategy: Resolution['strategy']; description: string }[];
}

/** Context passed to the loop when resuming an escalated run so the human-resolved escalated step
 *  can be recorded in the summary. */
export interface AutoRebaseResumeContext {
	escalatedStep?: EscalatedStepSnapshot;
	/** Resolutions already recorded by earlier steps (with content) — seeds the loop's
	 *  `previousResolutions` so a resumed run keeps resolving a repeatedly-conflicting region
	 *  consistently with what the original run decided (the same guarantee a single continuous run
	 *  gives). */
	previousResolutions?: Resolution[];
}

/** One-shot payload handed to the Resolve panel when automation escalates mid-step. */
export interface AutoRebaseHandoff {
	/** Session id — reuse as the resolve conversation id so refinement stays in the run's AI conversation */
	sessionId: string;
	/** All of the escalated step's resolutions — passing and failing alike */
	resolutions: Resolution[];
	/** Working-tree (marker) snapshots of the resolved files, keyed by path */
	conflictedContents: Map<string, string>;
	errors: { filePath: string; message: string }[];
	skipped: { filePath: string; reason: string }[];
	/** What the AI consulted per file, keyed by path. The escalated step never becomes an
	 *  {@link AutoRebaseStepRecord} (it escalates before the record is pushed), so this is the only
	 *  place its evidence survives into the Resolve panel the user reviews it in. */
	consultations: Map<string, ConsultedTool[]>;
}

export type AutoRebaseUndoRefusalReason =
	| 'no-record'
	| 'unavailable'
	| 'operation-in-progress'
	| 'branch-changed'
	| 'branch-moved'
	| 'dirty';

export type AutoRebaseUndoValidation =
	| { ok: true }
	| {
			ok: false;
			reason: AutoRebaseUndoRefusalReason;
			message: string;
			/** When refused for `dirty`: the dirtiness is (at least partly) the conflicted
			 *  application of an autostash whose changes are safe in the stash */
			autostashConflict?: boolean;
			/** When refused for `dirty`: `undo()` can still recover it by stashing (the dirt is the
			 *  autostash, `reapplied` or `left-in-stash`), so callers may still offer Undo */
			recoverable?: boolean;
	  };

export type AutoRebaseUndoResult =
	| { ok: true; restoredTo: string; warning?: 'changes-left-in-stash' }
	| {
			ok: false;
			reason: AutoRebaseUndoRefusalReason;
			message: string;
			autostashConflict?: boolean;
	  };

export interface AutoRebaseChangeEvent {
	repoPath: string;
	/** `undefined` when the session was dismissed */
	session: AutoRebaseSession | undefined;
}
