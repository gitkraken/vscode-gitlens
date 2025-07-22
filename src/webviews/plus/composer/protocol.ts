import type { IpcScope, WebviewState } from '../../protocol';
import { IpcCommand, IpcNotification } from '../../protocol';

export const scope: IpcScope = 'composer';

export interface ComposerHunk {
	index: number; // Unique hunk index (1-based to match hunkMap)
	fileName: string;
	diffHeader: string; // Git diff header (e.g., "diff --git a/file.ts b/file.ts")
	hunkHeader: string; // Hunk header (e.g., "@@ -1,5 +1,7 @@")
	content: string; // The actual diff content (lines starting with +, -, or space)
	additions: number;
	deletions: number;
	source: 'staged' | 'unstaged' | 'commits' | string; // commit SHA or source type
	assigned?: boolean; // True when this hunk's index is in any commit's hunkIndices array
}

export interface ComposerCommit {
	id: string;
	message: string;
	sha?: string; // Optional SHA for existing commits
	aiExplanation?: string;
	hunkIndices: number[]; // References to hunk indices in the hunk map
}

// Remove callbacks - use IPC instead

export interface ComposerHunkMap {
	index: number;
	hunkHeader: string;
}

export interface State extends WebviewState {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	hunkMap: ComposerHunkMap[];
	baseCommit: string;
	generating: boolean;
	generatingCommitMessage: string | null; // commitId of the commit currently generating a message, or null

	// UI state
	selectedCommitId: string | null;
	selectedCommitIds: Set<string>;
	selectedUnassignedSection: string | null;
	selectedHunkIds: Set<string>;

	// Section expansion state
	commitMessageExpanded: boolean;
	aiExplanationExpanded: boolean;
	filesChangedExpanded: boolean;

	// Unassigned changes
	unassignedChanges: {
		mode: 'staged-unstaged' | 'unassigned';
		staged?: ComposerHunk[];
		unstaged?: ComposerHunk[];
		unassigned?: ComposerHunk[];
	} | null;
}

// Commands that can be sent from the webview to the host
export interface FinishAndCommitParams {
	commits: ComposerCommit[];
	unassignedHunkIndices: number[];
}

export interface GenerateWithAIParams {
	commits: ComposerCommit[];
	unassignedHunkIndices: number[];
}

// Notifications that can be sent from the host to the webview
export interface DidChangeComposerDataParams {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	baseCommit: string;
}

export interface DidChangeUnassignedChangesParams {
	unassignedChanges: State['unassignedChanges'];
}

// IPC Commands and Notifications
const ipcScope = 'composer';

// Commands sent from webview to host
export const GenerateCommitsCommand = new IpcCommand<GenerateCommitsParams>(ipcScope, 'generateCommits');
export const GenerateCommitMessageCommand = new IpcCommand<GenerateCommitMessageParams>(
	ipcScope,
	'generateCommitMessage',
);
export const FinishAndCommitCommand = new IpcCommand<FinishAndCommitParams>(ipcScope, 'finishAndCommit');

// Notifications sent from host to webview
export const DidChangeNotification = new IpcNotification<DidChangeComposerDataParams>(ipcScope, 'didChange');
export const DidStartGeneratingNotification = new IpcNotification<void>(ipcScope, 'didStartGenerating');
export const DidStartGeneratingCommitMessageNotification = new IpcNotification<{ commitId: string }>(
	ipcScope,
	'didStartGeneratingCommitMessage',
);
export const DidGenerateCommitsNotification = new IpcNotification<DidGenerateCommitsParams>(
	ipcScope,
	'didGenerateCommits',
);
export const DidGenerateCommitMessageNotification = new IpcNotification<DidGenerateCommitMessageParams>(
	ipcScope,
	'didGenerateCommitMessage',
);

// Parameters for IPC messages
export interface GenerateCommitsParams {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	hunkMap: ComposerHunkMap[];
	baseCommit: string;
}

export interface GenerateCommitMessageParams {
	commitId: string;
	diff: string;
}

export interface FinishAndCommitParams {
	commits: ComposerCommit[];
	unassignedHunkIndices: number[];
}

export interface DidChangeComposerDataParams {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	hunkMap: ComposerHunkMap[];
	baseCommit: string;
}

export interface DidGenerateCommitsParams {
	commits: ComposerCommit[];
}

export interface DidGenerateCommitMessageParams {
	commitId: string;
	message: string;
}
