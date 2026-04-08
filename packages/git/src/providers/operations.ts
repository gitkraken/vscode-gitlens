import type { GitBranchReference, GitReference } from '../models/reference.js';

export interface GitOperationsSubProvider {
	checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string | undefined } | { path?: string | undefined },
	): Promise<void>;
	cherryPick(repoPath: string, revs: string[], options?: { edit?: boolean; noCommit?: boolean }): Promise<void>;
	fetch(
		repoPath: string,
		options?: {
			all?: boolean | undefined;
			branch?: GitBranchReference | undefined;
			prune?: boolean | undefined;
			pull?: boolean | undefined;
			remote?: string | undefined;
		},
	): Promise<void>;
	merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean },
	): Promise<void>;
	pull(
		repoPath: string,
		options?: {
			branch?: GitBranchReference | undefined;
			rebase?: boolean | undefined;
			tags?: boolean | undefined;
		},
	): Promise<void>;
	push(
		repoPath: string,
		options?: {
			reference?: GitReference | undefined;
			force?: boolean | undefined;
			publish?: { remote: string };
		},
	): Promise<void>;
	rebase(
		repoPath: string,
		upstream: string,
		options?: {
			autoStash?: boolean;
			branch?: string;
			editor?: string;
			interactive?: boolean;
			onto?: string;
			updateRefs?: boolean;
		},
	): Promise<void>;
	reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
	): Promise<void>;
	revert(repoPath: string, refs: string[], options?: { editMessage?: boolean }): Promise<void>;
}
