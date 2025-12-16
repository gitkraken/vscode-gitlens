import type { CancellationToken, Disposable, Event, Range, TextDocument, Uri, WorkspaceFolder } from 'vscode';
import type { Commit, InputBox } from '../@types/vscode.git';
import type { ForcePushMode } from '../@types/vscode.git.enums';
import type { GitConfigKeys } from '../constants';
import type { SearchQuery } from '../constants.search';
import type { Source } from '../constants.telemetry';
import type { Features } from '../features';
import type { GitHostIntegration } from '../plus/integrations/models/gitHostIntegration';
import type { UnifiedAsyncDisposable } from '../system/unifiedDisposable';
import type { GitUri } from './gitUri';
import type { GitConflictFile } from './models';
import type { GitBlame, GitBlameLine } from './models/blame';
import type { GitBranch } from './models/branch';
import type { GitCommit, GitCommitIdentityShape, GitCommitStats, GitStashCommit } from './models/commit';
import type { GitContributor, GitContributorsStats } from './models/contributor';
import type {
	GitDiff,
	GitDiffFiles,
	GitDiffFilter,
	GitDiffShortStat,
	GitLineDiff,
	ParsedGitDiffHunks,
} from './models/diff';
import type { GitFile } from './models/file';
import type { GitFileChange } from './models/fileChange';
import type { GitFileStatus } from './models/fileStatus';
import type { GitGraph } from './models/graph';
import type { GitLog } from './models/log';
import type { MergeConflict } from './models/mergeConflict';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus';
import type { GitBranchReference, GitReference } from './models/reference';
import type { GitReflog } from './models/reflog';
import type { GitRemote } from './models/remote';
import type { Repository, RepositoryChangeEvent } from './models/repository';
import type { GitRevisionRange, GitRevisionRangeNotation } from './models/revision';
import type { GitStash } from './models/stash';
import type { GitStatus } from './models/status';
import type { GitStatusFile } from './models/statusFile';
import type { GitTag } from './models/tag';
import type { GitTreeEntry } from './models/tree';
import type { GitUser } from './models/user';
import type { GitWorktree } from './models/worktree';
import type { RemoteProvider } from './remotes/remoteProvider';
import type { GitGraphSearch, GitGraphSearchCursor, GitGraphSearchProgress, GitGraphSearchResults } from './search';
import type { BranchSortOptions, TagSortOptions } from './utils/-webview/sorting';

export type CachedGitTypes =
	| 'branches'
	| 'contributors'
	| 'gitignore'
	| 'providers'
	| 'remotes'
	| 'stashes'
	| 'status'
	| 'tags'
	| 'worktrees';

export interface GitDir {
	readonly uri: Uri;
	readonly commonUri?: Uri;
}

export type GitProviderId = 'git' | 'github' | 'vsls';

export interface GitProviderDescriptor {
	readonly id: GitProviderId;
	readonly name: string;
	readonly virtual: boolean;
}

export interface RepositoryInitWatcher extends Disposable {
	readonly onDidCreate: Event<Uri>;
}

export interface ScmRepository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;

	getCommit(ref: string): Promise<Commit>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;
}

export interface LeftRightCommitCountResult {
	left: number;
	right: number;
}

export interface PagedResult<T> {
	readonly paging?: {
		readonly cursor: string;
		readonly more: boolean;
	};
	readonly values: NonNullable<T>[];
}

export interface PagingOptions {
	cursor?: string;
}

export interface NextComparisonUrisResult {
	current: GitUri;
	next: GitUri | undefined;
	deleted?: boolean | undefined;
}

export interface PreviousComparisonUrisResult {
	current: GitUri;
	previous: GitUri | undefined;
}

export interface SearchCommitsResult {
	readonly search: SearchQuery;
	readonly log: GitLog | undefined;
}

export interface DiffRange {
	/** 1-based */
	readonly startLine: number;
	/** 1-based */
	readonly endLine: number;
	readonly active?: 'start' | 'end';
}

export interface PreviousRangeComparisonUrisResult extends PreviousComparisonUrisResult {
	range: DiffRange;
}

export interface RepositoryCloseEvent {
	readonly uri: Uri;
}

export interface RepositoryOpenEvent {
	readonly uri: Uri;
}

export type RepositoryVisibility = 'private' | 'public' | 'local';

export interface RepositoryVisibilityInfo {
	visibility: RepositoryVisibility;
	timestamp: number;
	remotesHash?: string;
}

export interface BranchContributionsOverview extends GitCommitStats<number> {
	readonly repoPath: string;
	readonly branch: string;
	readonly mergeTarget: string;
	readonly mergeBase: string;

	readonly commits: number;
	readonly latestCommitDate: Date | undefined;
	readonly firstCommitDate: Date | undefined;

	readonly contributors: GitContributor[];
}

export interface GitRepositoryProvider {
	excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]>;
	getLastFetchedTimestamp(repoPath: string): Promise<number | undefined>;

	branches: GitBranchesSubProvider;
	commits: GitCommitsSubProvider;
	config: GitConfigSubProvider;
	contributors: GitContributorsSubProvider;
	diff: GitDiffSubProvider;
	graph: GitGraphSubProvider;
	ops?: GitOperationsSubProvider;
	patch?: GitPatchSubProvider;
	pausedOps?: GitPausedOperationsSubProvider;
	refs: GitRefsSubProvider;
	remotes: GitRemotesSubProvider;
	revision: GitRevisionSubProvider;
	staging?: GitStagingSubProvider;
	stash?: GitStashSubProvider;
	status: GitStatusSubProvider;
	tags: GitTagsSubProvider;
	worktrees?: GitWorktreesSubProvider;
}

export type MergeDetectionConfidence = 'highest' | 'high' | 'medium';

export type GitBranchMergedStatus =
	| { merged: false }
	| { merged: true; confidence: MergeDetectionConfidence; localBranchOnly?: GitBranchReference };

export interface GitBranchesSubProvider {
	getBranch(repoPath: string, name?: string, cancellation?: CancellationToken): Promise<GitBranch | undefined>;
	getBranches(
		repoPath: string,
		options?: {
			filter?: ((b: GitBranch) => boolean) | undefined;
			paging?: PagingOptions | undefined;
			sort?: boolean | BranchSortOptions | undefined;
		},
		cancellation?: CancellationToken,
	): Promise<PagedResult<GitBranch>>;
	getBranchContributionsOverview(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<BranchContributionsOverview | undefined>;
	getBranchesWithCommits(
		repoPath: string,
		shas: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
		cancellation?: CancellationToken,
	): Promise<string[]>;
	getDefaultBranchName(
		repoPath: string | undefined,
		remote?: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined>;

	createBranch?(repoPath: string, name: string, sha: string, options?: { noTracking?: boolean }): Promise<void>;
	deleteLocalBranch?(repoPath: string, names: string | string[], options?: { force?: boolean }): Promise<void>;
	deleteRemoteBranch?(repoPath: string, names: string | string[], remote: string): Promise<void>;
	/**
	 * Returns whether a branch has been merged into another branch
	 * @param repoPath The repository path
	 * @param branch The branch to check if merged
	 * @param into The branch to check if merged into
	 * @returns A promise of whether the branch is merged
	 */
	getBranchMergedStatus?(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: CancellationToken,
	): Promise<GitBranchMergedStatus>;
	/** @internal not intended to be used outside of the sub-providers */
	getCurrentBranchReference?(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitBranchReference | undefined>;
	getLocalBranchByUpstream?(
		repoPath: string,
		remoteBranchName: string,
		cancellation?: CancellationToken,
	): Promise<GitBranch | undefined>;
	getPotentialMergeOrRebaseConflict?(
		repoPath: string,
		branch: string,
		targetBranch: string,
		cancellation?: CancellationToken,
	): Promise<MergeConflict | undefined>;
	getBaseBranchName?(repoPath: string, ref: string, cancellation?: CancellationToken): Promise<string | undefined>;
	/** Gets the stored merge target branch name, first checking the user target, then the detected target */
	getStoredMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	/** Gets the stored detected merge target branch name */
	getStoredDetectedMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	/** Gets the stored user merge target branch name */
	getStoredUserMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	onCurrentBranchAccessed?(repoPath: string): Promise<void>;
	onCurrentBranchModified?(repoPath: string): Promise<void>;
	renameBranch?(repoPath: string, oldName: string, newName: string): Promise<void>;
	setUpstreamBranch?(repoPath: string, name: string, upstream: string | undefined): Promise<void>;
	storeBaseBranchName?(repoPath: string, ref: string, base: string): Promise<void>;
	storeMergeTargetBranchName?(repoPath: string, ref: string, target: string): Promise<void>;
	storeUserMergeTargetBranchName?(repoPath: string, ref: string, target: string | undefined): Promise<void>;
}

interface GitLogOptionsBase {
	cursor?: string;
	limit?: number;
	ordering?: 'date' | 'author-date' | 'topo' | null;
}

export interface GitLogOptions extends GitLogOptionsBase {
	all?: boolean;
	authors?: GitUser[];
	merges?: boolean | 'first-parent';
	since?: number | string;
	stashes?: boolean | Map<string, GitStashCommit>;
	until?: number | string;
}

export interface GitLogForPathOptions extends Omit<GitLogOptions, 'stashes'> {
	filters?: GitDiffFilter[];
	isFolder?: boolean;
	range?: Range;
	renames?: boolean;
}

export interface GitLogShasOptions extends GitLogOptionsBase {
	all?: boolean;
	authors?: GitUser[];
	merges?: boolean | 'first-parent';
	pathOrUri?: string | Uri;
	since?: number | string;
}

export interface GitSearchCommitsOptions extends GitLogOptionsBase {
	skip?: number;
}

export interface IncomingActivityOptions extends GitLogOptionsBase {
	all?: boolean;
	branch?: string;
	skip?: number;
}

export interface GitCommitReachability {
	readonly refs: (
		| { readonly refType: 'branch'; readonly name: string; readonly remote: boolean; readonly current?: boolean }
		| { readonly refType: 'tag'; readonly name: string; readonly current?: never }
	)[];
}

export interface GitCommitsSubProvider {
	getCommit(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<GitCommit | undefined>;
	getCommitCount(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<number | undefined>;
	getCommitFiles(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<GitFileChange[]>;
	getCommitForFile(
		repoPath: string,
		uri: Uri,
		rev?: string | undefined,
		options?: { firstIfNotFound?: boolean | undefined },
		cancellation?: CancellationToken,
	): Promise<GitCommit | undefined>;
	getIncomingActivity?(
		repoPath: string,
		options?: IncomingActivityOptions,
		cancellation?: CancellationToken,
	): Promise<GitReflog | undefined>;
	getInitialCommitSha?(repoPath: string, cancellation?: CancellationToken): Promise<string | undefined>;
	getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[]; excludeMerges?: boolean },
		cancellation?: CancellationToken,
	): Promise<LeftRightCommitCountResult | undefined>;
	getLog(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions,
		cancellation?: CancellationToken,
	): Promise<GitLog | undefined>;
	getLogForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		options?: GitLogForPathOptions,
		cancellation?: CancellationToken,
	): Promise<GitLog | undefined>;
	getLogShas(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogShasOptions,
		cancellation?: CancellationToken,
	): Promise<Iterable<string>>;
	getOldestUnpushedShaForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		cancellation?: CancellationToken,
	): Promise<string | undefined>;
	isAncestorOf(repoPath: string, rev1: string, rev2: string, cancellation?: CancellationToken): Promise<boolean>;
	hasCommitBeenPushed(repoPath: string, rev: string, cancellation?: CancellationToken): Promise<boolean>;
	searchCommits(
		repoPath: string,
		search: SearchQuery,
		source: Source,
		options?: GitSearchCommitsOptions,
		cancellation?: CancellationToken,
	): Promise<SearchCommitsResult>;
	getCommitReachability?(
		repoPath: string,
		rev: string,
		cancellation?: CancellationToken,
	): Promise<GitCommitReachability | undefined>;
}

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
		options?: { autoStash?: boolean; branch?: string; interactive?: boolean; onto?: string; updateRefs?: boolean },
	): Promise<void>;
	reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
	): Promise<void>;
	revert(repoPath: string, refs: string[], options?: { editMessage?: boolean }): Promise<void>;
}

export interface GitPausedOperationsSubProvider {
	getPausedOperationStatus(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitPausedOperationStatus | undefined>;
	abortPausedOperation(repoPath: string, options?: { quit?: boolean }): Promise<void>;
	continuePausedOperation(repoPath: string, options?: { skip?: boolean }): Promise<void>;
}

export interface GitConfigSubProvider {
	getConfig?(repoPath: string, key: GitConfigKeys): Promise<string | undefined>;
	setConfig?(repoPath: string, key: GitConfigKeys, value: string | undefined): Promise<void>;
	getCurrentUser(repoPath: string): Promise<GitUser | undefined>;
	getDefaultWorktreePath?(repoPath: string): Promise<string | undefined>;
	getGitDir?(repoPath: string): Promise<GitDir | undefined>;
}

export interface GitContributorsResult {
	readonly contributors: GitContributor[];
	readonly cancelled?: { reason: 'cancelled' | 'timedout' } | undefined;
}

export interface GitContributorsSubProvider {
	getContributors(
		repoPath: string,
		rev?: string | undefined,
		options?: {
			all?: boolean;
			merges?: boolean | 'first-parent';
			pathspec?: string;
			since?: number | string;
			stats?: boolean;
		},
		cancellation?: CancellationToken,
		timeout?: number,
	): Promise<GitContributorsResult>;
	getContributorsLite(
		repoPath: string,
		rev?: string | undefined,
		options?: { all?: boolean; merges?: boolean | 'first-parent'; since?: number | string },
		cancellation?: CancellationToken,
	): Promise<GitContributor[]>;
	getContributorsStats(
		repoPath: string,
		options?: { merges?: boolean | 'first-parent'; since?: number | string },
		cancellation?: CancellationToken,
		timeout?: number,
	): Promise<GitContributorsStats | undefined>;
}

export interface GitDiffSubProvider {
	getChangedFilesCount(
		repoPath: string,
		to?: string,
		from?: string,
		options?: { uris?: Uri[] },
		cancellation?: CancellationToken,
	): Promise<GitDiffShortStat | undefined>;
	getDiff?(
		repoPath: string,
		to: string,
		from?: string,
		options?: { context?: number; notation?: GitRevisionRangeNotation; uris?: Uri[] },
		cancellation?: CancellationToken,
	): Promise<GitDiff | undefined>;
	getDiffFiles?(
		repoPath: string,
		contents: string,
		cancellation?: CancellationToken,
	): Promise<GitDiffFiles | undefined>;
	getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; path?: string; similarityThreshold?: number },
		cancellation?: CancellationToken,
	): Promise<GitFile[] | undefined>;
	getDiffTool?(repoPath?: string): Promise<string | undefined>;
	getNextComparisonUris(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		skip?: number,
		cancellation?: CancellationToken,
	): Promise<NextComparisonUrisResult | undefined>;
	getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		skip?: number,
		unsaved?: boolean,
		cancellation?: CancellationToken,
	): Promise<PreviousComparisonUrisResult | undefined>;
	getPreviousComparisonUrisForRange(
		repoPath: string,
		uri: Uri,
		rev: string | undefined,
		range: DiffRange,
		options?: { skipFirstRev?: boolean },
		cancellation?: CancellationToken,
	): Promise<PreviousRangeComparisonUrisResult | undefined>;
	openDiffTool?(
		repoPath: string,
		uri: Uri,
		options?: {
			ref1?: string | undefined;
			ref2?: string | undefined;
			staged?: boolean | undefined;
			tool?: string | undefined;
		},
	): Promise<void>;
	openDirectoryCompare?(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void>;
}

export interface GitGraphSubProvider {
	/**
	 * Gets the commit graph for a repository.
	 *
	 * @param repoPath - The repository path
	 * @param rev - Optional revision/SHA to start from or find
	 * @param asWebviewUri - Function to convert URIs for webview usage
	 * @param options - Options including stats and limit (page size)
	 * @param cancellation - Cancellation token
	 *
	 * **Behavior when `rev` is provided:**
	 * - Finds the commit with the given revision/SHA
	 * - Ensures at least `options.limit` commits are loaded (fills the page)
	 * - If the SHA is found early, continues loading to reach the limit
	 * - If the SHA is found late, loads all commits up to and including it
	 *
	 * This ensures the initial graph load always provides a full page of commits for good UX.
	 */
	getGraph(
		repoPath: string,
		rev: string | undefined,
		asWebviewUri: (uri: Uri) => Uri,
		options?: { include?: { stats?: boolean }; limit?: number },
		cancellation?: CancellationToken,
	): Promise<GitGraph>;
	searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: CancellationToken,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>;
	continueSearchGraph(
		repoPath: string,
		cursor: GitGraphSearchCursor,
		existingResults: GitGraphSearchResults,
		options?: { limit?: number },
		cancellation?: CancellationToken,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>;
}

export interface GitPatchSubProvider {
	applyUnreachableCommitForPatch(
		repoPath: string,
		rev: string,
		options?: {
			branchName?: string;
			createBranchIfNeeded?: boolean;
			createWorktreePath?: string;
			stash?: boolean | 'prompt';
		},
	): Promise<void>;
	createUnreachableCommitForPatch(
		repoPath: string,
		base: string,
		message: string,
		patch: string,
	): Promise<GitCommit | undefined>;
	createUnreachableCommitsFromPatches(
		repoPath: string,
		base: string | undefined,
		patches: { message: string; patch: string; author?: GitCommitIdentityShape }[],
	): Promise<string[]>;
	createEmptyInitialCommit(repoPath: string): Promise<string>;

	validatePatch(repoPath: string | undefined, contents: string): Promise<boolean>;
}

export interface GitRefsSubProvider {
	checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean>;
	getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean | undefined },
		cancellation?: CancellationToken,
	): Promise<string | undefined>;
	getReference(repoPath: string, ref: string, cancellation?: CancellationToken): Promise<GitReference | undefined>;
	getSymbolicReferenceName?(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined>;
	hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?:
				| { branches?: ((b: GitBranch) => boolean) | undefined; tags?: ((t: GitTag) => boolean) | undefined }
				| undefined;
		},
		cancellation?: CancellationToken,
	): Promise<boolean>;
	isValidReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		cancellation?: CancellationToken,
	): Promise<boolean>;
	updateReference(repoPath: string, ref: string, newRef: string, cancellation?: CancellationToken): Promise<void>;
}

export interface GitRemotesSubProvider {
	getRemote(
		repoPath: string | undefined,
		name: string,
		cancellation?: CancellationToken,
	): Promise<GitRemote | undefined>;
	getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitRemote[]>;

	getDefaultRemote(repoPath: string, cancellation?: CancellationToken): Promise<GitRemote | undefined>;
	getRemotesWithProviders(
		repoPath: string,
		options?: { sort?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider>[]>;
	getRemotesWithIntegrations(
		repoPath: string,
		options?: { sort?: boolean },
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider>[]>;
	getBestRemoteWithProvider(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider> | undefined>;
	getBestRemotesWithProviders(
		repoPath: string,
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider>[]>;
	getBestRemoteWithIntegration(
		repoPath: string,
		options?: {
			filter?: (remote: GitRemote, integration: GitHostIntegration) => boolean;
			includeDisconnected?: boolean;
		},
		cancellation?: CancellationToken,
	): Promise<GitRemote<RemoteProvider> | undefined>;
	addRemote?(repoPath: string, name: string, url: string, options?: { fetch?: boolean }): Promise<void>;
	addRemoteWithResult?(
		repoPath: string,
		name: string,
		url: string,
		options?: { fetch?: boolean },
	): Promise<GitRemote | undefined>;
	pruneRemote?(repoPath: string, name: string): Promise<void>;
	removeRemote?(repoPath: string, name: string): Promise<void>;
	setRemoteAsDefault(repoPath: string, name: string, value?: boolean): Promise<void>;
}

export interface ResolvedRevision {
	/** The SHA of the revision */
	sha: string;
	/** The "friendly" version of the revision, if applicable, otherwise the SHA */
	revision: string;

	/** Only set if the pathOrUri is provided */
	status?: GitFileStatus;
	/** Only set if the pathOrUri is provided */
	path?: string;
	/** Only set if the pathOrUri is provided */
	originalPath?: string;
}

export interface GitRevisionSubProvider {
	getRevisionContent(repoPath: string, rev: string, path: string): Promise<Uint8Array | undefined>;
	getTreeEntryForRevision(repoPath: string, rev: string, path: string): Promise<GitTreeEntry | undefined>;
	getTreeForRevision(repoPath: string, rev: string): Promise<GitTreeEntry[]>;
	resolveRevision(repoPath: string, ref: string, pathOrUri?: string | Uri): Promise<ResolvedRevision>;
}

export interface DisposableTemporaryGitIndex extends UnifiedAsyncDisposable {
	path: string;
	env: { GIT_INDEX_FILE: string };
}

export interface GitStagingSubProvider {
	createTemporaryIndex(repoPath: string, base: string | undefined): Promise<DisposableTemporaryGitIndex>;
	stageFile(repoPath: string, pathOrUri: string | Uri): Promise<void>;
	stageFiles(repoPath: string, pathOrUri: string[] | Uri[], options?: { intentToAdd?: boolean }): Promise<void>;
	stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;
	unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void>;
	unstageFiles(repoPath: string, pathOrUri: string[] | Uri[]): Promise<void>;
	unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;
}

export interface GitStashSubProvider {
	applyStash(repoPath: string, stashName: string, options?: { deleteAfter?: boolean | undefined }): Promise<void>;
	getStash(
		repoPath: string,
		options?: { reachableFrom?: string },
		cancellation?: CancellationToken,
	): Promise<GitStash | undefined>;
	getStashCommitFiles(repoPath: string, ref: string, cancellation?: CancellationToken): Promise<GitFileChange[]>;
	deleteStash(repoPath: string, stashName: string, sha?: string): Promise<void>;
	renameStash(repoPath: string, stashName: string, sha: string, message: string, stashOnRef?: string): Promise<void>;
	saveStash(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void>;
	saveSnapshot(repoPath: string, message?: string): Promise<void>;
}

export interface GitWorkingChangesState {
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
}

export interface GitStatusSubProvider {
	/**
	 * Get the status of the repository
	 * @param repoPath Repository path
	 * @returns A promise of the status
	 */
	getStatus(repoPath: string | undefined, cancellation?: CancellationToken): Promise<GitStatus | undefined>;
	/**
	 * Get the status of a file
	 * @param repoPath Repository path
	 * @param pathOrUri Path or Uri of the file to get the status for
	 * @param options Options to control how the status is retrieved
	 * @returns A promise of the file's status
	 */
	getStatusForFile?(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: {
			/** If false, will avoid rename detection (faster) */
			renames?: boolean;
		},
		cancellation?: CancellationToken,
	): Promise<GitStatusFile | undefined>;
	/**
	 * Get the status of a path
	 * @param repoPath Repository path
	 * @param pathOrUri Path or Uri to get the status for
	 * @param options Options to control how the status is retrieved
	 * @returns A promise of the path's status
	 */
	getStatusForPath?(
		repoPath: string,
		pathOrUri: Uri,
		options?: {
			/** If false, will avoid rename detection (faster) */
			renames?: boolean;
		},
		cancellation?: CancellationToken,
	): Promise<GitStatusFile[] | undefined>;

	/**
	 * Quickly check if the repository has any working changes
	 * @param repoPath Repository path
	 * @param options Options to control which types of changes to check for
	 * @param cancellation Cancellation token
	 * @returns A promise that resolves to true if any of the requested change types exist
	 */
	hasWorkingChanges(
		repoPath: string,
		options?: {
			/** Check for staged changes (default: true) */
			staged?: boolean;
			/** Check for unstaged changes (default: true) */
			unstaged?: boolean;
			/** Check for untracked files (default: true) */
			untracked?: boolean;
			/** Throw errors rather than returning false */
			throwOnError?: boolean;
		},
		cancellation?: CancellationToken,
	): Promise<boolean>;
	/**
	 * Get detailed information about all types of working changes in a single optimized call
	 * @param repoPath The repository path
	 * @param cancellation Cancellation token
	 * @returns A promise that resolves to an object with boolean flags for each change type
	 */
	getWorkingChangesState(repoPath: string, cancellation?: CancellationToken): Promise<GitWorkingChangesState>;
	/**
	 * Quickly check if the repository has any conflicting files
	 * @param repoPath Repository path
	 * @param cancellation Cancellation token
	 * @returns A promise that resolves to true if there are any unmerged files
	 */
	hasConflictingFiles(repoPath: string, cancellation?: CancellationToken): Promise<boolean>;
	/**
	 * Get all conflicting files in the repository with detailed stage information
	 * @param repoPath Repository path
	 * @param cancellation Cancellation token
	 * @returns A promise that resolves to an array of conflicting files with stage information
	 */
	getConflictingFiles(repoPath: string, cancellation?: CancellationToken): Promise<GitConflictFile[]>;
	/**
	 * Get all untracked files in the repository
	 * @param repoPath Repository path
	 * @param cancellation Cancellation token
	 * @returns A promise that resolves to an array of untracked file paths (relative to repo root)
	 */
	getUntrackedFiles(repoPath: string, cancellation?: CancellationToken): Promise<GitFile[]>;
}

export interface GitTagsSubProvider {
	getTag(repoPath: string, name: string, cancellation?: CancellationToken): Promise<GitTag | undefined>;
	getTags(
		repoPath: string,
		options?: {
			filter?: ((t: GitTag) => boolean) | undefined;
			paging?: PagingOptions | undefined;
			sort?: boolean | TagSortOptions | undefined;
		},
		cancellation?: CancellationToken,
	): Promise<PagedResult<GitTag>>;
	getTagsWithCommit(
		repoPath: string,
		sha: string,
		options?: {
			commitDate?: Date | undefined;
			mode?: 'contains' | 'pointsAt' | undefined;
		},
		cancellation?: CancellationToken,
	): Promise<string[]>;

	createTag?(repoPath: string, name: string, sha: string, message?: string): Promise<void>;
	deleteTag?(repoPath: string, name: string): Promise<void>;
}

export interface GitWorktreesSubProvider {
	createWorktree(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<void>;
	createWorktreeWithResult(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<GitWorktree | undefined>;
	getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		cancellation?: CancellationToken,
	): Promise<GitWorktree | undefined>;
	getWorktrees(repoPath: string, cancellation?: CancellationToken): Promise<GitWorktree[]>;
	getWorktreesDefaultUri(repoPath: string): Promise<Uri | undefined>;
	deleteWorktree(repoPath: string, path: string | Uri, options?: { force?: boolean }): Promise<void>;
}

export type GitSubProvider =
	| GitBranchesSubProvider
	| GitCommitsSubProvider
	| GitConfigSubProvider
	| GitContributorsSubProvider
	| GitDiffSubProvider
	| GitGraphSubProvider
	| GitOperationsSubProvider
	| GitPatchSubProvider
	| GitPausedOperationsSubProvider
	| GitRefsSubProvider
	| GitRemotesSubProvider
	| GitRevisionSubProvider
	| GitStagingSubProvider
	| GitStashSubProvider
	| GitStatusSubProvider
	| GitTagsSubProvider
	| GitWorktreesSubProvider;

type GitSubProviders = {
	[P in keyof GitProvider as NonNullable<GitProvider[P]> extends GitSubProvider ? P : never]: GitProvider[P];
};
export type GitSubProvidersProps = keyof GitSubProviders;

export type GitSubProviderForRepo<T extends GitSubProvider> = {
	[K in keyof T]: OmitFirstArg<T[K]>;
};

export function createSubProviderProxyForRepo<T extends GitSubProvider, U extends GitSubProviderForRepo<T>>(
	target: T,
	rp: string,
): U {
	return new Proxy(target, {
		get: (target, prop: string | symbol): unknown => {
			const value = target[prop as keyof T];
			if (typeof value === 'function') {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return (...args: unknown[]) => value.call(target, rp, ...args);
			}
			return value;
		},
	}) as unknown as U;
}

export interface GitProvider extends GitRepositoryProvider, Disposable {
	get onDidChange(): Event<void>;
	get onWillChangeRepository(): Event<RepositoryChangeEvent>;
	get onDidChangeRepository(): Event<RepositoryChangeEvent>;
	get onDidCloseRepository(): Event<RepositoryCloseEvent>;
	get onDidOpenRepository(): Event<RepositoryOpenEvent>;

	readonly descriptor: GitProviderDescriptor;
	readonly supportedSchemes: Set<string>;

	discoverRepositories(
		uri: Uri,
		options?: { cancellation?: CancellationToken; depth?: number; silent?: boolean },
	): Promise<Repository[]>;
	updateContext?(): void;
	openRepository(folder: WorkspaceFolder | undefined, uri: Uri, root: boolean, closed?: boolean): Repository[];
	openRepositoryInitWatcher?(): RepositoryInitWatcher;

	supports(feature: Features): Promise<boolean>;
	visibility(
		repoPath: string,
		remotes?: GitRemote[],
	): Promise<[visibility: RepositoryVisibility, cacheKey: string | undefined]>;

	getOpenScmRepositories(): Promise<ScmRepository[]>;
	getScmRepository(repoPath: string): Promise<ScmRepository | undefined>;
	getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined>;

	canHandlePathOrUri(scheme: string, pathOrUri: string | Uri): string | undefined;
	findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined>;
	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri;
	getBestRevisionUri(repoPath: string, path: string, rev: string | undefined): Promise<Uri | undefined>;
	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string;
	getRevisionUri(repoPath: string, rev: string, path: string): Uri;
	// getRootUri(pathOrUri: string | Uri): Uri;
	getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined>;

	applyChangesToWorkingFile?(uri: GitUri, ref1?: string, ref2?: string): Promise<void>;
	clone?(url: string, parentPath: string): Promise<string | undefined>;
	/**
	 * Returns the blame of a file
	 * @param uri Uri of the file to blame
	 * @param document Optional TextDocument to blame the contents of if dirty
	 */
	getBlame(uri: GitUri, document?: TextDocument | undefined): Promise<GitBlame | undefined>;
	/**
	 * Returns the blame of a file, using the editor contents (for dirty editors)
	 * @param uri Uri of the file to blame
	 * @param contents Contents from the editor to use
	 */
	getBlameContents(uri: GitUri, contents: string): Promise<GitBlame | undefined>;
	/**
	 * Returns the blame of a single line
	 * @param uri Uri of the file to blame
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param document Optional TextDocument to blame the contents of if dirty
	 * @param options.forceSingleLine Forces blame to be for the single line (rather than the whole file)
	 */
	getBlameForLine(
		uri: GitUri,
		editorLine: number,
		document?: TextDocument | undefined,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined>;
	/**
	 * Returns the blame of a single line, using the editor contents (for dirty editors)
	 * @param uri Uri of the file to blame
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param contents Contents from the editor to use
	 */
	getBlameForLineContents(
		uri: GitUri,
		editorLine: number,
		contents: string,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined>;
	getBlameForRange(uri: GitUri, range: Range): Promise<GitBlame | undefined>;
	getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlame | undefined>;
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlame | undefined;
	/**
	 * Returns a file diff between two commits
	 * @param uri Uri of the file to diff
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	getDiffForFile(uri: GitUri, ref1: string | undefined, ref2?: string): Promise<ParsedGitDiffHunks | undefined>;
	/**
	 * Returns a file diff between a commit and the specified contents
	 * @param uri Uri of the file to diff
	 * @param ref Commit to diff from
	 * @param contents Contents to use for the diff
	 */
	getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<ParsedGitDiffHunks | undefined>;
	/**
	 * Returns a line diff between two commits
	 * @param uri Uri of the file to diff
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	getDiffForLine(
		uri: GitUri,
		editorLine: number,
		ref1: string | undefined,
		ref2?: string,
	): Promise<GitLineDiff | undefined>;
	hasUnsafeRepositories?(): boolean;
	isTrackable(uri: Uri): boolean;
	isTracked(uri: Uri): Promise<boolean>;
}

export interface RevisionUriData {
	ref?: string;
	repoPath: string;
	uncPath?: string;
}
