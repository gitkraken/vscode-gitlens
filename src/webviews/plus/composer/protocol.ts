import type { IpcScope, WebviewState } from '../../protocol';

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

export interface ComposerCallbacks {
	onGenerateCommits: (hunks: ComposerHunk[], commits: ComposerCommit[], baseCommit: string) => void;
	onGenerateCommitMessage: (commitId: string, hunkIndices: number[]) => void;
	onComposeCommits: (commits: ComposerCommit[], unassignedHunkIndices: number[]) => void;
}

export interface ComposerHunkMap {
	index: number;
	hunkHeader: string;
}

export interface State extends WebviewState {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	hunkMap: ComposerHunkMap[];
	baseCommit: string;
	callbacks: ComposerCallbacks;

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

export interface GenerateCommitMessageParams {
	commitId: string;
	hunkIndices: number[];
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
