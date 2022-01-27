import { Disposable, Event, Range, Uri, WorkspaceFolder } from 'vscode';
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
	GitTreeEntry,
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

export interface RepositoryCloseEvent {
	readonly uri: Uri;
}

export interface RepositoryOpenEvent {
	readonly uri: Uri;
}

export interface GitProvider extends Disposable {
	get onDidChangeRepository(): Event<RepositoryChangeEvent>;
	get onDidCloseRepository(): Event<RepositoryCloseEvent>;
	get onDidOpenRepository(): Event<RepositoryOpenEvent>;

	readonly descriptor: GitProviderDescriptor;
	readonly supportedSchemes: string[];

	discoverRepositories(uri: Uri): Promise<Repository[]>;
	updateContext?(): void;
	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		root: boolean,
		suspended?: boolean,
		closed?: boolean,
	): Repository;
	openRepositoryInitWatcher?(): RepositoryInitWatcher;
	getOpenScmRepositories(): Promise<ScmRepository[]>;
	getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined>;

	canHandlePathOrUri(pathOrUri: string | Uri): string | undefined;
	getAbsoluteUri(pathOrUri: string | Uri, base?: string | Uri): Uri;
	getBestRevisionUri(repoPath: string, path: string, ref: string | undefined): Promise<Uri | undefined>;
	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string;
	getRevisionUri(repoPath: string, path: string, ref: string): Uri;
	// getRootUri(pathOrUri: string | Uri): Uri;
	getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined>;

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
		...affects: ('branches' | 'contributors' | 'providers' | 'remotes' | 'stashes' | 'status' | 'tags')[]
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
	findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined>;
	getAheadBehindCommitCount(repoPath: string, refs: string[]): Promise<{ ahead: number; behind: number } | undefined>;
	/**
	 * Returns the blame of a file
	 * @param uri Uri of the file to blame
	 */
	getBlameForFile(uri: GitUri): Promise<GitBlame | undefined>;
	/**
	 * Returns the blame of a file, using the editor contents (for dirty editors)
	 * @param uri Uri of the file to blame
	 * @param contents Contents from the editor to use
	 */
	getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined>;
	/**
	 * Returns the blame of a single line
	 * @param uri Uri of the file to blame
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param options.forceSingleLine Forces blame to be for the single line (rather than the whole file)
	 */
	getBlameForLine(
		uri: GitUri,
		editorLine: number,
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
	getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined>;
	getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined>;
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined;
	getBranch(repoPath: string): Promise<GitBranch | undefined>;
	getBranches(
		repoPath: string,
		options?: {
			cursor?: string;
			filter?: ((b: GitBranch) => boolean) | undefined;
			sort?: boolean | BranchSortOptions | undefined;
		},
	): Promise<PagedResult<GitBranch>>;
	getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined>;
	getCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined>;
	getCommitBranches(
		repoPath: string,
		ref: string,
		options?: { mode?: 'contains' | 'pointsAt' | undefined; remotes?: boolean | undefined },
	): Promise<string[]>;
	getCommitCount(repoPath: string, ref: string): Promise<number | undefined>;
	getCommitForFile(
		repoPath: string,
		uri: Uri,
		options?: {
			ref?: string | undefined;
			firstIfNotFound?: boolean | undefined;
			range?: Range | undefined;
			reverse?: boolean | undefined;
		},
	): Promise<GitLogCommit | undefined>;
	getOldestUnpushedRefForFile(repoPath: string, uri: Uri): Promise<string | undefined>;
	getContributors(
		repoPath: string,
		options?: { all?: boolean | undefined; ref?: string | undefined; stats?: boolean | undefined },
	): Promise<GitContributor[]>;
	getCurrentUser(repoPath: string): Promise<GitUser | undefined>;
	getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined>;
	/**
	 * Returns a file diff between two commits
	 * @param uri Uri of the file to diff
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	getDiffForFile(uri: GitUri, ref1: string | undefined, ref2?: string): Promise<GitDiff | undefined>;
	/**
	 * Returns a file diff between a commit and the specified contents
	 * @param uri Uri of the file to diff
	 * @param ref Commit to diff from
	 * @param contents Contents to use for the diff
	 */
	getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<GitDiff | undefined>;
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
	): Promise<GitDiffHunkLine | undefined>;
	getDiffStatus(
		repoPath: string,
		ref1?: string,
		ref2?: string,
		options?: { filters?: GitDiffFilter[] | undefined; similarityThreshold?: number | undefined },
	): Promise<GitFile[] | undefined>;
	getFileStatusForCommit(repoPath: string, uri: Uri, ref: string): Promise<GitFile | undefined>;
	getLastFetchedTimestamp(repoPath: string): Promise<number | undefined>;
	getLog(
		repoPath: string,
		options?: {
			all?: boolean | undefined;
			authors?: string[] | undefined;
			cursor?: string | undefined;
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
			cursor?: string | undefined;
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
			cursor?: string | undefined;
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
	getRemotes(
		repoPath: string | undefined,
		options?: { providers?: RemoteProviders; sort?: boolean },
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider | undefined>[]>;
	getRevisionContent(repoPath: string, path: string, ref: string): Promise<Uint8Array | undefined>;
	getStash(repoPath: string | undefined): Promise<GitStash | undefined>;
	getStatusForFile(repoPath: string, path: string): Promise<GitStatusFile | undefined>;
	getStatusForFiles(repoPath: string, pathOrGlob: string): Promise<GitStatusFile[] | undefined>;
	getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined>;
	getTags(
		repoPath: string | undefined,
		options?: {
			cursor?: string;
			filter?: ((t: GitTag) => boolean) | undefined;
			sort?: boolean | TagSortOptions | undefined;
		},
	): Promise<PagedResult<GitTag>>;
	getTreeEntryForRevision(repoPath: string, path: string, ref: string): Promise<GitTreeEntry | undefined>;
	getTreeForRevision(repoPath: string, ref: string): Promise<GitTreeEntry[]>;

	hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?:
				| { branches?: ((b: GitBranch) => boolean) | undefined; tags?: ((t: GitTag) => boolean) | undefined }
				| undefined;
		},
	): Promise<boolean>;

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
		pathOrUri?: string | Uri,
		options?: { timeout?: number | undefined },
	): Promise<string>;
	validateBranchOrTagName(repoPath: string, ref: string): Promise<boolean>;
	validateReference(repoPath: string, ref: string): Promise<boolean>;

	stageFile(repoPath: string, pathOrUri: string | Uri): Promise<void>;
	stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;
	unStageFile(repoPath: string, pathOrUri: string | Uri): Promise<void>;
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

export interface RevisionUriData {
	ref?: string;
	repoPath: string;
}
