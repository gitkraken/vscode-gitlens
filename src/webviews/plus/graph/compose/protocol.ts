import type { GitCommitIdentityShape } from '@gitlens/git/models/commit.js';

export interface ComposerHunkBase {
	index: number; // Unique hunk index (1-based to match hunkMap)
	fileName: string;
	additions: number;
	deletions: number;
	// Known values:
	//   - 'staged' / 'unstaged' / 'commits' — diff-collection layer (used by the retired webview
	//     composer's own `createHunksFromDiffs`)
	//   - 'unknown' — set when the hunk came from compose-tools, which no longer attaches per-hunk
	//     source-layer info (combined-diff collection collapses staged/unstaged/untracked/branch
	//     into one bucket). UI categorizers should treat 'unknown' as "we don't know which layer"
	//     and avoid asserting staged/unstaged badges off of it.
	//   - any other string — historically a commit SHA for branch-source hunks. Reserved for the
	//     non-compose-tools paths; the compose-tools path uses 'unknown' instead.
	source: 'staged' | 'unstaged' | 'commits' | 'unknown' | string;
	assigned?: boolean; // True when this hunk's index is in any commit's hunkIndices array
	isRename?: boolean; // True for rename-only hunks
	originalFileName?: string; // Original filename for renames
	author?: GitCommitIdentityShape; // Author of the commit this hunk belongs to, if any
	coAuthors?: GitCommitIdentityShape[]; // Co-authors of the commit this hunk belongs to, if any
}

export interface ComposerHunk extends ComposerHunkBase {
	diffHeader: string; // Git diff header (e.g., "diff --git a/file.ts b/file.ts")
	hunkHeader: string; // Hunk header (e.g., "@@ -1,5 +1,7 @@") or "rename" for rename hunks
	// The actual diff content (lines starting with +, -, or space). For rename-only hunks this is a
	// display label ("Rename from …\nRename to …"), NOT patch text — the rename lives in diffHeader
	// in patch form, so patch builders must skip this content (see createCombinedDiffForCommit).
	content: string;
}
