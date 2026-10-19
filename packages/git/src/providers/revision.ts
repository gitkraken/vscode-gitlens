import type { Uri } from '@gitlens/utils/uri.js';
import type { GitFileStatus } from '../models/fileStatus.js';
import type { GitTreeEntry } from '../models/tree.js';

export interface ResolvedRevision {
	/** The SHA of the revision */
	sha: string;
	/** The "friendly" version of the revision, if applicable, otherwise the SHA */
	revision: string;

	/** Only set if the path is provided */
	status?: GitFileStatus;
	/** Only set if the path is provided */
	path?: string;
	/** Only set if the path is provided */
	originalPath?: string;
}

export interface GitRevisionSubProvider {
	exists?(
		repoPath: string,
		path: string,
		revOrOptions?: string | { untracked?: 'only' | 'include' },
	): Promise<boolean>;
	/** The empty tree's id in this repository's object format (SHA-1 or SHA-256). */
	getEmptyTreeSha(repoPath: string): Promise<string>;
	getRevisionContent(repoPath: string, path: string, rev: string): Promise<Uint8Array | undefined>;
	getSubmoduleHead?(repoPath: string, submodulePath: string): Promise<string | undefined>;
	/**
	 * Gets tracked file paths from the index (reflects working tree state, even during rebase).
	 * `paths` limits the read to those repo-relative folders (or files), matched literally rather than as globs;
	 * an empty array answers empty without running git, and omitting it reads the whole index.
	 */
	getTrackedFiles(
		repoPath: string,
		options?: { paths?: readonly string[] },
		cancellation?: AbortSignal,
	): Promise<string[]>;
	getTreeEntryForRevision(repoPath: string, path: string, rev: string): Promise<GitTreeEntry | undefined>;
	/**
	 * Lists every entry (files and folders) of the tree at `rev`, recursively.
	 * `paths` limits the listing to those repo-relative folders (or files), matched literally rather than as globs;
	 * each scope's ancestor folders are listed too, an empty array answers empty without running git, and omitting
	 * it lists the whole tree.
	 * An aborted `cancellation` rejects with a `CancellationError` rather than answering empty.
	 */
	getTreeForRevision(
		repoPath: string,
		rev: string,
		options?: { paths?: readonly string[] },
		cancellation?: AbortSignal,
	): Promise<GitTreeEntry[]>;
	resolveRevision(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		/** `force`: skips the cached answer and any in-flight read that started before this call, and stores the fresh answer. */
		options?: { force?: boolean },
	): Promise<ResolvedRevision>;
}
