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
	/** One or more files had no parseable conflict markers (binary, symlink, …) */
	| 'skipped-files'
	/** The rebase paused for something other than conflicts (edit/break todo entry, …) */
	| 'non-conflict-pause'
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
	readonly mode: 'started' | 'takeover';
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
