import { Disposable, Event, Range, TextEditor, Uri, WorkspaceFolder } from 'vscode';
import { Commit, InputBox } from '../@types/vscode.git';
import { GitUri } from './gitUri';
import {
	BranchSortOptions,
	GitBlame,
	GitBlameLine,
	GitBlameLines,
	GitBranch,
	GitBranchReference,
	GitContributor,
	GitDiff,
	GitDiffFilter,
	GitDiffHunkLine,
	GitDiffShortStat,
	GitFile,
	GitLog,
	GitLogCommit,
	GitMergeStatus,
	GitRebaseStatus,
	GitReflog,
	GitRemote,
	GitStash,
	GitStatus,
	GitStatusFile,
	GitTag,
	GitTree,
	GitUser,
	Repository,
	RepositoryChangeEvent,
	TagSortOptions,
} from './models';
import { RemoteProviders } from './remotes/factory';
import { RemoteProvider, RichRemoteProvider } from './remotes/provider';
import { SearchPattern } from './search';

export const enum GitProviderId {
	Git = 'git',
	GitHub = 'github',
}

export interface GitProviderDescriptor {
	readonly id: GitProviderId;
	readonly name: string;
}

export interface RepositoryInitWatcher extends Disposable {
	readonly onDidCreate: Event<Uri>;
}

export interface ScmRepository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;

	getCommit(ref: string): Promise<Commit>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export interface PagedResult<T> {
	readonly paging?: {
		readonly cursor: string;
		readonly more: boolean;
	};
	readonly values: NonNullable<T>[];
}

export interface GitProvider {
	get onDidChangeRepository(): Event<RepositoryChangeEvent>;

	readonly descriptor: GitProviderDescriptor;

	discoverRepositories(uri: Uri): Promise<Repository[]>;
	createRepository(
		folder: WorkspaceFolder,
		path: string,
		root: boolean,
		suspended?: boolean,
		closed?: boolean,
	): Repository;
	createRepositoryInitWatcher?(): RepositoryInitWatcher;
	getOpenScmRepositories(): Promise<ScmRepository[]>;
	getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined>;

	addRemote(repoPath: string, name: string, url: string): Promise<void>;
	pruneRemote(repoPath: string, remoteName: string): Promise<void>;
	applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void>;
	branchContainsCommit(repoPath: string, name: string, ref: string): Promise<boolean>;
	checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string | undefined } | { fileName?: string | undefined },
	): Promise<void>;
	resetCaches(
		...cache: ('branches' | 'contributors' | 'providers' | 'remotes' | 'stashes' | 'status' | 'tags')[]
	): void;
	excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]>;
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
	getBlameForFile(uri: GitUri): Promise<GitBlame | undefined>;
	getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined>;
	getBlameForLine(
		uri: GitUri,
		editorLine: number,
		options?: { skipCache?: boolean | undefined },
	): Promise<GitBlameLine | undefined>;
	getBlameForLineContents(
		uri: GitUri,
		editorLine: number,
		contents: string,
		options?: { skipCache?: boolean | undefined },
	): Promise<GitBlameLine | undefined>;
	getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined>;
	getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined>;
	getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined;
	getBranch(repoPath: string): Promise<GitBranch | undefined>;
	getBranches(
		repoPath: string,
		options?: { filter?: ((b: GitBranch) => boolean) | undefined; sort?: boolean | BranchSortOptions | undefined },
	): Promise<PagedResult<GitBranch>>;
	getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined>;
	getCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined>;
	getCommitBranches(
		repoPath: string,
		ref: string,
		options?: { mode?: 'contains' | 'pointsAt' | undefined; remotes?: boolean | undefined },
	): Promise<string[]>;
	getAheadBehindCommitCount(repoPath: string, refs: string[]): Promise<{ ahead: number; behind: number } | undefined>;
	getCommitCount(repoPath: string, ref: string): Promise<number | undefined>;
	getCommitForFile(
		repoPath: string,
		fileName: string,
		options?: {
			ref?: string | undefined;
			firstIfNotFound?: boolean | undefined;
			range?: Range | undefined;
			reverse?: boolean | undefined;
		},
	): Promise<GitLogCommit | undefined>;
	getOldestUnpushedRefForFile(repoPath: string, fileName: string): Promise<string | undefined>;
	getConfig(key: string, repoPath?: string): Promise<string | undefined>;
	getContributors(
		repoPath: string,
		options?: { all?: boolean | undefined; ref?: string | undefined; stats?: boolean | undefined },
	): Promise<GitContributor[]>;
	getCurrentUser(repoPath: string): Promise<GitUser | undefined>;
	getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined>;
	getDiffForFile(
		uri: GitUri,
		ref1: string | undefined,
		ref2?: string,
		originalFileName?: string,
	): Promise<GitDiff | undefined>;
	getDiffForFileContents(
		uri: GitUri,
		ref: string,
		contents: string,
		originalFileName?: string,
	): Promise<GitDiff | undefined>;
	getDiffForLine(
		uri: GitUri,
		editorLine: number,
		ref1: string | undefined,
		ref2?: string,
		originalFileName?: string,
	): Promise<GitDiffHunkLine | undefined>;
	getDiffStatus(
		repoPath: string,
		ref1?: string,
		ref2?: string,
		options?: { filters?: GitDiffFilter[] | undefined; similarityThreshold?: number | undefined },
	): Promise<GitFile[] | undefined>;
	getFileStatusForCommit(repoPath: string, fileName: string, ref: string): Promise<GitFile | undefined>;
	getLog(
		repoPath: string,
		options?: {
			all?: boolean | undefined;
			authors?: string[] | undefined;
			limit?: number | undefined;
			merges?: boolean | undefined;
			ordering?: string | null | undefined;
			ref?: string | undefined;
			reverse?: boolean | undefined;
			since?: string | undefined;
		},
	): Promise<GitLog | undefined>;
	getLogRefsOnly(
		repoPath: string,
		options?: {
			authors?: string[] | undefined;
			limit?: number | undefined;
			merges?: boolean | undefined;
			ordering?: string | null | undefined;
			ref?: string | undefined;
			reverse?: boolean | undefined;
			since?: string | undefined;
		},
	): Promise<Set<string> | undefined>;
	getLogForSearch(
		repoPath: string,
		search: SearchPattern,
		options?: { limit?: number | undefined; ordering?: string | null | undefined; skip?: number | undefined },
	): Promise<GitLog | undefined>;
	getLogForFile(
		repoPath: string,
		fileName: string,
		options?: {
			all?: boolean | undefined;
			limit?: number | undefined;
			ordering?: string | null | undefined;
			range?: Range | undefined;
			ref?: string | undefined;
			renames?: boolean | undefined;
			reverse?: boolean | undefined;
			since?: string | undefined;
			skip?: number | undefined;
		},
	): Promise<GitLog | undefined>;
	getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean | undefined },
	): Promise<string | undefined>;
	getMergeStatus(repoPath: string): Promise<GitMergeStatus | undefined>;
	getRebaseStatus(repoPath: string): Promise<GitRebaseStatus | undefined>;
	getNextDiffUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip?: number,
	): Promise<{ current: GitUri; next: GitUri | undefined; deleted?: boolean | undefined } | undefined>;
	getNextUri(repoPath: string, uri: Uri, ref?: string, skip?: number): Promise<GitUri | undefined>;
	getPreviousDiffUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip?: number,
		firstParent?: boolean,
	): Promise<{ current: GitUri; previous: GitUri | undefined } | undefined>;
	getPreviousLineDiffUris(
		repoPath: string,
		uri: Uri,
		editorLine: number,
		ref: string | undefined,
		skip?: number,
	): Promise<{ current: GitUri; previous: GitUri | undefined; line: number } | undefined>;
	getPreviousUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip?: number,
		editorLine?: number,
		firstParent?: boolean,
	): Promise<GitUri | undefined>;
	// getPullRequestForBranch(
	// 	branch: string,
	// 	remote: GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
	// 	options?: {
	// 		avatarSize?: number | undefined;
	// 		include?: PullRequestState[] | undefined;
	// 		limit?: number | undefined;
	// 		timeout?: number | undefined;
	// 	},
	// ): Promise<PullRequest | undefined>;
	// getPullRequestForBranch(
	// 	branch: string,
	// 	provider: RichRemoteProvider,
	// 	options?: {
	// 		avatarSize?: number | undefined;
	// 		include?: PullRequestState[] | undefined;
	// 		limit?: number | undefined;
	// 		timeout?: number | undefined;
	// 	},
	// ): Promise<PullRequest | undefined>;
	// getPullRequestForBranch(
	// 	branch: string,
	// 	remoteOrProvider: RichRemoteProvider | GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
	// 	options?: {
	// 		avatarSize?: number | undefined;
	// 		include?: PullRequestState[] | undefined;
	// 		limit?: number | undefined;
	// 		timeout?: number | undefined;
	// 	},
	// ): Promise<PullRequest | undefined>;
	// getPullRequestForCommit(
	// 	ref: string,
	// 	remote: GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
	// 	options?: { timeout?: number | undefined },
	// ): Promise<PullRequest | undefined>;
	// getPullRequestForCommit(
	// 	ref: string,
	// 	provider: RichRemoteProvider,
	// 	options?: { timeout?: number | undefined },
	// ): Promise<PullRequest | undefined>;
	// getPullRequestForCommit(
	// 	ref: string,
	// 	remoteOrProvider: RichRemoteProvider | GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
	// 	{ timeout }?: { timeout?: number | undefined },
	// ): Promise<PullRequest | undefined>;
	getIncomingActivity(
		repoPath: string,
		options?: {
			all?: boolean | undefined;
			branch?: string | undefined;
			limit?: number | undefined;
			ordering?: string | null | undefined;
			skip?: number | undefined;
		},
	): Promise<GitReflog | undefined>;
	getRichRemoteProvider(
		repoPath: string | undefined,
		options?: { includeDisconnected?: boolean | undefined },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	getRichRemoteProvider(
		remotes: GitRemote<RemoteProvider | RichRemoteProvider | undefined>[],
		options?: { includeDisconnected?: boolean | undefined },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	getRichRemoteProvider(
		remotesOrRepoPath: string | GitRemote<RemoteProvider | RichRemoteProvider | undefined>[] | undefined,
		options?: { includeDisconnected?: boolean | undefined },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	getRemotes(
		repoPath: string | undefined,
		options?: { sort?: boolean | undefined },
	): Promise<GitRemote<RemoteProvider>[]>;
	getRemotesCore(
		repoPath: string | undefined,
		providers?: RemoteProviders,
		options?: { sort?: boolean | undefined },
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider | undefined>[]>;
	// getRepoPath(filePath: string, options?: { ref?: string | undefined }): Promise<string | undefined>;
	// getRepoPath(uri: Uri | undefined, options?: { ref?: string | undefined }): Promise<string | undefined>;
	// getRepoPath(
	// 	filePathOrUri: string | Uri | undefined,
	// 	options?: { ref?: string | undefined },
	// ): Promise<string | undefined>;

	getRepoPath(filePath: string, isDirectory?: boolean): Promise<string | undefined>;

	// getRepoPathOrActive(uri: Uri | undefined, editor: TextEditor | undefined): Promise<string | undefined>;
	// getRepositories(predicate?: (repo: Repository) => boolean): Promise<Iterable<Repository>>;
	// getOrderedRepositories(): Promise<Repository[]>;
	// getRepository(
	// 	repoPath: string,
	// 	options?: { ref?: string | undefined; skipCacheUpdate?: boolean | undefined },
	// ): Promise<Repository | undefined>;
	// getRepository(
	// 	uri: Uri,
	// 	options?: { ref?: string | undefined; skipCacheUpdate?: boolean | undefined },
	// ): Promise<Repository | undefined>;
	// getRepository(
	// 	repoPathOrUri: string | Uri,
	// 	options?: { ref?: string | undefined; skipCacheUpdate?: boolean | undefined },
	// ): Promise<Repository | undefined>;
	// getRepository(
	// 	repoPathOrUri: string | Uri,
	// 	options?: { ref?: string | undefined; skipCacheUpdate?: boolean | undefined },
	// ): Promise<Repository | undefined>;
	// getLocalInfoFromRemoteUri(
	// 	uri: Uri,
	// 	options?: { validate?: boolean | undefined },
	// ): Promise<{ uri: Uri; startLine?: number | undefined; endLine?: number | undefined } | undefined>;
	// getRepositoryCount(): Promise<number>;
	getStash(repoPath: string | undefined): Promise<GitStash | undefined>;
	getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined>;
	getStatusForFiles(repoPath: string, pathOrGlob: string): Promise<GitStatusFile[] | undefined>;
	getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined>;
	getTags(
		repoPath: string | undefined,
		options?: { filter?: ((t: GitTag) => boolean) | undefined; sort?: boolean | TagSortOptions | undefined },
	): Promise<PagedResult<GitTag>>;
	getTreeFileForRevision(repoPath: string, fileName: string, ref: string): Promise<GitTree | undefined>;
	getTreeForRevision(repoPath: string, ref: string): Promise<GitTree[]>;
	getVersionedFileBuffer(repoPath: string, fileName: string, ref: string): Promise<Buffer | undefined>;
	getVersionedUri(repoPath: string | undefined, fileName: string, ref: string | undefined): Promise<Uri | undefined>;
	getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined>;

	hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?:
				| { branches?: ((b: GitBranch) => boolean) | undefined; tags?: ((t: GitTag) => boolean) | undefined }
				| undefined;
		},
	): Promise<boolean>;
	hasRemotes(repoPath: string | undefined): Promise<boolean>;
	hasTrackingBranch(repoPath: string | undefined): Promise<boolean>;
	isActiveRepoPath(repoPath: string | undefined, editor?: TextEditor): Promise<boolean>;

	isTrackable(uri: Uri): boolean;

	getDiffTool(repoPath?: string): Promise<string | undefined>;
	openDiffTool(
		repoPath: string,
		uri: Uri,
		options?: {
			ref1?: string | undefined;
			ref2?: string | undefined;
			staged?: boolean | undefined;
			tool?: string | undefined;
		},
	): Promise<void>;
	openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void>;

	resolveReference(
		repoPath: string,
		ref: string,
		fileName?: string,
		options?: { timeout?: number | undefined },
	): Promise<string>;
	resolveReference(
		repoPath: string,
		ref: string,
		uri?: Uri,
		options?: { timeout?: number | undefined },
	): Promise<string>;
	resolveReference(
		repoPath: string,
		ref: string,
		fileNameOrUri?: string | Uri,
		options?: { timeout?: number | undefined },
	): Promise<string>;
	validateBranchOrTagName(repoPath: string, ref: string): Promise<boolean>;
	validateReference(repoPath: string, ref: string): Promise<boolean>;

	stageFile(repoPath: string, fileName: string): Promise<void>;
	stageFile(repoPath: string, uri: Uri): Promise<void>;
	stageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<void>;
	stageDirectory(repoPath: string, directory: string): Promise<void>;
	stageDirectory(repoPath: string, uri: Uri): Promise<void>;
	stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;
	unStageFile(repoPath: string, fileName: string): Promise<void>;
	unStageFile(repoPath: string, uri: Uri): Promise<void>;
	unStageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<void>;
	unStageDirectory(repoPath: string, directory: string): Promise<void>;
	unStageDirectory(repoPath: string, uri: Uri): Promise<void>;
	unStageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;

	stashApply(repoPath: string, stashName: string, options?: { deleteAfter?: boolean | undefined }): Promise<void>;
	stashDelete(repoPath: string, stashName: string, ref?: string): Promise<void>;
	stashSave(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean | undefined; keepIndex?: boolean | undefined },
	): Promise<void>;
}
