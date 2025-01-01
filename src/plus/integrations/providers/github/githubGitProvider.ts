/* eslint-disable @typescript-eslint/require-await */
import { encodeUtf8Hex } from '@env/hex';
import { isWeb } from '@env/platform';
import type {
	AuthenticationSession,
	CancellationToken,
	Disposable,
	Event,
	Range,
	TextDocument,
	WorkspaceFolder,
} from 'vscode';
import { EventEmitter, FileType, Uri, window, workspace } from 'vscode';
import { CharCode, Schemes } from '../../../../constants';
import { HostingIntegrationId } from '../../../../constants.integrations';
import type { SearchOperators, SearchQuery } from '../../../../constants.search';
import type { Container } from '../../../../container';
import { emojify } from '../../../../emojis';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ExtensionNotFoundError,
	OpenVirtualRepositoryError,
	OpenVirtualRepositoryErrorReason,
} from '../../../../errors';
import { Features } from '../../../../features';
import { GitSearchError } from '../../../../git/errors';
import type {
	GitCaches,
	GitProvider,
	LeftRightCommitCountResult,
	NextComparisonUrisResult,
	PagedResult,
	PagingOptions,
	PreviousComparisonUrisResult,
	PreviousLineComparisonUrisResult,
	RepositoryCloseEvent,
	RepositoryOpenEvent,
	RepositoryVisibility,
	ScmRepository,
} from '../../../../git/gitProvider';
import { GitUri } from '../../../../git/gitUri';
import { decodeRemoteHubAuthority } from '../../../../git/gitUri.authority';
import type { GitBlame, GitBlameAuthor, GitBlameLine } from '../../../../git/models/blame';
import { GitBranch } from '../../../../git/models/branch';
import { getBranchId, getBranchNameWithoutRemote } from '../../../../git/models/branch.utils';
import type { GitCommitLine, GitStashCommit } from '../../../../git/models/commit';
import { GitCommit, GitCommitIdentity } from '../../../../git/models/commit';
import { getChangedFilesCount } from '../../../../git/models/commit.utils';
import type { GitContributorStats } from '../../../../git/models/contributor';
import { GitContributor } from '../../../../git/models/contributor';
import type { GitDiffFile, GitDiffFilter, GitDiffLine, GitDiffShortStat } from '../../../../git/models/diff';
import type { GitFile } from '../../../../git/models/file';
import { GitFileChange, GitFileIndexStatus } from '../../../../git/models/file';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowContexts,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowStats,
	GitGraphRowTag,
} from '../../../../git/models/graph';
import type { GitLog } from '../../../../git/models/log';
import type { GitMergeStatus } from '../../../../git/models/merge';
import type { GitRebaseStatus } from '../../../../git/models/rebase';
import type { GitReference } from '../../../../git/models/reference';
import { createReference } from '../../../../git/models/reference.utils';
import type { GitReflog } from '../../../../git/models/reflog';
import { getVisibilityCacheKey, GitRemote } from '../../../../git/models/remote';
import type { RepositoryChangeEvent } from '../../../../git/models/repository';
import { Repository } from '../../../../git/models/repository';
import type { GitRevisionRange } from '../../../../git/models/revision';
import { deletedOrMissing, uncommitted } from '../../../../git/models/revision';
import {
	createRevisionRange,
	getRevisionRangeParts,
	isRevisionRange,
	isSha,
	isShaLike,
	isUncommitted,
} from '../../../../git/models/revision.utils';
import type { GitStatusFile } from '../../../../git/models/status';
import { GitStatus } from '../../../../git/models/status';
import { getTagId, GitTag } from '../../../../git/models/tag';
import type { GitTreeEntry } from '../../../../git/models/tree';
import type { GitUser } from '../../../../git/models/user';
import { isUserMatch } from '../../../../git/models/user';
import type { GitWorktree } from '../../../../git/models/worktree';
import { getRemoteProviderMatcher, loadRemoteProviders } from '../../../../git/remotes/remoteProviders';
import type { GitSearch, GitSearchResultData, GitSearchResults } from '../../../../git/search';
import { getSearchQueryComparisonKey, parseSearchQuery } from '../../../../git/search';
import { getRemoteIconUri } from '../../../../git/utils/icons';
import type { BranchSortOptions, TagSortOptions } from '../../../../git/utils/sorting';
import { sortBranches, sortTags } from '../../../../git/utils/sorting';
import { gate } from '../../../../system/decorators/gate';
import { debug, log } from '../../../../system/decorators/log';
import { filterMap, first, last, map, some, union } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import type { LogScope } from '../../../../system/logger.scope';
import { getLogScope } from '../../../../system/logger.scope';
import { isAbsolute, isFolderGlob, maybeUri, normalizePath } from '../../../../system/path';
import { asSettled, getSettledValue } from '../../../../system/promise';
import { configuration } from '../../../../system/vscode/configuration';
import { setContext } from '../../../../system/vscode/context';
import { relative } from '../../../../system/vscode/path';
import { serializeWebviewItemContext } from '../../../../system/webview';
import type { CachedBlame, CachedLog, TrackedGitDocument } from '../../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../../trackers/trackedDocument';
import type {
	GraphBranchContextValue,
	GraphItemContext,
	GraphItemRefContext,
	GraphTagContextValue,
} from '../../../../webviews/plus/graph/protocol';
import type { GitHubAuthorityMetadata, Metadata, RemoteHubApi } from '../../../remotehub';
import { getRemoteHubApi, HeadType, RepositoryRefType } from '../../../remotehub';
import type {
	IntegrationAuthenticationService,
	IntegrationAuthenticationSessionDescriptor,
} from '../../authentication/integrationAuthentication';
import type { GitHubApi } from './github';
import type { GitHubBranch } from './models';
import { fromCommitFileStatus } from './models';

const doubleQuoteRegex = /"/g;
const emptyArray = Object.freeze([]) as unknown as any[];
const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
const emptyPromise: Promise<GitBlame | GitDiffFile | GitLog | undefined> = Promise.resolve(undefined);

const githubAuthenticationScopes = ['repo', 'read:user', 'user:email'];

// Since negative lookbehind isn't supported in all browsers, this leaves out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// eslint-disable-next-line no-control-regex
const validBranchOrTagRegex = /^[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]$/;

interface RepositoryInfo {
	user?: GitUser | null;
}

export class GitHubGitProvider implements GitProvider, Disposable {
	descriptor = { id: 'github' as const, name: 'GitHub', virtual: true };
	readonly authenticationDescriptor: IntegrationAuthenticationSessionDescriptor = {
		domain: 'github.com',
		scopes: githubAuthenticationScopes,
	};
	readonly authenticationProviderId = HostingIntegrationId.GitHub;
	readonly supportedSchemes = new Set<string>([Schemes.Virtual, Schemes.GitHub, Schemes.PRs]);

	private _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private _onWillChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onWillChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onWillChangeRepository.event;
	}

	private _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private _onDidCloseRepository = new EventEmitter<RepositoryCloseEvent>();
	get onDidCloseRepository(): Event<RepositoryCloseEvent> {
		return this._onDidCloseRepository.event;
	}

	private _onDidOpenRepository = new EventEmitter<RepositoryOpenEvent>();
	get onDidOpenRepository(): Event<RepositoryOpenEvent> {
		return this._onDidOpenRepository.event;
	}

	private readonly _branchCache = new Map<string, Promise<GitBranch | undefined>>();
	private readonly _branchesCache = new Map<string, Promise<PagedResult<GitBranch>>>();
	private readonly _repoInfoCache = new Map<string, RepositoryInfo>();
	private readonly _tagsCache = new Map<string, Promise<PagedResult<GitTag>>>();

	private readonly _disposables: Disposable[] = [];

	constructor(
		private readonly container: Container,
		private readonly authenticationService: IntegrationAuthenticationService,
	) {
		this._disposables.push(
			this.container.events.on('git:cache:reset', e =>
				e.data.repoPath
					? this.resetCache(e.data.repoPath, ...(e.data.caches ?? emptyArray))
					: this.resetCaches(...(e.data.caches ?? emptyArray)),
			),
		);
		void authenticationService.get(this.authenticationProviderId).then(authProvider => {
			this._disposables.push(authProvider.onDidChange(this.onAuthenticationSessionsChanged, this));
		});
	}

	dispose() {
		this._disposables.forEach(d => void d.dispose());
	}

	private onAuthenticationSessionsChanged() {
		this._sessionPromise = undefined;
		void this.ensureSession(false, true);
	}

	private onRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		// if (e.changed(RepositoryChange.Config, RepositoryChangeComparisonMode.Any)) {
		// 	this._repoInfoCache.delete(repo.path);
		// }

		// if (e.changed(RepositoryChange.Heads, RepositoryChange.Remotes, RepositoryChangeComparisonMode.Any)) {
		// 	this._branchesCache.delete(repo.path);
		// }

		this._branchCache.delete(repo.path);
		this._branchesCache.delete(repo.path);
		this._tagsCache.delete(repo.path);
		this._repoInfoCache.delete(repo.path);

		this._onWillChangeRepository.fire(e);
	}

	async discoverRepositories(
		uri: Uri,
		options?: { cancellation?: CancellationToken; depth?: number; silent?: boolean },
	): Promise<Repository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		try {
			const { remotehub } = await this.ensureRepositoryContext(uri.toString(), true);
			const workspaceUri = remotehub.getVirtualWorkspaceUri(uri);
			if (workspaceUri == null) return [];

			return this.openRepository(undefined, workspaceUri, true, undefined, options?.silent);
		} catch (ex) {
			if (ex.message.startsWith('No provider registered with')) {
				Logger.error(
					ex,
					'No GitHub provider registered with Remote Repositories (yet); queuing pending discovery',
				);
				this._pendingDiscovery.add(uri);
				this.ensurePendingRepositoryDiscovery();
			}
			return [];
		}
	}

	private _pendingDiscovery = new Set<Uri>();
	private _pendingTimer: ReturnType<typeof setTimeout> | undefined;
	private ensurePendingRepositoryDiscovery() {
		if (this._pendingTimer != null || this._pendingDiscovery.size === 0) return;

		this._pendingTimer = setTimeout(async () => {
			try {
				const remotehub = await getRemoteHubApi();

				for (const uri of this._pendingDiscovery) {
					if (remotehub.getProvider(uri) == null) {
						this._pendingTimer = undefined;
						this.ensurePendingRepositoryDiscovery();
						return;
					}

					this._pendingDiscovery.delete(uri);
				}

				this._pendingTimer = undefined;

				setTimeout(() => this._onDidChange.fire(), 1);

				if (this._pendingDiscovery.size !== 0) {
					this.ensurePendingRepositoryDiscovery();
				}
			} catch {
				debugger;
				this._pendingTimer = undefined;
				this.ensurePendingRepositoryDiscovery();
			}
		}, 250);
	}

	updateContext(): void {
		void setContext('gitlens:hasVirtualFolders', this.container.git.hasOpenRepositories(this.descriptor.id));
	}

	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		root: boolean,
		suspended?: boolean,
		closed?: boolean,
	): Repository[] {
		return [
			new Repository(
				this.container,
				{
					onDidRepositoryChange: this._onDidChangeRepository,
					onRepositoryChanged: this.onRepositoryChanged.bind(this),
				},
				this.descriptor,
				folder ?? workspace.getWorkspaceFolder(uri),
				uri,
				root,
				suspended ?? !window.state.focused,
				closed,
			),
		];
	}

	// private _supportedFeatures = new Map<Features, boolean>();
	async supports(feature: Features): Promise<boolean> {
		// const supported = this._supportedFeatures.get(feature);
		// if (supported != null) return supported;

		switch (feature) {
			case Features.Stashes:
			case Features.Worktrees:
			case Features.StashOnlyStaged:
				return false;
			default:
				return true;
		}
	}

	async visibility(repoPath: string): Promise<[visibility: RepositoryVisibility, cacheKey: string | undefined]> {
		const remotes = await this.getRemotes(repoPath, { sort: true });
		if (remotes.length === 0) return ['local', undefined];

		for await (const result of asSettled(remotes.map(r => this.getRemoteVisibility(r)))) {
			if (result.status !== 'fulfilled') continue;

			if (result.value[0] === 'public') {
				return ['public', getVisibilityCacheKey(result.value[1])];
			}
		}

		return ['private', getVisibilityCacheKey(remotes)];
	}

	private async getRemoteVisibility(
		remote: GitRemote,
	): Promise<[visibility: RepositoryVisibility, remote: GitRemote]> {
		switch (remote.provider?.id) {
			case 'github': {
				const { github, metadata, session } = await this.ensureRepositoryContext(remote.repoPath);
				const visibility = await github.getRepositoryVisibility(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
				);

				return [visibility ?? 'private', remote];
			}
			default:
				return ['private', remote];
		}
	}

	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		return [];
	}

	async getScmRepository(_repoPath: string): Promise<ScmRepository | undefined> {
		return undefined;
	}

	async getOrOpenScmRepository(_repoPath: string): Promise<ScmRepository | undefined> {
		return undefined;
	}

	canHandlePathOrUri(scheme: string, pathOrUri: string | Uri): string | undefined {
		if (!this.supportedSchemes.has(scheme)) return undefined;
		return typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.toString();
	}

	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri {
		// Convert the base to a Uri if it isn't one
		if (typeof base === 'string') {
			// If it looks like a Uri parse it, otherwise throw
			if (maybeUri(base)) {
				base = Uri.parse(base, true);
			} else {
				debugger;
				void window.showErrorMessage(
					`Unable to get absolute uri between ${
						typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.toString(true)
					} and ${base}; Base path '${base}' must be a uri`,
				);
				throw new Error(`Base path '${base}' must be a uri`);
			}
		}

		if (typeof pathOrUri === 'string' && !maybeUri(pathOrUri)) {
			const normalized = normalizePath(pathOrUri);
			if (!isAbsolute(normalized)) return Uri.joinPath(base, normalized);
		}

		const relativePath = this.getRelativePath(pathOrUri, base);
		return Uri.joinPath(base, relativePath);
	}

	@log()
	async getBestRevisionUri(repoPath: string, path: string, ref: string | undefined): Promise<Uri | undefined> {
		return ref ? this.createProviderUri(repoPath, ref, path) : this.createVirtualUri(repoPath, ref, path);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		// Convert the base to a Uri if it isn't one
		if (typeof base === 'string') {
			// If it looks like a Uri parse it, otherwise throw
			if (maybeUri(base)) {
				base = Uri.parse(base, true);
			} else {
				debugger;
				void window.showErrorMessage(
					`Unable to get relative path between ${
						typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.toString(true)
					} and ${base}; Base path '${base}' must be a uri`,
				);
				throw new Error(`Base path '${base}' must be a uri`);
			}
		}

		let relativePath;

		// Convert the path to a Uri if it isn't one
		if (typeof pathOrUri === 'string') {
			if (maybeUri(pathOrUri)) {
				pathOrUri = Uri.parse(pathOrUri, true);
			} else {
				pathOrUri = normalizePath(pathOrUri);
				relativePath =
					isAbsolute(pathOrUri) && pathOrUri.startsWith(base.path)
						? pathOrUri.slice(base.path.length)
						: pathOrUri;
				if (relativePath.charCodeAt(0) === CharCode.Slash) {
					relativePath = relativePath.slice(1);
				}
				return relativePath;
			}
		}

		relativePath = normalizePath(relative(base.path.slice(1), pathOrUri.path.slice(1)));
		return relativePath;
	}

	getRevisionUri(repoPath: string, path: string, ref: string): Uri {
		const uri = this.createProviderUri(repoPath, ref, path);
		return ref === deletedOrMissing ? uri.with({ query: '~' }) : uri;
	}

	@log()
	async getWorkingUri(repoPath: string, uri: Uri) {
		return this.createVirtualUri(repoPath, undefined, uri.path);
	}

	@log()
	async branchContainsCommit(_repoPath: string, _name: string, _ref: string): Promise<boolean> {
		return false;
	}

	@log({ singleLine: true })
	private resetCache(
		repoPath: string,
		...caches: ('branches' | 'contributors' | 'providers' | 'remotes' | 'stashes' | 'status' | 'tags')[]
	) {
		if (caches.length === 0 || caches.includes('branches')) {
			this._branchCache.delete(repoPath);
			this._branchesCache.delete(repoPath);
		}

		if (caches.length === 0 || caches.includes('tags')) {
			this._tagsCache.delete(repoPath);
		}

		if (caches.length === 0) {
			this._repoInfoCache.delete(repoPath);
		}
	}

	@log({ singleLine: true })
	private resetCaches(...caches: GitCaches[]): void {
		if (caches.length === 0 || caches.includes('branches')) {
			this._branchCache.clear();
			this._branchesCache.clear();
		}

		if (caches.length === 0 || caches.includes('tags')) {
			this._tagsCache.clear();
		}

		if (caches.length === 0) {
			this._repoInfoCache.clear();
		}
	}

	@log<GitHubGitProvider['excludeIgnoredUris']>({ args: { 1: uris => uris.length } })
	async excludeIgnoredUris(_repoPath: string, uris: Uri[]): Promise<Uri[]> {
		return uris;
	}

	@gate()
	@debug()
	async findRepositoryUri(uri: Uri, _isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getLogScope();

		try {
			const remotehub = await this.ensureRemoteHubApi();

			return await ensureProviderLoaded(uri, remotehub, uri =>
				remotehub.getProviderRootUri(uri).with({ scheme: Schemes.Virtual }),
			);
		} catch (ex) {
			if (!(ex instanceof ExtensionNotFoundError)) {
				debugger;
			}
			Logger.error(ex, scope);

			return undefined;
		}
	}

	@log()
	async getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		_options?: { authors?: GitUser[] | undefined; excludeMerges?: boolean },
	): Promise<LeftRightCommitCountResult | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(range),
			);

			if (result == null) return undefined;

			return {
				left: result.behind_by,
				right: result.ahead_by,
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@gate<GitHubGitProvider['getBlame']>((u, d) => `${u.toString()}|${d?.isDirty}`)
	@log<GitHubGitProvider['getBlame']>({ args: { 1: d => d?.isDirty } })
	async getBlame(uri: GitUri, document?: TextDocument | undefined): Promise<GitBlame | undefined> {
		const scope = getLogScope();

		// TODO@eamodio we need to figure out when to do this, since dirty isn't enough, we need to know if there are any uncommitted changes
		if (document?.isDirty) return undefined; //this.getBlameContents(uri, document.getText());

		let key = 'blame';
		if (uri.sha != null) {
			key += `:${uri.sha}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (doc.state != null) {
			const cachedBlame = doc.state.getBlame(key);
			if (cachedBlame != null) {
				Logger.debug(scope, `Cache hit: '${key}'`);
				return cachedBlame.item;
			}
		}

		Logger.debug(scope, `Cache miss: '${key}'`);

		if (doc.state == null) {
			doc.state = new GitDocumentState();
		}

		const promise = this.getBlameCore(uri, doc, key, scope);

		if (doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedBlame = {
				item: promise as Promise<GitBlame>,
			};
			doc.state.setBlame(key, value);
		}

		return promise;
	}

	private async getBlameCore(
		uri: GitUri,
		document: TrackedGitDocument,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitBlame | undefined> {
		try {
			const context = await this.ensureRepositoryContext(uri.repoPath!);
			if (context == null) return undefined;
			const { metadata, github, remotehub, session } = context;

			const root = remotehub.getVirtualUri(remotehub.getProviderRootUri(uri));
			const relativePath = this.getRelativePath(uri, root);

			if (uri.scheme === Schemes.Virtual) {
				const [working, committed] = await Promise.allSettled([
					workspace.fs.stat(uri),
					workspace.fs.stat(uri.with({ scheme: Schemes.GitHub })),
				]);
				if (
					working.status !== 'fulfilled' ||
					committed.status !== 'fulfilled' ||
					working.value.mtime !== committed.value.mtime
				) {
					return undefined;
				}
			}

			const ref = !uri.sha || uri.sha === 'HEAD' ? (await metadata.getRevision()).revision : uri.sha;
			const blame = await github.getBlame(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				ref,
				relativePath,
			);

			const authors = new Map<string, GitBlameAuthor>();
			const commits = new Map<string, GitCommit>();
			const lines: GitCommitLine[] = [];

			for (const range of blame.ranges) {
				const c = range.commit;

				const { viewer = session.account.label } = blame;
				const authorName = viewer != null && c.author.name === viewer ? 'You' : c.author.name;
				const committerName = viewer != null && c.committer.name === viewer ? 'You' : c.committer.name;

				let author = authors.get(authorName);
				if (author == null) {
					author = {
						name: authorName,
						lineCount: 0,
					};
					authors.set(authorName, author);
				}

				author.lineCount += range.endingLine - range.startingLine + 1;

				let commit = commits.get(c.oid);
				if (commit == null) {
					commit = new GitCommit(
						this.container,
						uri.repoPath!,
						c.oid,
						new GitCommitIdentity(authorName, c.author.email, new Date(c.author.date), c.author.avatarUrl),
						new GitCommitIdentity(committerName, c.committer.email, new Date(c.author.date)),
						c.message.split('\n', 1)[0],
						c.parents.nodes[0]?.oid ? [c.parents.nodes[0]?.oid] : [],
						c.message,
						new GitFileChange(root.toString(), relativePath, GitFileIndexStatus.Modified),
						{ files: c.changedFiles ?? 0, additions: c.additions ?? 0, deletions: c.deletions ?? 0 },
						[],
					);

					commits.set(c.oid, commit);
				}

				for (let i = range.startingLine; i <= range.endingLine; i++) {
					// GitHub doesn't currently support returning the original line number, so we are just using the current one
					const line: GitCommitLine = { sha: c.oid, originalLine: i, line: i };

					commit.lines.push(line);
					lines[i - 1] = line;
				}
			}

			const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

			return {
				repoPath: uri.repoPath!,
				authors: sortedAuthors,
				commits: commits,
				lines: lines,
			};
		} catch (ex) {
			debugger;
			// Trap and cache expected blame errors
			if (document.state != null && !String(ex).includes('No provider registered with')) {
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.setBlame(key, value);

				document.setBlameFailure(ex);

				return emptyPromise as Promise<GitBlame>;
			}

			return undefined;
		}
	}

	@log<GitHubGitProvider['getBlameContents']>({ args: { 1: '<contents>' } })
	async getBlameContents(_uri: GitUri, _contents: string): Promise<GitBlame | undefined> {
		// TODO@eamodio figure out how to actually generate a blame given the contents (need to generate a diff)
		return undefined; //this.getBlame(uri);
	}

	@gate<GitHubGitProvider['getBlameForLine']>(
		(u, l, d, o) => `${u.toString()}|${l}|${d?.isDirty}|${o?.forceSingleLine}`,
	)
	@log<GitHubGitProvider['getBlameForLine']>({ args: { 2: d => d?.isDirty } })
	async getBlameForLine(
		uri: GitUri,
		editorLine: number, // 0-based, Git is 1-based
		document?: TextDocument | undefined,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		const scope = getLogScope();

		// TODO@eamodio we need to figure out when to do this, since dirty isn't enough, we need to know if there are any uncommitted changes
		if (document?.isDirty) return undefined; //this.getBlameForLineContents(uri, editorLine, document.getText(), options);

		if (!options?.forceSingleLine) {
			const blame = await this.getBlame(uri);
			if (blame == null) return undefined;

			let blameLine = blame.lines[editorLine];
			if (blameLine == null) {
				if (blame.lines.length !== editorLine) return undefined;
				blameLine = blame.lines[editorLine - 1];
			}

			const commit = blame.commits.get(blameLine.sha);
			if (commit == null) return undefined;

			const author = blame.authors.get(commit.author.name)!;
			return {
				author: { ...author, lineCount: commit.lines.length },
				commit: commit,
				line: blameLine,
			};
		}

		try {
			const context = await this.ensureRepositoryContext(uri.repoPath!);
			if (context == null) return undefined;
			const { metadata, github, remotehub, session } = context;

			const root = remotehub.getVirtualUri(remotehub.getProviderRootUri(uri));
			const relativePath = this.getRelativePath(uri, root);

			const ref = !uri.sha || uri.sha === 'HEAD' ? (await metadata.getRevision()).revision : uri.sha;
			const blame = await github.getBlame(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				ref,
				relativePath,
			);

			const startingLine = editorLine + 1;
			const range = blame.ranges.find(r => r.startingLine === startingLine);
			if (range == null) return undefined;

			const c = range.commit;

			const { viewer = session.account.label } = blame;
			const authorName = viewer != null && c.author.name === viewer ? 'You' : c.author.name;
			const committerName = viewer != null && c.committer.name === viewer ? 'You' : c.committer.name;

			const commit = new GitCommit(
				this.container,
				uri.repoPath!,
				c.oid,
				new GitCommitIdentity(authorName, c.author.email, new Date(c.author.date), c.author.avatarUrl),
				new GitCommitIdentity(committerName, c.committer.email, new Date(c.author.date)),
				c.message.split('\n', 1)[0],
				c.parents.nodes[0]?.oid ? [c.parents.nodes[0]?.oid] : [],
				c.message,
				new GitFileChange(root.toString(), relativePath, GitFileIndexStatus.Modified),
				{ files: c.changedFiles ?? 0, additions: c.additions ?? 0, deletions: c.deletions ?? 0 },
				[],
			);

			for (let i = range.startingLine; i <= range.endingLine; i++) {
				// GitHub doesn't currently support returning the original line number, so we are just using the current one
				const line: GitCommitLine = { sha: c.oid, originalLine: i, line: i };

				commit.lines.push(line);
			}

			return {
				author: {
					name: authorName,
					lineCount: range.endingLine - range.startingLine + 1,
				},
				commit: commit,
				// GitHub doesn't currently support returning the original line number, so we are just using the current one
				line: { sha: c.oid, originalLine: range.startingLine, line: range.startingLine },
			};
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log<GitHubGitProvider['getBlameForLineContents']>({ args: { 2: '<contents>' } })
	async getBlameForLineContents(
		_uri: GitUri,
		_editorLine: number, // 0-based, Git is 1-based
		_contents: string,
		_options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		// TODO@eamodio figure out how to actually generate a blame given the contents (need to generate a diff)
		return undefined; //this.getBlameForLine(uri, editorLine);
	}

	@log()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlame | undefined> {
		const blame = await this.getBlame(uri);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@log<GitHubGitProvider['getBlameForRangeContents']>({ args: { 2: '<contents>' } })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlame | undefined> {
		const blame = await this.getBlameContents(uri, contents);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@log<GitHubGitProvider['getBlameRange']>({ args: { 0: '<blame>' } })
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlame | undefined {
		if (blame.lines.length === 0) return blame;

		if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
			return blame;
		}

		const lines = blame.lines.slice(range.start.line, range.end.line + 1);
		const shas = new Set(lines.map(l => l.sha));

		// ranges are 0-based
		const startLine = range.start.line + 1;
		const endLine = range.end.line + 1;

		const authors = new Map<string, GitBlameAuthor>();
		const commits = new Map<string, GitCommit>();
		for (const c of blame.commits.values()) {
			if (!shas.has(c.sha)) continue;

			const commit = c.with({
				lines: c.lines.filter(l => l.line >= startLine && l.line <= endLine),
			});
			commits.set(c.sha, commit);

			let author = authors.get(commit.author.name);
			if (author == null) {
				author = {
					name: commit.author.name,
					lineCount: 0,
				};
				authors.set(author.name, author);
			}

			author.lineCount += commit.lines.length;
		}

		const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

		return {
			repoPath: uri.repoPath!,
			authors: sortedAuthors,
			commits: commits,
			lines: lines,
		};
	}

	@log()
	async getBranch(repoPath: string): Promise<GitBranch | undefined> {
		let branchPromise = this._branchCache.get(repoPath);
		if (branchPromise == null) {
			async function load(this: GitHubGitProvider): Promise<GitBranch | undefined> {
				const {
					values: [branch],
				} = await this.getBranches(repoPath, { filter: b => b.current });
				if (branch != null) return branch;

				try {
					const { metadata } = await this.ensureRepositoryContext(repoPath);

					const revision = await metadata.getRevision();
					switch (revision.type) {
						case HeadType.Tag:
						case HeadType.Commit:
							return new GitBranch(
								this.container,
								repoPath,
								revision.name,
								false,
								true,
								undefined,
								revision.revision,
								undefined,
								undefined,
								undefined,
								true,
							);
					}

					return undefined;
				} catch (ex) {
					debugger;
					Logger.error(ex, getLogScope());
					return undefined;
				}
			}

			branchPromise = load.call(this);
			this._branchCache.set(repoPath, branchPromise);
		}

		return branchPromise;
	}

	@log({ args: { 1: false } })
	async getBranches(
		repoPath: string | undefined,
		options?: {
			filter?: (b: GitBranch) => boolean;
			paging?: PagingOptions;
			sort?: boolean | BranchSortOptions;
		},
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getLogScope();

		let branchesPromise = options?.paging?.cursor ? undefined : this._branchesCache.get(repoPath);
		if (branchesPromise == null) {
			async function load(this: GitHubGitProvider): Promise<PagedResult<GitBranch>> {
				try {
					const { metadata, github, session } = await this.ensureRepositoryContext(repoPath!);

					const branches: GitBranch[] = [];

					function addBranches(container: Container, branch: GitHubBranch, current: boolean) {
						const date = new Date(
							configuration.get('advanced.commitOrdering') === 'author-date'
								? branch.target.authoredDate
								: branch.target.committedDate,
						);
						const ref = branch.target.oid;

						branches.push(
							new GitBranch(container, repoPath!, branch.name, false, current, date, ref, {
								name: `origin/${branch.name}`,
								missing: false,
							}),
							new GitBranch(container, repoPath!, `origin/${branch.name}`, true, false, date, ref),
						);
					}

					let currentBranch: string | undefined;

					const revision = await metadata.getRevision();
					switch (revision.type) {
						case HeadType.Branch:
							currentBranch = revision.name;
							break;
						case HeadType.RemoteBranch: {
							const index = revision.name.indexOf(':');
							currentBranch = index === -1 ? revision.name : revision.name.substring(index + 1);
							break;
						}
					}

					let cursor = options?.paging?.cursor;
					const loadAll = cursor == null;

					while (true) {
						const result = await github.getBranches(
							session.accessToken,
							metadata.repo.owner,
							metadata.repo.name,
							{ cursor: cursor },
						);

						for (const branch of result.values) {
							addBranches(this.container, branch, branch.name === currentBranch);
						}

						if (!result.paging?.more || !loadAll) return { ...result, values: branches };

						cursor = result.paging.cursor;
					}
				} catch (ex) {
					Logger.error(ex, scope);
					debugger;

					this._branchesCache.delete(repoPath!);
					return emptyPagedResult;
				}
			}

			branchesPromise = load.call(this);
			if (options?.paging?.cursor == null) {
				this._branchesCache.set(repoPath, branchesPromise);
			}
		}

		let result = await branchesPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort != null) {
			sortBranches(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@log()
	async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
		// TODO@eamodio if there is no ref we can't return anything, until we can get at the change store from RemoteHub
		if (!ref) return undefined;

		const commit = await this.getCommit(repoPath, ref);
		if (commit?.stats == null) return undefined;

		const { stats } = commit;

		const changedFiles = getChangedFilesCount(stats.files);
		return { additions: stats.additions, deletions: stats.deletions, files: changedFiles };
	}

	@log()
	async getCommit(repoPath: string, ref: string): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const commit = await github.getCommit(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(ref),
			);
			if (commit == null) return undefined;

			const { viewer = session.account.label } = commit;
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			return new GitCommit(
				this.container,
				repoPath,
				commit.oid,
				new GitCommitIdentity(
					authorName,
					commit.author.email,
					new Date(commit.author.date),
					commit.author.avatarUrl,
				),
				new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
				commit.message.split('\n', 1)[0],
				commit.parents.nodes.map(p => p.oid),
				commit.message,
				commit.files?.map(
					f =>
						new GitFileChange(
							repoPath,
							f.filename ?? '',
							fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
							f.previous_filename,
							undefined,
							{ additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: f.changes ?? 0 },
						),
				) ?? [],
				{
					files: commit.changedFiles ?? 0,
					additions: commit.additions ?? 0,
					deletions: commit.deletions ?? 0,
				},
				[],
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getCommitBranches(
		repoPath: string,
		refs: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		if (repoPath == null || options?.commitDate == null) return [];

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			let branches;

			if (branch) {
				branches = await github.getCommitOnBranch(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
					branch,
					refs.map(stripOrigin),
					options?.mode ?? 'contains',
					options?.commitDate,
				);
			} else {
				branches = await github.getCommitBranches(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
					refs.map(stripOrigin),
					options?.mode ?? 'contains',
					options?.commitDate,
				);
			}

			return branches;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@log()
	async getCommitCount(repoPath: string, ref: string): Promise<number | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const count = await github.getCommitCount(
				session?.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(ref),
			);

			return count;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getCommitForFile(
		repoPath: string | undefined,
		uri: Uri,
		options?: { ref?: string; firstIfNotFound?: boolean; range?: Range },
	): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, remotehub, session } = await this.ensureRepositoryContext(repoPath);

			const file = this.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			const ref = !options?.ref || options.ref === 'HEAD' ? (await metadata.getRevision()).revision : options.ref;
			const commit = await github.getCommitForFile(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(ref),
				file,
			);
			if (commit == null) return undefined;

			const { viewer = session.account.label } = commit;
			const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
			const committerName = viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

			const files = commit.files?.map(
				f =>
					new GitFileChange(
						repoPath,
						f.filename ?? '',
						fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
						f.previous_filename,
						undefined,
						{ additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: f.changes ?? 0 },
					),
			);
			const foundFile = files?.find(f => f.path === file);

			return new GitCommit(
				this.container,
				repoPath,
				commit.oid,
				new GitCommitIdentity(
					authorName,
					commit.author.email,
					new Date(commit.author.date),
					commit.author.avatarUrl,
				),
				new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
				commit.message.split('\n', 1)[0],
				commit.parents.nodes.map(p => p.oid),
				commit.message,
				{ file: foundFile, files: files },
				{
					files: commit.changedFiles ?? 0,
					additions: commit.additions ?? 0,
					deletions: commit.deletions ?? 0,
				},
				[],
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getCommitsForGraph(
		repoPath: string,
		asWebviewUri: (uri: Uri) => Uri,
		options?: {
			include?: { stats?: boolean };
			limit?: number;
			ref?: string;
		},
	): Promise<GitGraph> {
		const defaultLimit = options?.limit ?? configuration.get('graph.defaultItemLimit') ?? 5000;
		// const defaultPageLimit = configuration.get('graph.pageItemLimit') ?? 1000;
		const ordering = configuration.get('graph.commitOrdering', undefined, 'date');
		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const [logResult, headBranchResult, branchesResult, remotesResult, tagsResult, currentUserResult] =
			await Promise.allSettled([
				this.getLog(repoPath, { all: true, ordering: ordering, limit: defaultLimit }),
				this.getBranch(repoPath),
				this.getBranches(repoPath, { filter: b => b.remote }),
				this.getRemotes(repoPath),
				this.getTags(repoPath),
				this.getCurrentUser(repoPath),
			]);

		const avatars = new Map<string, string>();
		const headBranch = getSettledValue(headBranchResult)!;

		const branchMap = new Map<string, GitBranch>();
		const branchTips = new Map<string, string[]>();
		if (headBranch != null) {
			branchMap.set(headBranch.name, headBranch);
			if (headBranch.sha != null) {
				branchTips.set(headBranch.sha, [headBranch.name]);
			}
		}

		const branches = getSettledValue(branchesResult)?.values;
		if (branches != null) {
			for (const branch of branches) {
				branchMap.set(branch.name, branch);
				if (branch.sha == null) continue;

				const bts = branchTips.get(branch.sha);
				if (bts == null) {
					branchTips.set(branch.sha, [branch.name]);
				} else {
					bts.push(branch.name);
				}
			}
		}

		const ids = new Set<string>();
		const remote = getSettledValue(remotesResult)![0];
		const remoteMap = remote != null ? new Map([[remote.name, remote]]) : new Map<string, GitRemote>();
		const rowStats = new Map<string, GitGraphRowStats>();
		const tagTips = new Map<string, string[]>();
		const tags = getSettledValue(tagsResult)?.values;
		if (tags != null) {
			for (const tag of tags) {
				if (tag.sha == null) continue;

				const tts = tagTips.get(tag.sha);
				if (tts == null) {
					tagTips.set(tag.sha, [tag.name]);
				} else {
					tts.push(tag.name);
				}
			}
		}

		return this.getCommitsForGraphCore(
			repoPath,
			asWebviewUri,
			getSettledValue(logResult),
			headBranch,
			branchMap,
			branchTips,
			remote,
			remoteMap,
			rowStats,
			tagTips,
			getSettledValue(currentUserResult),
			avatars,
			ids,
			undefined,
			undefined,
			undefined,
			{ ...options, useAvatars: useAvatars },
		);
	}

	private async getCommitsForGraphCore(
		repoPath: string,
		asWebviewUri: (uri: Uri) => Uri,
		log: GitLog | undefined,
		headBranch: GitBranch,
		branchMap: Map<string, GitBranch>,
		branchTips: Map<string, string[]>,
		remote: GitRemote,
		remoteMap: Map<string, GitRemote>,
		rowStats: Map<string, GitGraphRowStats>,
		tagTips: Map<string, string[]>,
		currentUser: GitUser | undefined,
		avatars: Map<string, string>,
		ids: Set<string>,
		stashes: Map<string, GitStashCommit> | undefined,
		worktrees: GitWorktree[] | undefined,
		worktreesByBranch: Map<string, GitWorktree> | undefined,
		options?: {
			branch?: string;
			include?: { stats?: boolean };
			limit?: number;
			ref?: string;
			useAvatars?: boolean;
		},
	): Promise<GitGraph> {
		const includes = { ...options?.include, stats: true }; // stats are always available, so force it
		const downstreamMap = new Map<string, string[]>();
		if (log == null) {
			return {
				repoPath: repoPath,
				avatars: avatars,
				ids: ids,
				includes: includes,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				rows: [],
			};
		}

		const commits = (log.pagedCommits?.() ?? log.commits)?.values();
		if (commits == null) {
			return {
				repoPath: repoPath,
				avatars: avatars,
				ids: ids,
				includes: includes,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				rows: [],
			};
		}

		const rows: GitGraphRow[] = [];

		let avatarUrl: string | undefined;
		let branchName: string;
		let context:
			| GraphItemRefContext<GraphBranchContextValue>
			| GraphItemRefContext<GraphTagContextValue>
			| undefined;
		let contexts: GitGraphRowContexts | undefined;
		let head = false;
		let isCurrentUser = false;
		let refHeads: GitGraphRowHead[];
		let refRemoteHeads: GitGraphRowRemoteHead[];
		let refTags: GitGraphRowTag[];
		let remoteBranchId: string;
		let tagId: string;

		const headRefUpstreamName = headBranch.upstream?.name;

		for (const commit of commits) {
			ids.add(commit.sha);

			head = commit.sha === headBranch.sha;
			if (head) {
				context = {
					webviewItem: `gitlens:branch${head ? '+current' : ''}${
						headBranch?.upstream != null ? '+tracking' : ''
					}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(headBranch.name, repoPath, {
							id: headBranch.id,
							refType: 'branch',
							name: headBranch.name,
							remote: false,
							upstream: headBranch.upstream,
						}),
					},
				};

				refHeads = [
					{
						id: headBranch.id,
						name: headBranch.name,
						isCurrentHead: true,
						context: serializeWebviewItemContext<GraphItemRefContext>(context),
						upstream:
							headBranch.upstream != null
								? {
										name: headBranch.upstream.name,
										id: getBranchId(repoPath, true, headBranch.upstream.name),
								  }
								: undefined,
					},
				];

				if (headBranch.upstream != null) {
					remoteBranchId = getBranchId(repoPath, true, headBranch.name);
					avatarUrl = (
						(options?.useAvatars ? remote.provider?.avatarUri : undefined) ??
						getRemoteIconUri(this.container, remote, asWebviewUri)
					)?.toString(true);
					context = {
						webviewItem: 'gitlens:branch+remote',
						webviewItemValue: {
							type: 'branch',
							ref: createReference(headBranch.name, repoPath, {
								id: remoteBranchId,
								refType: 'branch',
								name: headBranch.name,
								remote: true,
								upstream: { name: remote.name, missing: false },
							}),
						},
					};

					refRemoteHeads = [
						{
							id: remoteBranchId,
							name: headBranch.name,
							owner: remote.name,
							url: remote.url,
							avatarUrl: avatarUrl,
							context: serializeWebviewItemContext<GraphItemRefContext>(context),
							current: true,
							hostingServiceType: remote.provider?.gkProviderId,
						},
					];

					if (headRefUpstreamName != null) {
						// Add the branch name (tip) to the upstream name entry in the downstreams map
						let downstreams = downstreamMap.get(headRefUpstreamName);
						if (downstreams == null) {
							downstreams = [];
							downstreamMap.set(headRefUpstreamName, downstreams);
						}

						downstreams.push(headBranch.name);
					}
				} else {
					refRemoteHeads = [];
				}
			} else {
				refHeads = [];
				refRemoteHeads = [];

				const bts = branchTips.get(commit.sha);
				if (bts != null) {
					for (const b of bts) {
						remoteBranchId = getBranchId(repoPath, true, b);
						branchName = getBranchNameWithoutRemote(b);

						avatarUrl = (
							(options?.useAvatars ? remote.provider?.avatarUri : undefined) ??
							getRemoteIconUri(this.container, remote, asWebviewUri)
						)?.toString(true);
						context = {
							webviewItem: 'gitlens:branch+remote',
							webviewItemValue: {
								type: 'branch',
								ref: createReference(b, repoPath, {
									id: remoteBranchId,
									refType: 'branch',
									name: b,
									remote: true,
									upstream: { name: remote.name, missing: false },
								}),
							},
						};

						refRemoteHeads.push({
							id: remoteBranchId,
							name: branchName,
							owner: remote.name,
							url: remote.url,
							avatarUrl: avatarUrl,
							context: serializeWebviewItemContext<GraphItemRefContext>(context),
							hostingServiceType: remote.provider?.gkProviderId,
						});
					}
				}
			}

			refTags = [];

			const tts = tagTips.get(commit.sha);
			if (tts != null) {
				for (const t of tts) {
					tagId = getTagId(repoPath, t);
					context = {
						webviewItem: 'gitlens:tag',
						webviewItemValue: {
							type: 'tag',
							ref: createReference(t, repoPath, {
								id: tagId,
								refType: 'tag',
								name: t,
							}),
						},
					};

					refTags.push({
						id: tagId,
						name: t,
						// Not currently used, so don't bother looking it up
						annotated: true,
						context: serializeWebviewItemContext<GraphItemRefContext>(context),
					});
				}
			}

			if (commit.author.email && !avatars.has(commit.author.email)) {
				const uri = commit.getCachedAvatarUri();
				if (uri != null) {
					avatars.set(commit.author.email, uri.toString(true));
				}
			}

			isCurrentUser = commit.author.name === 'You';
			contexts = {
				row: serializeWebviewItemContext<GraphItemRefContext>({
					webviewItem: `gitlens:commit${head ? '+HEAD' : ''}+current`,
					webviewItemValue: {
						type: 'commit',
						ref: createReference(commit.sha, repoPath, {
							refType: 'revision',
							message: commit.message,
						}),
					},
				}),
				avatar: serializeWebviewItemContext<GraphItemContext>({
					webviewItem: `gitlens:contributor${isCurrentUser ? '+current' : ''}`,
					webviewItemValue: {
						type: 'contributor',
						repoPath: repoPath,
						name: isCurrentUser && currentUser?.name != null ? currentUser.name : commit.author.name,
						email: commit.author.email,
						current: isCurrentUser,
					},
				}),
			};

			rows.push({
				sha: commit.sha,
				parents: commit.parents,
				author: commit.author.name,
				email: commit.author.email ?? '',
				date: commit.committer.date.getTime(),
				message: emojify(commit.message && String(commit.message).length ? commit.message : commit.summary),
				// TODO: review logic for stash, wip, etc
				type: commit.parents.length > 1 ? 'merge-node' : 'commit-node',
				heads: refHeads,
				remotes: refRemoteHeads,
				tags: refTags,
				contexts: contexts,
			});

			if (commit.stats != null) {
				rowStats.set(commit.sha, {
					files: getChangedFilesCount(commit.stats.files),
					additions: commit.stats.additions,
					deletions: commit.stats.deletions,
				});
			}
		}

		if (options?.ref === 'HEAD') {
			options.ref = first(log.commits.values())?.sha;
		} else if (options?.ref != null) {
			options.ref = undefined;
		}

		return {
			repoPath: repoPath,
			avatars: avatars,
			ids: ids,
			includes: includes,
			branches: branchMap,
			remotes: remoteMap,
			downstreams: downstreamMap,
			stashes: stashes,
			worktrees: worktrees,
			worktreesByBranch: worktreesByBranch,
			rows: rows,
			id: options?.ref,

			paging: {
				limit: log.limit,
				startingCursor: log.startingCursor,
				hasMore: log.hasMore,
			},
			more: async (limit: number | { until: string } | undefined): Promise<GitGraph | undefined> => {
				const moreLog = await log.more?.(limit);
				return this.getCommitsForGraphCore(
					repoPath,
					asWebviewUri,
					moreLog,
					headBranch,
					branchMap,
					branchTips,
					remote,
					remoteMap,
					rowStats,
					tagTips,
					currentUser,
					avatars,
					ids,
					stashes,
					worktrees,
					worktreesByBranch,
					options,
				);
			},
		};
	}

	@log()
	async getCommitTags(
		repoPath: string,
		ref: string,
		options?: { commitDate?: Date; mode?: 'contains' | 'pointsAt' },
	): Promise<string[]> {
		if (repoPath == null || options?.commitDate == null) return [];

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const tags = await github.getCommitTags(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(ref),
				options?.commitDate,
			);

			return tags;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@log()
	async getContributorsStats(
		repoPath: string,
		_options?: { merges?: boolean; since?: string },
	): Promise<GitContributorStats | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const results = await github.getContributors(session.accessToken, metadata.repo.owner, metadata.repo.name);

			const contributions = results.map(c => c.contributions).sort((a, b) => b - a);

			const result: GitContributorStats = {
				count: contributions.length,
				contributions: contributions,
			};
			return result;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getContributors(
		repoPath: string,
		_options?: { all?: boolean; merges?: boolean | 'first-parent'; ref?: string; stats?: boolean },
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const results = await github.getContributors(session.accessToken, metadata.repo.owner, metadata.repo.name);
			const currentUser = await this.getCurrentUser(repoPath);

			const contributors = [];
			for (const c of results) {
				if (c.type !== 'User') continue;

				contributors.push(
					new GitContributor(
						repoPath,
						c.name,
						c.email,
						c.contributions,
						undefined,
						undefined,
						isUserMatch(currentUser, c.name, c.email, c.login),
						undefined,
						c.login,
						c.avatar_url,
						c.node_id,
					),
				);
			}

			return contributors;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@gate()
	@log()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getLogScope();

		const repo = this._repoInfoCache.get(repoPath);

		let user = repo?.user;
		if (user != null) return user;
		// If we found the repo, but no user data was found just return
		if (user === null) return undefined;

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);
			user = await github.getCurrentUser(session.accessToken, metadata.repo.owner, metadata.repo.name);

			this._repoInfoCache.set(repoPath, { ...repo, user: user ?? null });
			return user;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			// Mark it so we won't bother trying again
			this._repoInfoCache.set(repoPath, { ...repo, user: null });
			return undefined;
		}
	}

	@log()
	async getDefaultBranchName(repoPath: string | undefined, _remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);
			return await github.getDefaultBranchName(session.accessToken, metadata.repo.owner, metadata.repo.name);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getDiffForFile(_uri: GitUri, _ref1: string | undefined, _ref2?: string): Promise<GitDiffFile | undefined> {
		return undefined;
	}

	@log({
		args: {
			1: _contents => '<contents>',
		},
	})
	async getDiffForFileContents(_uri: GitUri, _ref: string, _contents: string): Promise<GitDiffFile | undefined> {
		return undefined;
	}

	@log()
	async getDiffForLine(
		_uri: GitUri,
		_editorLine: number, // 0-based, Git is 1-based
		_ref1: string | undefined,
		_ref2?: string,
	): Promise<GitDiffLine | undefined> {
		return undefined;
	}

	@log()
	async getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		_options?: { filters?: GitDiffFilter[]; path?: string; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

		let range: GitRevisionRange;
		if (isRevisionRange(ref1OrRange)) {
			range = ref1OrRange;

			if (!isRevisionRange(ref1OrRange, 'qualified')) {
				const parts = getRevisionRangeParts(ref1OrRange);
				range = createRevisionRange(parts?.left || 'HEAD', parts?.right || 'HEAD', parts?.notation ?? '...');
			}
		} else {
			range = createRevisionRange(ref1OrRange || 'HEAD', ref2 || 'HEAD', '...');
		}

		let range2: GitRevisionRange | undefined;
		// GitHub doesn't support the `..` range notation, so we will need to do some extra work
		if (isRevisionRange(range, 'qualified-double-dot')) {
			const parts = getRevisionRangeParts(range)!;

			range = createRevisionRange(parts.left, parts.right, '...');
			range2 = createRevisionRange(parts.right, parts.left, '...');
		}

		try {
			let result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(range),
			);

			const files1 = result?.files;

			let files = files1;
			if (range2) {
				result = await github.getComparison(
					session.accessToken,
					metadata.repo.owner,
					metadata.repo.name,
					stripOrigin(range2),
				);

				const files2 = result?.files;

				files = [...new Set(union(files1, files2))];
			}

			return files?.map(
				f =>
					new GitFileChange(
						repoPath,
						f.filename ?? '',
						fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
						f.previous_filename,
						undefined,
						// If we need to get a 2nd range, don't include the stats because they won't be correct (for files that overlap)
						range2
							? undefined
							: {
									additions: f.additions ?? 0,
									deletions: f.deletions ?? 0,
									changes: f.changes ?? 0,
							  },
					),
			);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getFileStatusForCommit(repoPath: string, uri: Uri, ref: string): Promise<GitFile | undefined> {
		if (ref === deletedOrMissing || isUncommitted(ref)) return undefined;

		const commit = await this.getCommitForFile(repoPath, uri, { ref: ref });
		if (commit == null) return undefined;

		return commit.findFile(uri);
	}

	async getLastFetchedTimestamp(_repoPath: string): Promise<number | undefined> {
		return undefined;
	}

	@log()
	async getLog(
		repoPath: string,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: string;
		},
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const limit = this.getPagingLimit(options?.limit);

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const ref = !options?.ref || options.ref === 'HEAD' ? (await metadata.getRevision()).revision : options.ref;
			const result = await github.getCommits(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(ref),
				{
					all: options?.all,
					authors: options?.authors,
					after: options?.cursor,
					limit: limit,
					since: options?.since ? new Date(options.since) : undefined,
				},
			);

			const commits = new Map<string, GitCommit>();

			const { viewer = session.account.label } = result;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					c = new GitCommit(
						this.container,
						repoPath,
						commit.oid,
						new GitCommitIdentity(
							authorName,
							commit.author.email,
							new Date(commit.author.date),
							commit.author.avatarUrl,
						),
						new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
						commit.message.split('\n', 1)[0],
						commit.parents.nodes.map(p => p.oid),
						commit.message,
						commit.files?.map(
							f =>
								new GitFileChange(
									repoPath,
									f.filename ?? '',
									fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
									f.previous_filename,
									undefined,
									{
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: f.changes ?? 0,
									},
								),
						),
						{
							files: commit.changedFiles ?? 0,
							additions: commit.additions ?? 0,
							deletions: commit.deletions ?? 0,
						},
						[],
					);
					commits.set(commit.oid, c);
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: ref,
				range: undefined,
				count: commits.size,
				limit: limit,
				hasMore: result.paging?.more ?? false,
				endingCursor: result.paging?.cursor,
				query: (limit: number | undefined) => this.getLog(repoPath, { ...options, limit: limit }),
			};

			if (log.hasMore) {
				log.more = this.getLogMoreFn(log, options);
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getLogRefsOnly(
		repoPath: string,
		options?: {
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		// TODO@eamodio optimize this
		const result = await this.getLog(repoPath, options);
		if (result == null) return undefined;

		return new Set([...result.commits.values()].map(c => c.ref));
	}

	private getLogMoreFn(
		log: GitLog,
		options?: {
			authors?: GitUser[];
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = this.getPagingLimit(moreLimit);

			// // If the log is for a range, then just get everything prior + more
			// if (isRange(log.sha)) {
			// 	const moreLog = await this.getLog(log.repoPath, {
			// 		...options,
			// 		limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
			// 	});
			// 	// If we can't find any more, assume we have everything
			// 	if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			// 	return moreLog;
			// }

			// const ref = Iterables.last(log.commits.values())?.ref;
			// const moreLog = await this.getLog(log.repoPath, {
			// 	...options,
			// 	limit: moreUntil == null ? moreLimit : 0,
			// 	ref: moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
			// });
			// // If we can't find any more, assume we have everything
			// if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const moreLog = await this.getLog(log.repoPath, {
				...options,
				limit: moreLimit,
				cursor: log.endingCursor,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				range: undefined,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				startingCursor: last(log.commits)?.[0],
				endingCursor: moreLog.endingCursor,
				pagedCommits: () => {
					// Remove any duplicates
					for (const sha of log.commits.keys()) {
						moreLog.commits.delete(sha);
					}
					return moreLog.commits;
				},
				query: log.query,
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogMoreFn(mergedLog, options);
			}

			return mergedLog;
		};
	}

	@log()
	async getLogForFile(
		repoPath: string | undefined,
		pathOrUri: string | Uri,
		options?: {
			all?: boolean;
			cursor?: string;
			force?: boolean | undefined;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const relativePath = this.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`File name cannot match the repository path; path=${relativePath}`);
		}

		options = { reverse: false, ...options };

		// Not currently supported
		options.renames = false;
		options.all = false;

		// if (options.renames == null) {
		// 	options.renames = configuration.get('advanced.fileHistoryFollowsRenames');
		// }

		let key = 'log';
		if (options.ref != null) {
			key += `:${options.ref}`;
		}

		// if (options.all == null) {
		// 	options.all = configuration.get('advanced.fileHistoryShowAllBranches');
		// }
		// if (options.all) {
		// 	key += ':all';
		// }

		options.limit = this.getPagingLimit(options?.limit);
		if (options.limit) {
			key += `:n${options.limit}`;
		}

		if (options.renames) {
			key += ':follow';
		}

		if (options.reverse) {
			key += ':reverse';
		}

		if (options.since) {
			key += `:since=${options.since}`;
		}

		if (options.skip) {
			key += `:skip${options.skip}`;
		}

		if (options.cursor) {
			key += `:cursor=${options.cursor}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(GitUri.fromFile(relativePath, repoPath, options.ref));
		if (!options.force && options.range == null) {
			if (doc.state != null) {
				const cachedLog = doc.state.getLog(key);
				if (cachedLog != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedLog.item;
				}

				if (options.ref != null || options.limit != null) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.getLog(
						`log${options.renames ? ':follow' : ''}${options.reverse ? ':reverse' : ''}`,
					);
					if (cachedLog != null) {
						if (options.ref == null) {
							Logger.debug(scope, `Cache hit: ~'${key}'`);
							return cachedLog.item;
						}

						Logger.debug(scope, `Cache ?: '${key}'`);
						let log = await cachedLog.item;
						if (log != null && !log.hasMore && log.commits.has(options.ref)) {
							Logger.debug(scope, `Cache hit: '${key}'`);

							// Create a copy of the log starting at the requested commit
							let skip = true;
							let i = 0;
							const commits = new Map(
								filterMap<[string, GitCommit], [string, GitCommit]>(
									log.commits.entries(),
									([ref, c]) => {
										if (skip) {
											if (ref !== options?.ref) return undefined;
											skip = false;
										}

										i++;
										if (options?.limit != null && i > options.limit) {
											return undefined;
										}

										return [ref, c];
									},
								),
							);

							const opts = { ...options };
							log = {
								...log,
								limit: options.limit,
								count: commits.size,
								commits: commits,
								query: (limit: number | undefined) =>
									this.getLogForFile(repoPath, pathOrUri, { ...opts, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState();
			}
		}

		const promise = this.getLogForFileCore(repoPath, relativePath, doc, key, scope, options);

		if (doc.state != null && options.range == null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedLog = {
				item: promise as Promise<GitLog>,
			};
			doc.state.setLog(key, value);
		}

		return promise;
	}

	private async getLogForFileCore(
		repoPath: string | undefined,
		path: string,
		document: TrackedGitDocument,
		key: string,
		scope: LogScope | undefined,
		options?: {
			all?: boolean;
			cursor?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const limit = this.getPagingLimit(options?.limit);

		try {
			const context = await this.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;
			const { metadata, github, remotehub, session } = context;

			const uri = this.getAbsoluteUri(path, repoPath);
			const relativePath = this.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			// if (range != null && range.start.line > range.end.line) {
			// 	range = new Range(range.end, range.start);
			// }

			const ref = !options?.ref || options.ref === 'HEAD' ? (await metadata.getRevision()).revision : options.ref;
			const result = await github.getCommits(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(ref),
				{
					all: options?.all,
					after: options?.cursor,
					path: relativePath,
					limit: limit,
					since: options?.since ? new Date(options.since) : undefined,
				},
			);

			const commits = new Map<string, GitCommit>();

			const { viewer = session.account.label } = result;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					const files = commit.files?.map(
						f =>
							new GitFileChange(
								repoPath,
								f.filename ?? '',
								fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
								f.previous_filename,
								undefined,
								{ additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: f.changes ?? 0 },
							),
					);
					const foundFile = isFolderGlob(relativePath)
						? undefined
						: files?.find(f => f.path === relativePath) ??
						  new GitFileChange(
								repoPath,
								relativePath,
								GitFileIndexStatus.Modified,
								undefined,
								undefined,
								commit.changedFiles === 1
									? { additions: commit.additions ?? 0, deletions: commit.deletions ?? 0, changes: 0 }
									: undefined,
						  );

					c = new GitCommit(
						this.container,
						repoPath,
						commit.oid,
						new GitCommitIdentity(
							authorName,
							commit.author.email,
							new Date(commit.author.date),
							commit.author.avatarUrl,
						),
						new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
						commit.message.split('\n', 1)[0],
						commit.parents.nodes.map(p => p.oid),
						commit.message,
						{ file: foundFile, files: files },
						{
							files: commit.changedFiles ?? 0,
							additions: commit.additions ?? 0,
							deletions: commit.deletions ?? 0,
						},
						[],
					);
					commits.set(commit.oid, c);
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: ref,
				range: undefined,
				count: commits.size,
				limit: limit,
				hasMore: result.paging?.more ?? false,
				endingCursor: result.paging?.cursor,
				query: (limit: number | undefined) => this.getLogForFile(repoPath, path, { ...options, limit: limit }),
			};
			if (log.hasMore) {
				log.more = this.getLogForFileMoreFn(log, path, options);
			}

			return log;
		} catch (ex) {
			debugger;
			// Trap and cache expected log errors
			if (document.state != null && options?.range == null && !options?.reverse) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedLog = {
					item: emptyPromise as Promise<GitLog>,
					errorMessage: msg,
				};
				document.state.setLog(key, value);

				return emptyPromise as Promise<GitLog>;
			}

			return undefined;
		}
	}

	private getLogForFileMoreFn(
		log: GitLog,
		relativePath: string,
		options?: {
			all?: boolean;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = this.getPagingLimit(moreLimit);

			// const ref = Iterables.last(log.commits.values())?.ref;
			const moreLog = await this.getLogForFile(log.repoPath, relativePath, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				cursor: log.endingCursor,
				// ref: options.all ? undefined : moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
				// skip: options.all ? log.count : undefined,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				range: log.range,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				endingCursor: moreLog.endingCursor,
				query: log.query,
			};

			// if (options.renames) {
			// 	const renamed = find(
			// 		moreLog.commits.values(),
			// 		c => Boolean(c.file?.originalPath) && c.file?.originalPath !== fileName,
			// 	);
			// 	fileName = renamed?.file?.originalPath ?? fileName;
			// }

			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogForFileMoreFn(mergedLog, relativePath, options);
			}

			return mergedLog;
		};
	}

	@log()
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		_options: { forkPoint?: boolean },
	): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				createRevisionRange(stripOrigin(ref1), stripOrigin(ref2), '...'),
			);
			return result?.merge_base_commit?.sha;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	// @gate()
	@log()
	async getMergeStatus(_repoPath: string): Promise<GitMergeStatus | undefined> {
		return undefined;
	}

	// @gate()
	@log()
	async getRebaseStatus(_repoPath: string): Promise<GitRebaseStatus | undefined> {
		return undefined;
	}

	@log()
	async getNextComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no ref there is no next commit
		if (!ref) return undefined;

		const scope = getLogScope();

		try {
			const context = await this.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { metadata, github, remotehub, session } = context;
			const relativePath = this.getRelativePath(uri, remotehub.getProviderRootUri(uri));
			const revision = (await metadata.getRevision()).revision;

			if (ref === 'HEAD') {
				ref = revision;
			}

			const refs = await github.getNextCommitRefs(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				revision,
				relativePath,
				stripOrigin(ref),
			);

			return {
				current:
					skip === 0
						? GitUri.fromFile(relativePath, repoPath, ref)
						: new GitUri(await this.getBestRevisionUri(repoPath, relativePath, refs[skip - 1])),
				next: new GitUri(await this.getBestRevisionUri(repoPath, relativePath, refs[skip])),
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}

	@log()
	async getOldestUnpushedRefForFile(_repoPath: string, _uri: Uri): Promise<string | undefined> {
		// TODO@eamodio until we have access to the RemoteHub change store there isn't anything we can do here
		return undefined;
	}

	@log()
	async getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (ref === uncommitted) {
			ref = undefined;
		}

		try {
			const context = await this.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { metadata, github, remotehub, session } = context;
			const relativePath = this.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			const offset = ref != null ? 1 : 0;

			const result = await github.getCommitRefs(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(!ref || ref === 'HEAD' ? (await metadata.getRevision()).revision : ref),
				{
					path: relativePath,
					first: offset + skip + 1,
				},
			);
			if (result == null) return undefined;

			// If we are at a commit, diff commit with previous
			const current =
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: new GitUri(
							await this.getBestRevisionUri(
								repoPath,
								relativePath,
								result.values[offset + skip - 1]?.oid ?? deletedOrMissing,
							),
					  );
			if (current == null || current.sha === deletedOrMissing) return undefined;

			return {
				current: current,
				previous: new GitUri(
					await this.getBestRevisionUri(
						repoPath,
						relativePath,
						result.values[offset + skip]?.oid ?? deletedOrMissing,
					),
				),
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}

	@log()
	async getPreviousComparisonUrisForLine(
		repoPath: string,
		uri: Uri,
		editorLine: number, // 0-based, Git is 1-based
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousLineComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getLogScope();

		try {
			const context = await this.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const { remotehub } = context;

			let relativePath = this.getRelativePath(uri, remotehub.getProviderRootUri(uri));

			// FYI, GitHub doesn't currently support returning the original line number, nor the previous sha, so this is untrustworthy

			let current = GitUri.fromFile(relativePath, repoPath, ref);
			let currentLine = editorLine;
			let previous;
			let previousLine = editorLine;
			let nextLine = editorLine;

			for (let i = 0; i < Math.max(0, skip) + 2; i++) {
				const blameLine = await this.getBlameForLine(previous ?? current, nextLine, undefined, {
					forceSingleLine: true,
				});
				if (blameLine == null) break;

				// Diff with line ref with previous
				ref = blameLine.commit.sha;
				relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
				nextLine = blameLine.line.originalLine - 1;

				const gitUri = GitUri.fromFile(relativePath, repoPath, ref);
				if (previous == null) {
					previous = gitUri;
					previousLine = nextLine;
				} else {
					current = previous;
					currentLine = previousLine;
					previous = gitUri;
					previousLine = nextLine;
				}
			}

			if (current == null) return undefined;

			return {
				current: current,
				previous: previous,
				line: (currentLine ?? editorLine) + 1, // 1-based
			};
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		}
	}

	@log()
	async getIncomingActivity(
		_repoPath: string,
		_options?: {
			all?: boolean;
			branch?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			skip?: number;
		},
	): Promise<GitReflog | undefined> {
		return undefined;
	}

	@log({ args: { 1: false } })
	async getRemotes(
		repoPath: string | undefined,
		_options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const providers = loadRemoteProviders(configuration.get('remotes', null));

		const uri = Uri.parse(repoPath, true);
		const [, owner, repo] = uri.path.split('/', 3);

		const url = `https://github.com/${owner}/${repo}.git`;
		const domain = 'github.com';
		const path = `${owner}/${repo}`;

		return [
			new GitRemote(
				this.container,
				repoPath,
				'origin',
				'https',
				domain,
				path,
				getRemoteProviderMatcher(this.container, providers)(url, domain, path),
				[
					{ type: 'fetch', url: url },
					{ type: 'push', url: url },
				],
			),
		];
	}

	@log()
	async getRevisionContent(repoPath: string, path: string, ref: string): Promise<Uint8Array | undefined> {
		const uri = ref ? this.createProviderUri(repoPath, ref, path) : this.createVirtualUri(repoPath, ref, path);
		return workspace.fs.readFile(uri);
	}

	@log()
	async getStatusForFile(_repoPath: string, _uri: Uri): Promise<GitStatusFile | undefined> {
		return undefined;
	}

	@log()
	async getStatusForFiles(_repoPath: string, _pathOrGlob: Uri): Promise<GitStatusFile[] | undefined> {
		return undefined;
	}

	@log()
	async getStatus(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const context = await this.ensureRepositoryContext(repoPath);
		if (context == null) return undefined;

		const revision = await context.metadata.getRevision();
		if (revision == null) return undefined;

		return new GitStatus(
			repoPath,
			revision.name,
			revision.revision,
			[],
			{ ahead: 0, behind: 0 },
			revision.type === HeadType.Branch || revision.type === HeadType.RemoteBranch
				? { name: `origin/${revision.name}`, missing: false }
				: undefined,
		);
	}

	@log({ args: { 1: false } })
	async getTags(
		repoPath: string | undefined,
		options?: {
			filter?: (t: GitTag) => boolean;
			paging?: PagingOptions;
			sort?: boolean | TagSortOptions;
		},
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getLogScope();

		let tagsPromise = options?.paging?.cursor ? undefined : this._tagsCache.get(repoPath);
		if (tagsPromise == null) {
			async function load(this: GitHubGitProvider): Promise<PagedResult<GitTag>> {
				try {
					const { metadata, github, session } = await this.ensureRepositoryContext(repoPath!);

					const tags: GitTag[] = [];

					let cursor = options?.paging?.cursor;
					const loadAll = cursor == null;

					let authoredDate;
					let committedDate;

					while (true) {
						const result = await github.getTags(
							session.accessToken,
							metadata.repo.owner,
							metadata.repo.name,
							{ cursor: cursor },
						);

						for (const tag of result.values) {
							authoredDate =
								tag.target.authoredDate ?? tag.target.target?.authoredDate ?? tag.target.tagger?.date;
							committedDate =
								tag.target.committedDate ?? tag.target.target?.committedDate ?? tag.target.tagger?.date;

							tags.push(
								new GitTag(
									repoPath!,
									tag.name,
									tag.target.target?.oid ?? tag.target.oid,
									tag.target.message ?? tag.target.target?.message ?? '',
									authoredDate != null ? new Date(authoredDate) : undefined,
									committedDate != null ? new Date(committedDate) : undefined,
								),
							);
						}

						if (!result.paging?.more || !loadAll) return { ...result, values: tags };

						cursor = result.paging.cursor;
					}
				} catch (ex) {
					Logger.error(ex, scope);
					debugger;

					this._tagsCache.delete(repoPath!);
					return emptyPagedResult;
				}
			}

			tagsPromise = load.call(this);
			if (options?.paging?.cursor == null) {
				this._tagsCache.set(repoPath, tagsPromise);
			}
		}

		let result = await tagsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort != null) {
			sortTags(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@log()
	async getTreeEntryForRevision(repoPath: string, path: string, ref: string): Promise<GitTreeEntry | undefined> {
		if (repoPath == null || !path) return undefined;

		if (ref === 'HEAD') {
			const context = await this.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const revision = await context.metadata.getRevision();
			ref = revision?.revision;
		}

		const uri = ref ? this.createProviderUri(repoPath, ref, path) : this.createVirtualUri(repoPath, ref, path);

		const stats = await workspace.fs.stat(uri);
		if (stats == null) return undefined;

		return {
			ref: ref,
			oid: '',
			path: this.getRelativePath(uri, repoPath),
			size: stats.size,
			type: (stats.type & FileType.Directory) === FileType.Directory ? 'tree' : 'blob',
		};
	}

	@log()
	async getTreeForRevision(repoPath: string, ref: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		if (ref === 'HEAD') {
			const context = await this.ensureRepositoryContext(repoPath);
			if (context == null) return [];

			const revision = await context.metadata.getRevision();
			ref = revision?.revision;
		}

		const baseUri = ref ? this.createProviderUri(repoPath, ref) : this.createVirtualUri(repoPath, ref);

		const entries = await workspace.fs.readDirectory(baseUri);
		if (entries == null) return [];

		const result: GitTreeEntry[] = [];
		for (const [path, type] of entries) {
			const uri = this.getAbsoluteUri(path, baseUri);

			// TODO:@eamodio do we care about size?
			// const stats = await workspace.fs.stat(uri);

			result.push({
				ref: ref,
				oid: '',
				path: this.getRelativePath(path, uri),
				size: 0, // stats?.size,
				type: (type & FileType.Directory) === FileType.Directory ? 'tree' : 'blob',
			});
		}

		// TODO@eamodio: Implement this
		return [];
	}

	@log()
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
	) {
		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.getBranches(repoPath, {
				filter: options?.filter?.branches,
				sort: false,
			}),
			this.getTags(repoPath, {
				filter: options?.filter?.tags,
				sort: false,
			}),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@log()
	async hasCommitBeenPushed(_repoPath: string, _ref: string): Promise<boolean> {
		// In this env we can't have unpushed commits
		return true;
	}

	@log()
	async isAncestorOf(repoPath: string, ref1: string, ref2: string): Promise<boolean> {
		if (repoPath == null) return false;

		const scope = getLogScope();

		const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

		try {
			const result = await github.getComparison(
				session.accessToken,
				metadata.repo.owner,
				metadata.repo.name,
				createRevisionRange(stripOrigin(ref1), stripOrigin(ref2), '...'),
			);

			switch (result?.status) {
				case 'ahead':
				case 'diverged':
					return false;
				case 'identical':
				case 'behind':
					return true;
				default:
					return false;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return false;
		}
	}

	isTrackable(uri: Uri): boolean {
		return this.supportedSchemes.has(uri.scheme);
	}

	async isTracked(uri: Uri): Promise<boolean> {
		if (!this.isTrackable(uri) || this.container.git.getRepository(uri) == null) return false;

		// Don't call out to RemoteHub to keep things more performant, since we only work with GitHub here
		// const remotehub = await this.ensureRemoteHubApi();
		// if (remotehub == null) return false;

		// const providerUri = remotehub.getProviderUri(uri);
		// if (providerUri == null) return false;

		const providerUri = uri.with({ scheme: Schemes.GitHub });
		const stats = await workspace.fs.stat(providerUri);
		return stats != null;
	}

	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		_options?: { force?: boolean; timeout?: number },
	) {
		if (
			!ref ||
			ref === deletedOrMissing ||
			(pathOrUri == null && isSha(ref)) ||
			(pathOrUri != null && isUncommitted(ref))
		) {
			return ref;
		}

		let relativePath;
		if (pathOrUri != null) {
			relativePath = this.getRelativePath(pathOrUri, repoPath);
		} else if (!isShaLike(ref) || ref.endsWith('^3')) {
			// If it doesn't look like a sha at all (e.g. branch name) or is a stash ref (^3) don't try to resolve it
			return ref;
		}

		const context = await this.ensureRepositoryContext(repoPath);
		if (context == null) return ref;

		const { metadata, github, session } = context;

		const resolved = await github.resolveReference(
			session.accessToken,
			metadata.repo.owner,
			metadata.repo.name,
			stripOrigin(ref),
			relativePath,
		);

		if (resolved != null) return resolved;

		return relativePath ? deletedOrMissing : ref;
	}

	@log()
	async richSearchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: { cursor?: string; limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null; skip?: number },
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const operations = parseSearchQuery(search);

		const values = operations.get('commit:');
		if (values?.size) {
			const commit = await this.getCommit(repoPath, first(values)!);
			if (commit == null) return undefined;

			return {
				repoPath: repoPath,
				commits: new Map([[commit.sha, commit]]),
				sha: commit.sha,
				range: undefined,
				count: 1,
				limit: 1,
				hasMore: false,
			};
		}

		const queryArgs = await this.getQueryArgsFromSearchQuery(search, operations, repoPath);
		if (queryArgs.length === 0) return undefined;

		const limit = this.getPagingLimit(options?.limit);

		try {
			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const query = `repo:${metadata.repo.owner}/${metadata.repo.name}+${queryArgs.join('+').trim()}`;

			const result = await github.searchCommits(session.accessToken, query, {
				cursor: options?.cursor,
				limit: limit,
				sort:
					options?.ordering === 'date'
						? 'committer-date'
						: options?.ordering === 'author-date'
						  ? 'author-date'
						  : undefined,
			});
			if (result == null) return undefined;

			const commits = new Map<string, GitCommit>();

			const viewer = session.account.label;
			for (const commit of result.values) {
				const authorName = viewer != null && commit.author.name === viewer ? 'You' : commit.author.name;
				const committerName =
					viewer != null && commit.committer.name === viewer ? 'You' : commit.committer.name;

				let c = commits.get(commit.oid);
				if (c == null) {
					c = new GitCommit(
						this.container,
						repoPath,
						commit.oid,
						new GitCommitIdentity(
							authorName,
							commit.author.email,
							new Date(commit.author.date),
							commit.author.avatarUrl,
						),
						new GitCommitIdentity(committerName, commit.committer.email, new Date(commit.committer.date)),
						commit.message.split('\n', 1)[0],
						commit.parents.nodes.map(p => p.oid),
						commit.message,
						commit.files?.map(
							f =>
								new GitFileChange(
									repoPath,
									f.filename ?? '',
									fromCommitFileStatus(f.status) ?? GitFileIndexStatus.Modified,
									f.previous_filename,
									undefined,
									{
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: f.changes ?? 0,
									},
								),
						),
						{
							files: commit.changedFiles ?? 0,
							additions: commit.additions ?? 0,
							deletions: commit.deletions ?? 0,
						},
						[],
					);
					commits.set(commit.oid, c);
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: undefined,
				range: undefined,
				count: commits.size,
				limit: limit,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				endingCursor: result.pageInfo?.endCursor ?? undefined,
				query: (limit: number | undefined) => this.getLog(repoPath, { ...options, limit: limit }),
			};

			if (log.hasMore) {
				function richSearchCommitsCore(
					this: GitHubGitProvider,
					log: GitLog,
				): (limit: number | undefined) => Promise<GitLog> {
					return async (limit: number | undefined) => {
						limit = this.getPagingLimit(limit);

						const moreLog = await this.richSearchCommits(log.repoPath, search, {
							...options,
							limit: limit,
							cursor: log.endingCursor,
						});
						// If we can't find any more, assume we have everything
						if (moreLog == null) return { ...log, hasMore: false, more: undefined };

						const commits = new Map([...log.commits, ...moreLog.commits]);

						const mergedLog: GitLog = {
							repoPath: log.repoPath,
							commits: commits,
							sha: log.sha,
							range: undefined,
							count: commits.size,
							limit: (log.limit ?? 0) + limit,
							hasMore: moreLog.hasMore,
							endingCursor: moreLog.endingCursor,
							query: log.query,
						};
						if (mergedLog.hasMore) {
							mergedLog.more = richSearchCommitsCore.call(this, mergedLog);
						}

						return mergedLog;
					};
				}

				log.more = richSearchCommitsCore.call(this, log);
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}

		return undefined;
	}

	@log()
	async searchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: {
			cancellation?: CancellationToken;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo';
		},
	): Promise<GitSearch> {
		// const scope = getLogScope();
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		const comparisonKey = getSearchQueryComparisonKey(search);

		try {
			const results: GitSearchResults = new Map<string, GitSearchResultData>();
			const operations = parseSearchQuery(search);

			const values = operations.get('commit:');
			if (values != null) {
				const commitsResults = await Promise.allSettled(
					map(values, v => this.getCommit(repoPath, v.replace(doubleQuoteRegex, ''))),
				);

				let i = 0;
				for (const commitResult of commitsResults) {
					const commit = getSettledValue(commitResult);
					if (commit == null) continue;

					results.set(commit.sha, {
						i: i++,
						date: Number(options?.ordering === 'author-date' ? commit.author.date : commit.committer.date),
					});
				}

				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
				};
			}

			const queryArgs = await this.getQueryArgsFromSearchQuery(search, operations, repoPath);
			if (queryArgs.length === 0) {
				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
				};
			}

			const { metadata, github, session } = await this.ensureRepositoryContext(repoPath);

			const query = `repo:${metadata.repo.owner}/${metadata.repo.name}+${queryArgs.join('+').trim()}`;

			async function searchForCommitsCore(
				this: GitHubGitProvider,
				limit: number | undefined,
				cursor?: string,
			): Promise<GitSearch> {
				if (options?.cancellation?.isCancellationRequested) {
					return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
				}

				limit = this.getPagingLimit(limit ?? configuration.get('advanced.maxSearchItems'));
				const result = await github.searchCommitShas(session.accessToken, query, {
					cursor: cursor,
					limit: limit,
					sort:
						options?.ordering === 'date'
							? 'committer-date'
							: options?.ordering === 'author-date'
							  ? 'author-date'
							  : undefined,
				});

				if (result == null || options?.cancellation?.isCancellationRequested) {
					return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
				}

				for (const commit of result.values) {
					results.set(commit.sha, {
						i: results.size,
						date: Number(options?.ordering === 'author-date' ? commit.authorDate : commit.committerDate),
					});
				}

				cursor = result.pageInfo?.endCursor ?? undefined;

				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
					paging: result.pageInfo?.hasNextPage
						? {
								limit: limit,
								hasMore: true,
						  }
						: undefined,
					more: async (limit: number): Promise<GitSearch> => searchForCommitsCore.call(this, limit, cursor),
				};
			}

			return await searchForCommitsCore.call(this, options?.limit);
		} catch (ex) {
			if (ex instanceof GitSearchError) {
				throw ex;
			}
			throw new GitSearchError(ex);
		}
	}

	@log()
	async validateBranchOrTagName(ref: string, _repoPath?: string): Promise<boolean> {
		return validBranchOrTagRegex.test(ref);
	}

	@log()
	async validateReference(_repoPath: string, _ref: string): Promise<boolean> {
		return true;
	}

	@gate()
	private async ensureRepositoryContext(
		repoPath: string,
		open?: boolean,
	): Promise<{ github: GitHubApi; metadata: Metadata; remotehub: RemoteHubApi; session: AuthenticationSession }> {
		let uri = Uri.parse(repoPath, true);
		if (!/^github\+?/.test(uri.authority)) {
			throw new OpenVirtualRepositoryError(repoPath, OpenVirtualRepositoryErrorReason.NotAGitHubRepository);
		}

		if (!open) {
			const repo = this.container.git.getRepository(uri);
			if (repo == null) {
				throw new OpenVirtualRepositoryError(repoPath, OpenVirtualRepositoryErrorReason.NotAGitHubRepository);
			}

			uri = repo.uri;
		}

		let remotehub = this._remotehub;
		if (remotehub == null) {
			try {
				remotehub = await this.ensureRemoteHubApi();
			} catch (ex) {
				if (!(ex instanceof ExtensionNotFoundError)) {
					debugger;
				}
				throw new OpenVirtualRepositoryError(
					repoPath,
					OpenVirtualRepositoryErrorReason.RemoteHubApiNotFound,
					ex,
				);
			}
		}

		const metadata = await ensureProviderLoaded(uri, remotehub, uri => remotehub?.getMetadata(uri));
		if (metadata?.provider.id !== 'github') {
			throw new OpenVirtualRepositoryError(repoPath, OpenVirtualRepositoryErrorReason.NotAGitHubRepository);
		}

		const data = decodeRemoteHubAuthority<GitHubAuthorityMetadata>(uri.authority);
		// If the virtual repository is opened to a PR, then we need to ensure the owner is the owner of the current branch
		if (data.metadata?.ref?.type === RepositoryRefType.PullRequest) {
			const revision = await metadata.getRevision();
			if (revision.type === HeadType.RemoteBranch) {
				const [remote] = revision.name.split(':');
				if (remote !== metadata.repo.owner) {
					metadata.repo.owner = remote;
				}
			}
		}

		let github;
		let session;
		try {
			[github, session] = await Promise.all([this.ensureGitHub(), this.ensureSession()]);
		} catch (ex) {
			debugger;
			if (ex instanceof AuthenticationError) {
				throw new OpenVirtualRepositoryError(
					repoPath,
					ex.reason === AuthenticationErrorReason.UserDidNotConsent
						? OpenVirtualRepositoryErrorReason.GitHubAuthenticationDenied
						: OpenVirtualRepositoryErrorReason.GitHubAuthenticationNotFound,
					ex,
				);
			}

			throw new OpenVirtualRepositoryError(repoPath);
		}
		if (github == null) {
			debugger;
			throw new OpenVirtualRepositoryError(repoPath);
		}

		return { github: github, metadata: metadata, remotehub: remotehub, session: session };
	}

	private _github: GitHubApi | undefined;
	@gate()
	private async ensureGitHub() {
		if (this._github == null) {
			const github = await this.container.github;
			if (github != null) {
				this._disposables.push(github.onDidReauthenticate(() => void this.ensureSession(true)));
			}
			this._github = github;
		}
		return this._github;
	}

	/** Only use this if you NEED non-promise access to RemoteHub */
	private _remotehub: RemoteHubApi | undefined;
	private _remotehubPromise: Promise<RemoteHubApi> | undefined;
	private async ensureRemoteHubApi(): Promise<RemoteHubApi>;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	private async ensureRemoteHubApi(silent: false): Promise<RemoteHubApi>;
	private async ensureRemoteHubApi(silent: boolean): Promise<RemoteHubApi | undefined>;
	private async ensureRemoteHubApi(silent?: boolean): Promise<RemoteHubApi | undefined> {
		if (this._remotehubPromise == null) {
			this._remotehubPromise = getRemoteHubApi();
			// Not a fan of this, but we need to be able to access RemoteHub without a promise
			this._remotehubPromise.then(
				api => (this._remotehub = api),
				() => (this._remotehub = undefined),
			);
		}

		if (!silent) return this._remotehubPromise;

		try {
			return await this._remotehubPromise;
		} catch {
			return undefined;
		}
	}

	private _sessionPromise: Promise<AuthenticationSession> | undefined;
	private async ensureSession(force: boolean = false, silent: boolean = false): Promise<AuthenticationSession> {
		// never get silent in web environments, because we assume that we always have a github session there:
		silent = silent && !isWeb;
		if (force || this._sessionPromise == null) {
			async function getSession(this: GitHubGitProvider): Promise<AuthenticationSession> {
				let skip = this.container.storage.get(`provider:authentication:skip:${this.descriptor.id}`, false);
				const authenticationProvider = await this.authenticationService.get(this.authenticationProviderId);

				try {
					let session;
					if (force) {
						skip = false;
						void this.container.storage.delete(`provider:authentication:skip:${this.descriptor.id}`);

						session = await authenticationProvider.getSession(this.authenticationDescriptor, {
							forceNewSession: true,
						});
					} else if (!skip && !silent) {
						session = await authenticationProvider.getSession(this.authenticationDescriptor, {
							createIfNeeded: true,
						});
					} else {
						session = await authenticationProvider.getSession(this.authenticationDescriptor);
					}

					if (session != null) return session;

					throw new Error('User did not consent');
				} catch (ex) {
					if (ex instanceof Error && ex.message.includes('User did not consent')) {
						if (!silent) {
							await this.container.storage.store(
								`provider:authentication:skip:${this.descriptor.id}`,
								true,
							);
							if (!skip) {
								if (!force) {
									queueMicrotask(async () => {
										const enable = 'Re-enable';
										const result = await window.showInformationMessage(
											'GitLens has been disabled. Authentication is required for GitLens to work with remote GitHub repositories.',
											enable,
										);

										if (result === enable) {
											void this.ensureSession(true);
										}
									});
								}

								force = false;
								return getSession.call(this);
							}
						}

						throw new AuthenticationError('github', AuthenticationErrorReason.UserDidNotConsent);
					}

					Logger.error(ex);
					debugger;
					throw new AuthenticationError('github', undefined, ex);
				}
			}

			this._sessionPromise = getSession.call(this);
		}

		return this._sessionPromise;
	}

	private createVirtualUri(base: string | Uri, ref?: GitReference | string, path?: string): Uri {
		let metadata: GitHubAuthorityMetadata | undefined;

		if (typeof ref === 'string') {
			if (ref) {
				if (isSha(ref)) {
					metadata = { v: 1, ref: { id: ref, type: 2 /* RepositoryRefType.Commit */ } };
				} else {
					metadata = { v: 1, ref: { id: ref, type: 4 /* RepositoryRefType.Tree */ } };
				}
			}
		} else {
			switch (ref?.refType) {
				case 'revision':
				case 'stash':
					metadata = { v: 1, ref: { id: ref.ref, type: 2 /* RepositoryRefType.Commit */ } };
					break;
				case 'branch':
				case 'tag':
					metadata = { v: 1, ref: { id: ref.name, type: 4 /* RepositoryRefType.Tree */ } };
					break;
			}
		}

		if (typeof base === 'string') {
			base = Uri.parse(base, true);
		}

		if (path) {
			let basePath = base.path;
			if (basePath.endsWith('/')) {
				basePath = basePath.slice(0, -1);
			}

			path = this.getRelativePath(path, base);
			path = `${basePath}/${path.startsWith('/') ? path.slice(0, -1) : path}`;
		}

		return base.with({
			scheme: Schemes.Virtual,
			authority: encodeAuthority<GitHubAuthorityMetadata>('github', metadata),
			path: path ?? base.path,
		});
	}

	private createProviderUri(base: string | Uri, ref?: GitReference | string, path?: string): Uri {
		const uri = this.createVirtualUri(base, ref, path);
		if (this._remotehub == null) {
			debugger;
			return uri.scheme !== Schemes.Virtual ? uri : uri.with({ scheme: Schemes.GitHub });
		}

		return this._remotehub.getProviderUri(uri);
	}

	private getPagingLimit(limit?: number): number {
		limit = Math.min(100, limit ?? configuration.get('advanced.maxListItems') ?? 100);
		if (limit === 0) {
			limit = 100;
		}
		return limit;
	}

	private async resolveReferenceCore(
		repoPath: string,
		metadata: Metadata,
		ref?: string,
	): Promise<string | undefined> {
		if (ref == null || ref === 'HEAD') {
			const revision = await metadata.getRevision();
			return revision.revision;
		}

		if (isSha(ref)) return ref;

		// TODO@eamodio need to handle ranges
		if (isRevisionRange(ref)) return undefined;

		const [branchResults, tagResults] = await Promise.allSettled([
			this.getBranches(repoPath, { filter: b => b.name === ref }),
			this.getTags(repoPath, { filter: t => t.name === ref }),
		]);

		ref = getSettledValue(branchResults)?.values[0]?.sha ?? getSettledValue(tagResults)?.values[0]?.sha;
		if (ref == null) {
			debugger;
		}

		return ref;
	}

	private async getQueryArgsFromSearchQuery(
		search: SearchQuery,
		operations: Map<SearchOperators, Set<string>>,
		repoPath: string,
	) {
		const query = [];

		for (const [op, values] of operations.entries()) {
			switch (op) {
				case 'message:':
					query.push(...map(values, m => m.replace(/ /g, '+')));
					break;

				case 'author:': {
					let currentUser: GitUser | undefined;
					if (values.has('@me')) {
						currentUser = await this.getCurrentUser(repoPath);
					}

					for (let value of values) {
						if (!value) continue;
						value = value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '');
						if (!value) continue;

						if (value === '@me') {
							if (currentUser?.username == null) continue;

							value = `@${currentUser.username}`;
						}

						value = value.replace(/ /g, '+');
						if (value.startsWith('@')) {
							query.push(`author:${value.slice(1)}`);
						} else if (value.includes('@')) {
							query.push(`author-email:${value}`);
						} else {
							query.push(`author-name:${value}`);
						}
					}

					break;
				}
				// case 'change:':
				// case 'file:':
				// 	break;
			}
		}

		return query;
	}
}

function encodeAuthority<T>(scheme: string, metadata?: T): string {
	return `${scheme}${metadata != null ? `+${encodeUtf8Hex(JSON.stringify(metadata))}` : ''}`;
}

let ensuringProvider: Promise<boolean> | undefined;
async function ensureProviderLoaded<T extends (uri: Uri) => any>(
	uri: Uri,
	remotehub: RemoteHubApi,
	action: T,
): Promise<ReturnType<T>> {
	let retrying = false;
	while (true) {
		try {
			const result = await action(uri);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return result;
		} catch (ex) {
			// HACK: If the provider isn't loaded, try to force it to load
			if (!retrying && (/No provider registered/i.test(ex.message) || remotehub.getProvider(uri) == null)) {
				ensuringProvider ??= remotehub.loadWorkspaceContents(uri);
				try {
					await ensuringProvider;
					retrying = true;
					continue;
				} catch (_ex) {
					debugger;
				}
			}

			throw ex;
		}
	}
}

//** Strips `origin/` from a reference or range, because we "fake" origin as the default remote */
function stripOrigin<T extends string | GitRevisionRange | undefined>(ref: T): T {
	return ref?.replace(/(?:^|(?<=..))origin\//, '') as T;
}
