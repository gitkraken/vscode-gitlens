/* eslint-disable @typescript-eslint/require-await */
import type {
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	CancellationToken,
	Disposable,
	Event,
	Range,
	TextDocument,
	WorkspaceFolder,
} from 'vscode';
import { authentication, EventEmitter, Uri, window, workspace } from 'vscode';
import { encodeUtf8Hex } from '@env/hex';
import { CharCode, Schemes } from '../../../../constants';
import { HostingIntegrationId } from '../../../../constants.integrations';
import type { Container } from '../../../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ExtensionNotFoundError,
	OpenVirtualRepositoryError,
	OpenVirtualRepositoryErrorReason,
} from '../../../../errors';
import type { Features } from '../../../../features';
import { GitCache } from '../../../../git/cache';
import type {
	GitProvider,
	RepositoryCloseEvent,
	RepositoryOpenEvent,
	RepositoryVisibility,
	ScmRepository,
} from '../../../../git/gitProvider';
import type { GitUri } from '../../../../git/gitUri';
import { decodeRemoteHubAuthority } from '../../../../git/gitUri.authority';
import type { GitBlame, GitBlameAuthor, GitBlameLine } from '../../../../git/models/blame';
import type { GitCommitLine } from '../../../../git/models/commit';
import { GitCommit, GitCommitIdentity } from '../../../../git/models/commit';
import type { GitLineDiff, ParsedGitDiffHunks } from '../../../../git/models/diff';
import { GitFileChange } from '../../../../git/models/fileChange';
import { GitFileIndexStatus } from '../../../../git/models/fileStatus';
import type { GitLog } from '../../../../git/models/log';
import type { GitReference } from '../../../../git/models/reference';
import type { GitRemote } from '../../../../git/models/remote';
import type { RepositoryChangeEvent } from '../../../../git/models/repository';
import { Repository } from '../../../../git/models/repository';
import type { GitRevisionRange } from '../../../../git/models/revision';
import { deletedOrMissing } from '../../../../git/models/revision';
import { getVisibilityCacheKey } from '../../../../git/utils/remote.utils';
import { isRevisionRange, isSha } from '../../../../git/utils/revision.utils';
import { configuration } from '../../../../system/-webview/configuration';
import { setContext } from '../../../../system/-webview/context';
import { relative } from '../../../../system/-webview/path';
import { gate } from '../../../../system/decorators/-webview/gate';
import { debug, log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import type { LogScope } from '../../../../system/logger.scope';
import { getLogScope } from '../../../../system/logger.scope';
import { isAbsolute, maybeUri, normalizePath } from '../../../../system/path';
import { asSettled, getSettledValue } from '../../../../system/promise';
import type { CachedBlame, TrackedGitDocument } from '../../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../../trackers/trackedDocument';
import { getBuiltInIntegrationSession } from '../../../gk/utils/-webview/integrationAuthentication.utils';
import type { GitHubAuthorityMetadata, Metadata, RemoteHubApi } from '../../../remotehub';
import { getRemoteHubApi, HeadType, RepositoryRefType } from '../../../remotehub';
import type { IntegrationAuthenticationSessionDescriptor } from '../../authentication/integrationAuthenticationProvider';
import type { GitHubApi } from './github';
import { BranchesGitSubProvider } from './sub-providers/branches';
import { CommitsGitSubProvider } from './sub-providers/commits';
import { ConfigGitSubProvider } from './sub-providers/config';
import { ContributorsGitSubProvider } from './sub-providers/contributors';
import { DiffGitSubProvider } from './sub-providers/diff';
import { GraphGitSubProvider } from './sub-providers/graph';
import { RefsGitSubProvider } from './sub-providers/refs';
import { RemotesGitSubProvider } from './sub-providers/remotes';
import { RevisionGitSubProvider } from './sub-providers/revision';
import { StatusGitSubProvider } from './sub-providers/status';
import { TagsGitSubProvider } from './sub-providers/tags';

const emptyPromise: Promise<GitBlame | ParsedGitDiffHunks | GitLog | undefined> = Promise.resolve(undefined);

const githubAuthenticationScopes = ['repo', 'read:user', 'user:email'];

export type GitHubGitProviderInternal = Omit<
	GitHubGitProvider,
	'ensureRepositoryContext' | 'createProviderUri' | 'createVirtualUri'
> & {
	ensureRepositoryContext: GitHubGitProvider['ensureRepositoryContext'];
	createProviderUri: GitHubGitProvider['createProviderUri'];
	createVirtualUri: GitHubGitProvider['createVirtualUri'];
};

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

	private readonly _cache: GitCache;
	private readonly _disposables: Disposable[] = [];

	constructor(private readonly container: Container) {
		this._cache = new GitCache(this.container);
		this._disposables.push(
			this._onDidChange,
			this._onWillChangeRepository,
			this._onDidChangeRepository,
			this._onDidCloseRepository,
			this._onDidOpenRepository,
			this._cache,
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		if (e.provider.id === this.authenticationProviderId) {
			this._sessionPromise = undefined;
			void this.ensureSession(false, true);
		}
	}

	private onRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		this._cache.clearCaches(repo.path);
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

	async supports(feature: Features): Promise<boolean> {
		let supported;
		switch (feature) {
			case 'timeline' satisfies Features:
				supported = true;
				break;
			default:
				supported = false;
				break;
		}

		void setContext(`gitlens:feature:unsupported:${feature}`, !supported);
		return supported;
	}

	async visibility(repoPath: string): Promise<[visibility: RepositoryVisibility, cacheKey: string | undefined]> {
		const remotes = await this.remotes.getRemotes(repoPath, { sort: true });
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
	async getBestRevisionUri(repoPath: string, path: string, rev: string | undefined): Promise<Uri | undefined> {
		return rev ? this.createProviderUri(repoPath, rev, path) : this.createVirtualUri(repoPath, rev, path);
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

	getRevisionUri(repoPath: string, rev: string, path: string): Uri {
		const uri = this.createProviderUri(repoPath, rev, path);
		return rev === deletedOrMissing ? uri.with({ query: '~' }) : uri;
	}

	@log()
	async getWorkingUri(repoPath: string, uri: Uri): Promise<Uri> {
		return this.createVirtualUri(repoPath, undefined, uri.path);
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
						{
							files: [
								new GitFileChange(
									this.container,
									root.toString(),
									relativePath,
									GitFileIndexStatus.Modified,
								),
							],
							filtered: true,
							pathspec: relativePath,
						},
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
				const msg: string = ex?.toString() ?? '';
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
				{
					files: [
						new GitFileChange(this.container, root.toString(), relativePath, GitFileIndexStatus.Modified),
					],
					filtered: true,
					pathspec: relativePath,
				},
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
	async getDiffForFile(
		_uri: GitUri,
		_ref1: string | undefined,
		_ref2?: string,
	): Promise<ParsedGitDiffHunks | undefined> {
		return undefined;
	}

	@log({
		args: {
			1: _contents => '<contents>',
		},
	})
	async getDiffForFileContents(
		_uri: GitUri,
		_ref: string,
		_contents: string,
	): Promise<ParsedGitDiffHunks | undefined> {
		return undefined;
	}

	@log()
	async getDiffForLine(
		_uri: GitUri,
		_editorLine: number, // 0-based, Git is 1-based
		_ref1: string | undefined,
		_ref2?: string,
	): Promise<GitLineDiff | undefined> {
		return undefined;
	}

	async getLastFetchedTimestamp(_repoPath: string): Promise<number | undefined> {
		return undefined;
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

	private _branches: BranchesGitSubProvider | undefined;
	get branches(): BranchesGitSubProvider {
		return (this._branches ??= new BranchesGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _commits: CommitsGitSubProvider | undefined;
	get commits(): CommitsGitSubProvider {
		return (this._commits ??= new CommitsGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _config: ConfigGitSubProvider | undefined;
	get config(): ConfigGitSubProvider {
		return (this._config ??= new ConfigGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _contributors: ContributorsGitSubProvider | undefined;
	get contributors(): ContributorsGitSubProvider {
		return (this._contributors ??= new ContributorsGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _diff: DiffGitSubProvider | undefined;
	get diff(): DiffGitSubProvider {
		return (this._diff ??= new DiffGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _graph: GraphGitSubProvider | undefined;
	get graph(): GraphGitSubProvider {
		return (this._graph ??= new GraphGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _refs: RefsGitSubProvider | undefined;
	get refs(): RefsGitSubProvider {
		return (this._refs ??= new RefsGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _remotes: RemotesGitSubProvider | undefined;
	get remotes(): RemotesGitSubProvider {
		return (this._remotes ??= new RemotesGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _revision: RevisionGitSubProvider | undefined;
	get revision(): RevisionGitSubProvider {
		return (this._revision ??= new RevisionGitSubProvider(
			this.container,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _status: StatusGitSubProvider | undefined;
	get status(): StatusGitSubProvider {
		return (this._status ??= new StatusGitSubProvider(
			this.container,
			this as unknown as GitHubGitProviderInternal,
		));
	}

	private _tags: TagsGitSubProvider | undefined;
	get tags(): TagsGitSubProvider {
		return (this._tags ??= new TagsGitSubProvider(
			this.container,
			this._cache,
			this as unknown as GitHubGitProviderInternal,
		));
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
		if (force || this._sessionPromise == null) {
			async function getSession(this: GitHubGitProvider): Promise<AuthenticationSession> {
				let skip = this.container.storage.get(`provider:authentication:skip:${this.descriptor.id}`, false);

				try {
					let session;
					if (force) {
						skip = false;
						void this.container.storage.delete(`provider:authentication:skip:${this.descriptor.id}`);

						session = await getBuiltInIntegrationSession(
							this.container,
							HostingIntegrationId.GitHub,
							this.authenticationDescriptor,
							{ forceNewSession: true },
						);
					} else if (!skip && !silent) {
						session = await getBuiltInIntegrationSession(
							this.container,
							HostingIntegrationId.GitHub,
							this.authenticationDescriptor,
							{ createIfNeeded: true },
						);
					} else {
						session = await getBuiltInIntegrationSession(
							this.container,
							HostingIntegrationId.GitHub,
							this.authenticationDescriptor,
						);
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

	getPagingLimit(limit?: number): number {
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
			this.branches.getBranches(repoPath, { filter: b => b.name === ref }),
			this.tags.getTags(repoPath, { filter: t => t.name === ref }),
		]);

		ref = getSettledValue(branchResults)?.values[0]?.sha ?? getSettledValue(tagResults)?.values[0]?.sha;
		if (ref == null) {
			debugger;
		}

		return ref;
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
export function stripOrigin<T extends string | GitRevisionRange | undefined>(ref: T): T {
	return ref?.replace(/(?:^|(?<=..))origin\//, '') as T;
}
