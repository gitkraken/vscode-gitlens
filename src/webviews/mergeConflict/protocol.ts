import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcCommand, IpcNotification, IpcRequest } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = 'mergeConflict';

/** Single conflict region within the file. */
export interface MergeConflictHunk {
	index: number;
	/** 0-based line index of the `<<<<<<<` marker in the working-tree file. */
	startLine: number;
	/** 0-based line index of the `>>>>>>>` marker in the working-tree file. */
	endLine: number;
	currentLabel: string;
	incomingLabel: string;
	baseLabel?: string;
	current: { lines: string[] };
	incoming: { lines: string[] };
	base?: { lines: string[] };
	/** Indices into `current.lines` that differ from base. */
	currentChangedLines: number[];
	/** Indices into `incoming.lines` that differ from base. */
	incomingChangedLines: number[];
	/** True when both sides modified overlapping base ranges. */
	overlapping: boolean;
	/** 1-based [start, end) line range in `State.currentText` covering this hunk's current content. */
	currentStageRange: { start: number; end: number };
	/** 1-based [start, end) line range in `State.incomingText` covering this hunk's incoming content. */
	incomingStageRange: { start: number; end: number };
}

/** Origin of each line in the merged output — drives the green-check gutter markers in the
 *  Output pane and the "what came from where" telemetry. */
export type OutputLineSource = 'context' | 'current' | 'incoming' | 'base' | 'manual';

/** Per-output-line back-reference to the (hunk, side, line-in-side) that produced it. Present
 *  only for lines whose source is 'current' or 'incoming'. Drives the Output pane's gutter
 *  unchecks: clicking the green marker dispatches a pick-line on the source side. */
export interface OutputLineMeta {
	hunkIndex: number;
	side: 'current' | 'incoming';
	lineIndexInSide: number;
}

/** One line in a hunk's resolution output. May be sourced from a side (synced) or freely edited
 *  by the user (manual). Once edited, a synced entry's `source` is dropped so the source pane's
 *  checkbox uncheckes and re-picking the same source line appends a new instance below the edit. */
export interface OutputEntry {
	text: string;
	/** Present when this entry was taken from a source side AND hasn't been edited. */
	source?: { side: 'current' | 'incoming'; lineIndex: number };
}

/** Current output for a hunk (the proposed resolution). Entries are stored in user-visible order
 *  — picks append, edits mutate in place, picks after edits append below the edits. */
export interface MergeConflictResolution {
	hunkIndex: number;
	entries: OutputEntry[];
	resolved: boolean;
}

export interface State extends WebviewState<'gitlens.mergeConflict'> {
	/** Absolute fsPath of the conflicted file. */
	filePath: string;
	/** Repository path. */
	repoPath: string;
	/** Display name (relative path) for UI. */
	displayPath: string;
	/** Conflict status (UU, AU, UA, etc.) — needed for unsupported flows. */
	conflictStatus?: GitFileConflictStatus;
	/** True when the file is too large / binary / otherwise unsupported. */
	unsupported?: { reason: 'binary' | 'too-large' | 'no-conflicts' | 'malformed' | 'no-repo'; message: string };
	/** Detected line endings. */
	eol: '\n' | '\r\n';
	/** Full file content split into lines (working-tree state, with markers). */
	lines: string[];
	hunks: MergeConflictHunk[];
	/** Resolution state keyed by hunk index. */
	resolutions: MergeConflictResolution[];
	/** Live merged output — original file with each resolved hunk substituted in. */
	outputText: string;
	/** Per-line origin for `outputText`, same length and order. */
	outputLineSources: OutputLineSource[];
	/** Per-output-line back-reference for pick retraction. Sparse — only lines sourced from a
	 *  side pick are populated. */
	outputLineMeta: (OutputLineMeta | null)[];
	/** Full stage-2 (ours) file content — drives the "current" source pane in full-file mode. */
	currentText: string;
	/** Full stage-3 (theirs) file content — drives the "incoming" source pane in full-file mode. */
	incomingText: string;
	/** True when at least one hunk used diff3-style base markers. */
	hasDiff3: boolean;
	/** True when the user has any uncommitted state in the editor (picks OR context edits).
	 *  Drives the Reset All button's enabled state. */
	dirty: boolean;
	/** True if AI integration is available for this user/workspace. */
	aiAvailable: boolean;
	/** AI feature flag setting (gitlens.mergeConflictEditor.ai.enabled). */
	aiEnabled: boolean;
}

// COMMANDS (webview → extension)

export interface PickLineParams {
	hunkIndex: number;
	side: 'current' | 'incoming';
	/** Index into the side's lines (0-based within the hunk). */
	lineIndex: number;
}
export const PickLineCommand = new IpcCommand<PickLineParams>(scope, 'pick/line');

export interface PickHunkParams {
	hunkIndex: number;
	side: 'current' | 'incoming';
}
export const PickHunkCommand = new IpcCommand<PickHunkParams>(scope, 'pick/hunk');

export interface PickBothParams {
	hunkIndex: number;
	order: 'current-first' | 'incoming-first';
}
export const PickBothCommand = new IpcCommand<PickBothParams>(scope, 'pick/both');

export interface TakeBothAllParams {
	order: 'current-first' | 'incoming-first';
}
export const TakeBothAllCommand = new IpcCommand<TakeBothAllParams>(scope, 'pick/all-both');

export interface ResetHunkParams {
	hunkIndex: number;
}
export const ResetHunkCommand = new IpcCommand<ResetHunkParams>(scope, 'pick/reset');

export interface TakeAllParams {
	side: 'current' | 'incoming';
}
export const TakeAllCommand = new IpcCommand<TakeAllParams>(scope, 'pick/all');

export interface UpdateOutputParams {
	/** Full replacement for the merged output. When set, the host stores it as a manual override
	 *  and uses it for the next save instead of rebuilding from per-hunk resolutions. */
	text: string;
}
export const UpdateOutputCommand = new IpcCommand<UpdateOutputParams>(scope, 'output/update');

export const AbortMergeCommand = new IpcCommand(scope, 'abort');
export const SaveAndResolveCommand = new IpcCommand(scope, 'saveAndResolve');
export const ResetAllCommand = new IpcCommand(scope, 'reset/all');

// REQUESTS (webview → extension → response)

export interface RequestAIResolveParams {
	hunkIndices?: number[];
}
export interface RequestAIResolveResult {
	resolutions: { hunkIndex: number; lines: string[]; explanation?: string }[];
	error?: string;
}
export const RequestAIResolveRequest = new IpcRequest<RequestAIResolveParams, RequestAIResolveResult>(
	scope,
	'ai/resolve',
);

// NOTIFICATIONS (extension → webview)

export interface DidChangeStateParams {
	state: State;
}
export const DidChangeStateNotification = new IpcNotification<DidChangeStateParams>(scope, 'didChange');

export interface DidResolveParams {
	resolution: MergeConflictResolution;
}
export const DidResolveNotification = new IpcNotification<DidResolveParams>(scope, 'resolve/didChange');
