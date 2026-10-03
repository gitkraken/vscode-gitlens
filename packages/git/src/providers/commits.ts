import type { Uri } from '@gitlens/utils/uri.js';
import type { GitCommit, GitStashCommit } from '../models/commit.js';
import type { GitDiffFilter } from '../models/diff.js';
import type { GitFileChange } from '../models/fileChange.js';
import type { GitLog } from '../models/log.js';
import type { GitReflog } from '../models/reflog.js';
import type { GitRevisionRange } from '../models/revision.js';
import type { SearchQuery } from '../models/search.js';
import type { CommitSignature, SshSignedCommit } from '../models/signature.js';
import type { GitUser } from '../models/user.js';
import type { GitCommandPriority } from '../run.types.js';
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
	/** Leaves out commits reachable from these refs, relative to `rev` (`HEAD` when omitted) — see {@link GitRefExclusions} */
	excluding?: GitRefExclusions;
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

/**
 * Refs whose commits a history read (`getCommitCount`, `getLogShas`) leaves out, as `--not`.
 * `branches`/`remotes`/`tags` exclude every ref in that namespace; `except` carves full ref names or globs (`refs/heads/feat`, `refs/remotes/origin/*`)
 * back out of an enabled namespace and is ignored otherwise; `refs` are further revisions, passed verbatim.
 * A read is cached until a branch, remote-tracking branch or tag changes, so a `refs` entry outside those namespaces
 * (a tool's own `refs/<tool>/…`) can move without refreshing it: pass that ref's SHA instead, which keys a new read.
 */
export interface GitRefExclusions {
	branches?: boolean;
	remotes?: boolean;
	tags?: boolean;
	refs?: readonly string[];
	except?: readonly string[];
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
	/** Counts the commits reachable from `rev`, less any reachable from `excluding` — e.g. what only one branch has */
	getCommitCount(
		repoPath: string,
		rev: string,
		options?: { excluding?: GitRefExclusions },
		cancellation?: AbortSignal,
	): Promise<number | undefined>;
	/** Whether `rev` has any commits not reachable from any remote-tracking ref (i.e. unpushed/unpublished).
	 *  Cheap early-exit probe (`rev-list --not --remotes <rev> -n 1`) — it does NOT count them. Returns
	 *  `undefined` when it can't be determined. */
	hasUnpublishedCommits?(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<boolean | undefined>;
	/** Batched form of {@link hasUnpublishedCommits}: returns the subset of `shas` with commits not reachable
	 *  from any remote-tracking ref, in ONE walk rather than a spawn per sha. Pass tips from any worktrees of
	 *  the same repo — the object store and `refs/remotes` are shared, so a single `repoPath` covers them all.
	 *  Callers should skip this when the repo has no remotes (every local commit would qualify). */
	filterUnpublishedShas?(
		repoPath: string,
		shas: readonly string[],
		options?: { priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<Set<string>>;
	/** Cheap author/committer date lookup for a single revision. Skips the full commit parse (no files, parents, or message) — use when only the dates are needed. Pass a full SHA so caching stays correct (commits are immutable; refs are not). */
	getCommitDates?(
		repoPath: string,
		rev: string,
		cancellation?: AbortSignal,
	): Promise<{ authorDate: Date; committerDate: Date } | undefined>;
	/**
	 * Each non-merge commit's patch ID, keyed by full SHA: git's hash of a change with line numbers and `index` lines
	 * left out (`git patch-id`), so the same change gets the same ID wherever it was applied. It is what `git cherry`
	 * and rebase use to skip commits already upstream, e.g. to tell whether a branch's commits already landed after a
	 * rebase or cherry-pick. Merge commits, commits whose change is empty (after `paths`), and the boundary commits of
	 * a shallow clone (their parents are missing, so their own change is unknowable) are absent.
	 *
	 * `revs` is either a list of revisions (an exclusion or a range in it is refused) or a range, which yields every
	 * non-merge commit in it that touches `paths` (when given), including ones reached only through a merge's other
	 * parent. In a list, abbreviated SHAs and refs are resolved first; entries that are all full SHAs are read as is,
	 * and are trusted to be commits. Returns `undefined`, never a partial map, when more than `limit` commits match,
	 * when git fails, when `verbatim` is requested on a git without it (< 2.39), or when `patch-id` can't hash a commit
	 * whole (a binary change followed by other files, on git < 2.39).
	 *
	 * The diffs are plumbing output with every knob that could alter them pinned, so no user config changes an ID.
	 * Attributes still apply, though: a file that `.gitattributes` (or `info/attributes`, `core.attributesFile`)
	 * marks binary or `-diff` is hashed through its blob IDs, so its change matches only one with the same contents
	 * before and after. Hashing is whitespace-insensitive (`--stable`) unless `verbatim` is set. `paths` are literal
	 * paths relative to the repo root (never globs) and limit the diff too, so the ID covers only those files' changes.
	 * IDs are cached per full SHA, `paths` and `verbatim`: commits are immutable.
	 */
	getCommitPatchIds?(
		repoPath: string,
		revs: readonly string[] | GitRevisionRange,
		options?: { paths?: readonly string[]; verbatim?: boolean; limit?: number },
		cancellation?: AbortSignal,
	): Promise<Map<string, string> | undefined>;
	/**
	 * The patch ID (see {@link getCommitPatchIds}) of the change between two revisions, e.g. a branch's net change from
	 * its merge base, to compare against a commit's (such as a squash commit's). `undefined` when there is no change,
	 * when git fails, or when `verbatim` is requested on a git without it. `paths` and `verbatim` behave as in
	 * {@link getCommitPatchIds}. Not cached: `from` and `to` may be moving refs.
	 */
	getDiffPatchId?(
		repoPath: string,
		from: string,
		to: string,
		options?: { paths?: readonly string[]; verbatim?: boolean },
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
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

	/**
	 * Creates a commit object from a tree via `commit-tree`, with explicit (zero or more) parents and an
	 * optional explicit author/committer — e.g. for merge commits assembled from multiple parents, or a
	 * commit authored on behalf of someone else. Writes the commit object only; it updates no ref, so the
	 * result is unreachable until a caller points a branch/ref at it.
	 *
	 * Signs the commit when `sign` is true, reporting a signing failure as a `SigningError`.
	 */
	createCommitFromTree?(
		repoPath: string,
		tree: string,
		options: {
			parents: string[];
			message: string;
			author?: { name: string; email: string; date?: Date | string };
			committer?: { name: string; email: string; date?: Date | string };
			sign?: boolean;
			source?: unknown;
		},
		cancellation?: AbortSignal,
	): Promise<string>;
	getCommitReachability?(
		repoPath: string,
		rev: string,
		cancellation?: AbortSignal,
	): Promise<GitCommitReachability | undefined>;
	getCommitSignature?(repoPath: string, sha: string): Promise<CommitSignature | undefined>;
	/**
	 * For the given commits that are SSH-signed, extracts the signer's full SSH public key and raw committer identity,
	 * reading all commit objects in a single batched `git` invocation. Keyed by commit SHA (unsigned commits omitted).
	 */
	getCommitsSshSigners?(repoPath: string, shas: string[]): Promise<Map<string, SshSignedCommit>>;
	isCommitSigned?(repoPath: string, sha: string): Promise<boolean>;
}
