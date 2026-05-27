/* eslint-disable @typescript-eslint/require-await */
import type { AuthenticationSessionsChangeEvent, Disposable, WorkspaceFolder } from 'vscode';
import { authentication, Uri, window, workspace } from 'vscode';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import { getVisibilityCacheKey } from '@gitlens/git/utils/remote.utils.js';
import { isRevisionRange, isSha } from '@gitlens/git/utils/revision.utils.js';
import { decodeRemoteHubAuthority } from '@gitlens/git/utils/uriAuthority.js';
import type { GitHubSession } from '@gitlens/git-github/context.js';
import type { GitHubGitProviderOptions } from '@gitlens/git-github/providers/githubGitProvider.js';
import { GitHubGitProvider } from '@gitlens/git-github/providers/githubGitProvider.js';
import { CharCode } from '@gitlens/utils/charCode.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { encodeUtf8Hex } from '@gitlens/utils/hex.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScheme, isAbsolute, maybeUri, normalizePath } from '@gitlens/utils/path.js';
import { asSettled, getSettledValue } from '@gitlens/utils/promise.js';
import { joinUriPath, parseUri } from '@gitlens/utils/uri.js';
import { GitCloudHostIntegrationId } from '../../../../constants.integrations.js';
import { Schemes } from '../../../../constants.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ExtensionNotFoundError,
	OpenVirtualRepositoryError,
	OpenVirtualRepositoryErrorReason,
} from '../../../../errors.js';
import type { Features } from '../../../../features.js';
import type {
	GlGitProvider,
	RepositoryCloseEvent,
	RepositoryOpenEvent,
	RevisionUriOptions,
	ScmRepository,
} from '../../../../git/gitProvider.js';
import { createGitProviderContext } from '../../../../git/gitProviderContext.js';
import type { RepositoryChangeEvent } from '../../../../git/models/repository.js';
import { GlRepository } from '../../../../git/models/repository.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { setContext } from '../../../../system/-webview/context.js';
import { getBestPath, relative } from '../../../../system/-webview/path.js';
import { gate } from '../../../../system/decorators/gate.js';
import { getBuiltInIntegrationSession } from '../../../gk/utils/-webview/integrationAuthentication.utils.js';
import type { GitHubAuthorityMetadata, Metadata, RemoteHubApi } from '../../../remotehub.js';
import { getRemoteHubApi, HeadType, RepositoryRefType } from '../../../remotehub.js';
import type { IntegrationAuthenticationSessionDescriptor } from '../../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { toTokenWithInfo } from '../../authentication/models.js';
import type { GitHubApi } from './github.js';

const githubAuthenticationScopes = ['repo', 'read:user', 'user:email'];

export class GlGitHubGitProvider implements GlGitProvider {
	descriptor = { id: 'github' as const, name: 'GitHub', virtual: true };
	readonly authenticationDescriptor: IntegrationAuthenticationSessionDescriptor = {
		domain: 'github.com',
		scopes: githubAuthenticationScopes,
	};
	readonly authenticationProviderId = GitCloudHostIntegrationId.GitHub;
	readonly supportedSchemes = new Set<string>([Schemes.Virtual, Schemes.GitHub, Schemes.PRs]);

	private _onDidChange = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private _onWillChangeRepository = new Emitter<RepositoryChangeEvent>();
	get onWillChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onWillChangeRepository.event;
	}

	private _onDidChangeRepository = new Emitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private _onDidCloseRepository = new Emitter<RepositoryCloseEvent>();
	get onDidCloseRepository(): Event<RepositoryCloseEvent> {
		return this._onDidCloseRepository.event;
	}

	private _onDidOpenRepository = new Emitter<RepositoryOpenEvent>();
	get onDidOpenRepository(): Event<RepositoryOpenEvent> {
		return this._onDidOpenRepository.event;
	}

	private readonly _disposables: Disposable[] = [];
	private _provider: GitHubGitProvider | undefined;
	private _providerInitializing = false;

	constructor(
		private readonly container: Container,
		private readonly cache: Cache,
		private readonly register: (
			provider: GitProvider,
			canHandle: (repoPath: string) => boolean,
		) => UnifiedDisposable,
	) {
		this._disposables.push(
			this._onDidChange,
			this._onWillChangeRepository,
			this._onDidChangeRepository,
			this._onDidCloseRepository,
			this._onDidOpenRepository,
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
	}

	private get provider(): GitHubGitProvider {
		return this.ensureProvider();
	}

	ensureRegistered(): void {
		this.ensureProvider();
	}

	private ensureProvider(): GitHubGitProvider {
		if (this._provider == null) {
			if (this._providerInitializing) {
				debugger;
				throw new Error(`${getLoggableName(this)}: re-entrant access to provider getter during initialization`);
			}

			this._providerInitializing = true;
			try {
				this._provider = new GitHubGitProvider(this.getProviderOptions());
				this._disposables.push(
					this._provider,
					this.register(this._provider, repoPath => {
						const scheme = getScheme(repoPath);
						// Only handle virtual/GitHub schemes (excluding 'pr' which the extension resolves).
						return scheme === Schemes.Virtual || scheme === Schemes.GitHub;
					}),
				);
			} finally {
				this._providerInitializing = false;
			}
		}
		return this._provider;
	}

	/** Builds the options bag for the `GitHubGitProvider` */
	private getProviderOptions(): GitHubGitProviderOptions {
		const baseContext = createGitProviderContext(this.container);
		return {
			authenticationProviderId: this.authenticationProviderId,
			cache: this.cache,
			context: {
				...baseContext,
				config: {
					...baseContext.config!,
					get paging() {
						return { limit: configuration.get('advanced.maxListItems') ?? 100 };
					},
				},

				hasUncommittedChanges: async (repoPath, path) => {
					const repoUri = parseUri(repoPath, true);
					if (repoUri.scheme !== Schemes.Virtual) return false;

					const fileUri = joinUriPath(repoUri, path);
					const [working, committed] = await Promise.allSettled([
						workspace.fs.stat(fileUri),
						workspace.fs.stat(fileUri.with({ scheme: Schemes.GitHub })),
					]);

					return (
						working.status !== 'fulfilled' ||
						committed.status !== 'fulfilled' ||
						working.value.mtime !== committed.value.mtime
					);
				},

				resolveRepositoryContext: async (repoPath, open) => {
					const ctx = await this.ensureRepositoryContext(repoPath, open);
					return {
						github: ctx.github,
						metadata: {
							repo: { owner: ctx.metadata.repo.owner, name: ctx.metadata.repo.name },
							getRevision: () => ctx.metadata.getRevision(),
						},
						session: adaptSession(ctx.session),
					};
				},

				uris: {
					getRelativePath: (pathOrUri, base) => this.getRelativePath(pathOrUri, base),

					createProviderUri: (repoPath, rev, path) => this.createProviderUri(repoPath, rev, path),

					createVirtualUri: (repoPath, rev, path) => this.createVirtualUri(repoPath, rev, path),

					getBestRevisionUri: (repoPath, path, rev) => this.getBestRevisionUri(repoPath, path, rev),

					getAbsoluteUri: (pathOrUri, base) => this.getAbsoluteUri(pathOrUri, base),

					getProviderRootUri: uri => {
						// RemoteHub is always initialized before this is called because @gitlens/git-github
						// sub-providers call ensureRepositoryContext first, which triggers ensureRemoteHubApi.
						// Use the same fallback pattern as createProviderUri for safety.
						if (this._remotehub == null) {
							debugger;
							return Uri.parse(uri.toString(), true).with({ scheme: Schemes.GitHub });
						}
						return this._remotehub.getProviderRootUri(uri);
					},
				},
			},
		};
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		if (e.provider.id === this.authenticationProviderId) {
			this._sessionPromise = undefined;
			void this.ensureSession(false, true);
		}
	}

	private createRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		closed?: boolean,
	): GlRepository {
		const repo = new GlRepository(
			this.container,
			this.descriptor,
			folder,
			uri,
			gitDir,
			root,
			closed ?? false,
			!window.state.focused,
		);

		repo.onDidChange(e => {
			this.cache.onRepositoryChanged(repo.path, [...e.changes]);
			this._onWillChangeRepository.fire(e);
			this._onDidChangeRepository.fire(e);
		});

		return repo;
	}

	async discoverRepositories(
		uri: Uri,
		options?: { cancellation?: AbortSignal; depth?: number; silent?: boolean },
	): Promise<GlRepository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		try {
			const { remotehub } = await this.ensureRepositoryContext(uri.toString(), true);
			const workspaceUri = remotehub.getVirtualWorkspaceUri(uri);
			if (workspaceUri == null) return [];

			return this.openRepository(undefined, workspaceUri, undefined, true, options?.silent);
		} catch (ex) {
			if (ex.message.startsWith('No provider registered with')) {
				Logger.error(ex, 'No GitHub provider registered with Remote Repositories (yet); retrying');
				return this.discoverRepositoriesPending(uri, options);
			}
			return [];
		}
	}

	private async discoverRepositoriesPending(
		uri: Uri,
		options?: { cancellation?: AbortSignal; depth?: number; silent?: boolean },
	): Promise<GlRepository[]> {
		const remotehub = await getRemoteHubApi();

		for (let attempt = 0; attempt < 20; attempt++) {
			await new Promise<void>(resolve => setTimeout(resolve, 250));

			if (options?.cancellation?.aborted) return [];
			if (remotehub.getProvider(uri) == null) continue;

			try {
				const workspaceUri = remotehub.getVirtualWorkspaceUri(uri);
				if (workspaceUri == null) return [];

				return this.openRepository(undefined, workspaceUri, undefined, true, options?.silent);
			} catch {
				return [];
			}
		}

		return [];
	}

	updateContext(): void {
		void setContext('gitlens:hasVirtualFolders', this.container.git.hasOpenRepositories(this.descriptor.id));
	}

	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		closed?: boolean,
	): GlRepository[] {
		// Ensure the library-level provider is registered before any GlRepository is created,
		// so the library's GitService can route this repo's path to the GitHub provider.
		this.ensureProvider();

		return [this.createRepository(folder ?? workspace.getWorkspaceFolder(uri), uri, gitDir, root, closed)];
	}

	async supports(feature: Features): Promise<boolean> {
		let supported;
		switch (feature) {
			case 'timeline':
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
		const remotes = await this.provider.remotes.getRemotes(repoPath, { sort: true });
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
					toTokenWithInfo(this.authenticationProviderId, session),
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

	async getOrOpenScmRepository(_repoPath: string, _source?: Source): Promise<ScmRepository | undefined> {
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
			if (!isAbsolute(normalized)) return joinUriPath(base, normalized);
		}

		const relativePath = this.getRelativePath(pathOrUri, base);
		return joinUriPath(base, relativePath);
	}

	@debug()
	async getBestRevisionUri(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
	): Promise<Uri | undefined> {
		const path = getBestPath(pathOrUri);
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

	getRevisionUri(repoPath: string, rev: string, path: string, _options?: RevisionUriOptions): Uri {
		const uri = this.createProviderUri(repoPath, rev, path);
		return rev === deletedOrMissing ? uri.with({ query: '~' }) : uri;
	}

	@debug()
	async getWorkingUri(repoPath: string, uri: Uri): Promise<Uri> {
		return this.createVirtualUri(repoPath, undefined, uri.path);
	}

	@debug({ exit: true })
	async isFolderUri(repoPath: string, uri: Uri): Promise<boolean> {
		// Check if it's a directory via the tree entry
		const relativePath = this.getRelativePath(uri, repoPath);
		const tree = await this.provider.revision.getTreeEntryForRevision(repoPath, relativePath, 'HEAD');
		return tree?.type === 'tree';
	}

	@debug({ args: (_repoPath, uris) => ({ uris: uris.length }) })
	async excludeIgnoredUris(_repoPath: string, uris: Uri[]): Promise<Uri[]> {
		return uris;
	}

	async getIgnoredUrisFilter(_repoPath: string): Promise<(uri: Uri) => boolean> {
		return () => false;
	}

	@gate()
	@trace()
	async findRepositoryUri(uri: Uri, _isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getScopedLogger();

		try {
			const remotehub = await this.ensureRemoteHubApi();

			return await ensureProviderLoaded(uri, remotehub, uri =>
				remotehub.getProviderRootUri(uri).with({ scheme: Schemes.Virtual }),
			);
		} catch (ex) {
			if (!(ex instanceof ExtensionNotFoundError)) {
				debugger;
			}
			scope?.error(ex);

			return undefined;
		}
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

	@gate()
	private async ensureRepositoryContext(
		repoPath: string,
		open?: boolean,
	): Promise<{
		github: GitHubApi;
		metadata: Metadata;
		remotehub: RemoteHubApi;
		session: ProviderAuthenticationSession;
	}> {
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

	private _sessionPromise: Promise<ProviderAuthenticationSession> | undefined;
	private async ensureSession(
		force: boolean = false,
		silent: boolean = false,
	): Promise<ProviderAuthenticationSession> {
		if (force || this._sessionPromise == null) {
			async function getSession(this: GlGitHubGitProvider): Promise<ProviderAuthenticationSession> {
				let skip = this.container.storage.get(`provider:authentication:skip:${this.descriptor.id}`, false);

				try {
					let session;
					if (force) {
						skip = false;
						void this.container.storage.delete(`provider:authentication:skip:${this.descriptor.id}`);

						session = await getBuiltInIntegrationSession(
							this.container,
							GitCloudHostIntegrationId.GitHub,
							this.authenticationDescriptor,
							{ forceNewSession: true },
						);
					} else if (!skip && !silent) {
						session = await getBuiltInIntegrationSession(
							this.container,
							GitCloudHostIntegrationId.GitHub,
							this.authenticationDescriptor,
							{ createIfNeeded: true },
						);
					} else {
						session = await getBuiltInIntegrationSession(
							this.container,
							GitCloudHostIntegrationId.GitHub,
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
						throw new AuthenticationError(
							// scopes and other fields are undefined here because the token has not been issues:
							{
								providerId: this.authenticationProviderId,
								microHash: undefined,
								cloud: false,
								type: undefined,
								scopes: undefined,
							},
							AuthenticationErrorReason.UserDidNotConsent,
						);
					}

					Logger.error(ex);
					debugger;
					throw new AuthenticationError(
						// scopes and other fields are undefined here because the token has not been issues:
						{
							providerId: this.authenticationProviderId,
							microHash: undefined,
							cloud: false,
							type: undefined,
							scopes: undefined,
						},
						undefined,
						ex,
					);
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
			this.provider.branches.getBranches(repoPath, { filter: b => b.name === ref }),
			this.provider.tags.getTags(repoPath, { filter: t => t.name === ref }),
		]);

		ref = getSettledValue(branchResults)?.values[0]?.sha ?? getSettledValue(tagResults)?.values[0]?.sha;
		if (ref == null) {
			debugger;
		}

		return ref;
	}
}

function adaptSession(session: ProviderAuthenticationSession): GitHubSession {
	return {
		account: { label: session.account.label },
		accessToken: session.accessToken,
		cloud: session.cloud,
		type: session.type,
		scopes: session.scopes,
		domain: session.domain,
	};
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
