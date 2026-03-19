import type { Uri } from '@gitlens/utils/uri.js';
import type { GitFileChange } from '../models/fileChange.js';
import type { GitStash } from '../models/stash.js';

export interface StashApplyResult {
	readonly conflicted: boolean;
}

export interface GitStashSubProvider {
	applyStash(
		repoPath: string,
		stashName: string,
		options?: { deleteAfter?: boolean | undefined },
	): Promise<StashApplyResult>;
	getStash(
		repoPath: string,
		options?: {
			includeFiles?: boolean;
			reachableFrom?: string;
			similarityThreshold?: number | null;
		},
		cancellation?: AbortSignal,
	): Promise<GitStash | undefined>;
	getStashCommitFiles(
		repoPath: string,
		ref: string,
		options?: { similarityThreshold?: number | null },
		cancellation?: AbortSignal,
	): Promise<GitFileChange[]>;
	deleteStash(repoPath: string, stashName: string, sha?: string): Promise<void>;
	renameStash(repoPath: string, stashName: string, sha: string, message: string, stashOnRef?: string): Promise<void>;
	saveStash(
		repoPath: string,
		message?: string,
		pathsOrUris?: (string | Uri)[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void>;
	saveSnapshot(repoPath: string, message?: string): Promise<void>;
}
