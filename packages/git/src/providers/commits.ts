import type { Uri } from '@gitlens/utils/uri.js';
import type { GitCommit, GitStashCommit } from '../models/commit.js';
import type { GitDiffFilter } from '../models/diff.js';
import type { GitFileChange } from '../models/fileChange.js';
import type { GitLog } from '../models/log.js';
import type { GitReflog } from '../models/reflog.js';
import type { GitRevisionRange } from '../models/revision.js';
import type { SearchQuery } from '../models/search.js';
import type { CommitSignature } from '../models/signature.js';
import type { GitUser } from '../models/user.js';
import type { DiffRange } from './types.js';

export interface LeftRightCommitCountResult {
	left: number;
	right: number;
}

export interface SearchCommitsResult {
	readonly search: SearchQuery;
	readonly log: GitLog | undefined;
}

interface GitLogOptionsBase {
	cursor?: string;
	limit?: number;
	ordering?: 'date' | 'author-date' | 'topo' | null;
	/** Similarity threshold for rename detection (0-100). `null` means use Git's default. */
	similarityThreshold?: number | null;
}

export interface GitLogOptions extends GitLogOptionsBase {
	all?: boolean;
	authors?: GitUser[];
	/** Whether to include file details in commit results. Defaults to `true`. */
	includeFiles?: boolean;
	merges?: boolean | 'first-parent';
	since?: number | string;
	stashes?: boolean | Map<string, GitStashCommit>;
	until?: number | string;
}

export interface GitLogForPathOptions extends Omit<GitLogOptions, 'stashes'> {
	filters?: GitDiffFilter[];
	isFolder?: boolean;
	range?: DiffRange;
	renames?: boolean;
}

export interface GitLogShasOptions extends GitLogOptionsBase {
	all?: boolean;
	authors?: GitUser[];
	merges?: boolean | 'first-parent';
	pathOrUri?: string | Uri;
	reverse?: boolean;
	since?: number | string;
}

export interface GitSearchCommitsOptions extends GitLogOptionsBase {
	skip?: number;
	/** Telemetry source metadata — passed by callers, ignored by library implementations. */
	source?: { source: string; detail?: string };
}

export interface IncomingActivityOptions extends GitLogOptionsBase {
	all?: boolean;
	branch?: string;
	skip?: number;
}

export interface GitCommitReachability {
	readonly partial?: boolean;
	readonly refs: (
		| { readonly refType: 'branch'; readonly name: string; readonly remote: boolean; readonly current?: boolean }
		| { readonly refType: 'tag'; readonly name: string; readonly current?: never }
	)[];
}

export interface GitCommitsSubProvider {
	getCommit(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<GitCommit | undefined>;
	getCommitCount(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<number | undefined>;
	getCommitFiles(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<GitFileChange[]>;
	getCommitForFile(
		repoPath: string,
		pathOrUri: string | Uri,
		rev?: string,
		options?: { firstIfNotFound?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitCommit | undefined>;
	getIncomingActivity?(
		repoPath: string,
		options?: IncomingActivityOptions,
		cancellation?: AbortSignal,
	): Promise<GitReflog | undefined>;
	getInitialCommitSha?(repoPath: string, cancellation?: AbortSignal): Promise<string | undefined>;
	getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[]; excludeMerges?: boolean },
		cancellation?: AbortSignal,
	): Promise<LeftRightCommitCountResult | undefined>;
	getLog(
		repoPath: string,
		rev?: string,
		options?: GitLogOptions,
		cancellation?: AbortSignal,
	): Promise<GitLog | undefined>;
	getLogForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		rev?: string,
		options?: GitLogForPathOptions,
		cancellation?: AbortSignal,
	): Promise<GitLog | undefined>;
	getLogShas(
		repoPath: string,
		rev?: string,
		options?: GitLogShasOptions,
		cancellation?: AbortSignal,
	): Promise<Iterable<string>>;
	getOldestUnpushedShaForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	isAncestorOf(repoPath: string, rev1: string, rev2: string, cancellation?: AbortSignal): Promise<boolean>;
	hasCommitBeenPushed(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<boolean>;
	searchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: GitSearchCommitsOptions,
		cancellation?: AbortSignal,
	): Promise<SearchCommitsResult>;

	createUnreachableCommitFromTree?(
		repoPath: string,
		tree: string,
		parent: string,
		message: string,
		cancellation?: AbortSignal,
	): Promise<string>;
	getCommitReachability?(
		repoPath: string,
		rev: string,
		cancellation?: AbortSignal,
	): Promise<GitCommitReachability | undefined>;
	getCommitSignature?(repoPath: string, sha: string): Promise<CommitSignature | undefined>;
	isCommitSigned?(repoPath: string, sha: string): Promise<boolean>;
}
