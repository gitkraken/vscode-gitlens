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
	getRevisionContent(repoPath: string, path: string, rev: string): Promise<Uint8Array | undefined>;
	getSubmoduleHead?(repoPath: string, submodulePath: string): Promise<string | undefined>;
	/** Gets tracked file paths from the index (reflects working tree state, even during rebase) */
	getTrackedFiles(repoPath: string): Promise<string[]>;
	getTreeEntryForRevision(repoPath: string, path: string, rev: string): Promise<GitTreeEntry | undefined>;
	getTreeForRevision(repoPath: string, rev: string): Promise<GitTreeEntry[]>;
	resolveRevision(repoPath: string, ref: string, pathOrUri?: string | Uri): Promise<ResolvedRevision>;
}
