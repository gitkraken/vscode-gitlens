import type { Uri } from '@gitlens/utils/uri.js';
import type { GitFileChange } from '../models/fileChange.js';
import type { GitStash } from '../models/stash.js';

export interface StashApplyResult {
	readonly conflicted: boolean;
}

export interface GitStashSubProvider {
	/**
	 * Applies a stash entry to the working tree.
	 * @param stashNameOrSha Accepts `stash@{N}` (from the stash list) or a raw SHA (e.g. from
	 * {@link createStash}). Note: `options.deleteAfter` (pop) requires a `stash@{N}` — git will
	 * reject a raw SHA because pop can only drop list entries.
	 */
	applyStash(
		repoPath: string,
		stashNameOrSha: string,
		options?: { deleteAfter?: boolean | undefined; index?: boolean | undefined },
	): Promise<StashApplyResult>;
	/**
	 * Creates a stash commit without adding it to the stash list (plumbing — equivalent to
	 * `git stash create`). Returns the created commit SHA, or `undefined` if there was nothing to
	 * stash.
	 */
	createStash(repoPath: string, message?: string): Promise<string | undefined>;
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
