import type { IpcScope, WebviewState } from '../../protocol';
import { IpcCommand, IpcNotification } from '../../protocol';

export const scope: IpcScope = 'composer';

export interface ComposerHunk {
	index: number; // Unique hunk index (1-based to match hunkMap)
	fileName: string;
	diffHeader: string; // Git diff header (e.g., "diff --git a/file.ts b/file.ts")
	hunkHeader: string; // Hunk header (e.g., "@@ -1,5 +1,7 @@") or "rename" for rename hunks
	content: string; // The actual diff content (lines starting with +, -, or space) or rename info
	additions: number;
	deletions: number;
	source: 'staged' | 'unstaged' | 'commits' | string; // commit SHA or source type
	assigned?: boolean; // True when this hunk's index is in any commit's hunkIndices array
	isRename?: boolean; // True for rename-only hunks
	originalFileName?: string; // Original filename for renames
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
	// data model
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	hunkMap: ComposerHunkMap[];
	baseCommit: string;

	// UI state
	selectedCommitId: string | null;
	selectedCommitIds: Set<string>;
	selectedUnassignedSection: string | null;
	selectedHunkIds: Set<string>;
	detailsSectionExpanded: {
		commitMessage: boolean;
		aiExplanation: boolean;
		filesChanged: boolean;
	};
	generatingCommits: boolean;
	generatingCommitMessage: string | null; // commitId of the commit currently generating a message, or null
	committing: boolean; // true when finish and commit is in progress
}

// Commands that can be sent from the webview to the host

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
export const DidStartCommittingNotification = new IpcNotification<void>(ipcScope, 'didStartCommitting');
export const DidFinishCommittingNotification = new IpcNotification<void>(ipcScope, 'didFinishCommitting');

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
	hunks: ComposerHunk[];
	baseCommit: string;
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
