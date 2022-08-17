import type { AuthenticationSession, AuthenticationSessionsChangeEvent, Event, MessageItem, Range } from 'vscode';
import { authentication, env, EventEmitter, Uri, window } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import { isWeb } from '@env/platform';
import type { DynamicAutolinkReference } from '../../annotations/autolinks';
import type { AutolinkReference } from '../../config';
import { configuration } from '../../configuration';
import { Container } from '../../container';
import { AuthenticationError, ProviderRequestClientError } from '../../errors';
import { Logger } from '../../logger';
import { showIntegrationDisconnectedTooManyFailedRequestsWarningMessage } from '../../messages';
import type { IntegrationAuthenticationSessionDescriptor } from '../../plus/integrationAuthentication';
import { gate } from '../../system/decorators/gate';
import { debug, getLogScope, log } from '../../system/decorators/log';
import { encodeUrl } from '../../system/encoding';
import { isPromise } from '../../system/promise';
import type { Account } from '../models/author';
import type { GitCommit } from '../models/commit';
import type { DefaultBranch } from '../models/defaultBranch';
import type { IssueOrPullRequest } from '../models/issue';
import type { PullRequest, PullRequestState } from '../models/pullRequest';
import type { RemoteProviderReference } from '../models/remoteProvider';
import type { Repository } from '../models/repository';

export const enum RemoteResourceType {
	Branch = 'branch',
	Branches = 'branches',
	Commit = 'commit',
	Comparison = 'comparison',
	CreatePullRequest = 'createPullRequest',
	File = 'file',
	Repo = 'repo',
	Revision = 'revision',
}

export type RemoteResource =
	| {
			type: RemoteResourceType.Branch;
			branch: string;
	  }
	| {
			type: RemoteResourceType.Branches;
	  }
	| {
			type: RemoteResourceType.Commit;
			sha: string;
	  }
	| {
			type: RemoteResourceType.Comparison;
			base: string;
			compare: string;
			notation?: '..' | '...';
	  }
	| {
			type: RemoteResourceType.CreatePullRequest;
			base: {
				branch?: string;
				remote: { path: string; url: string };
			};
			compare: {
				branch: string;
				remote: { path: string; url: string };
			};
	  }
	| {
			type: RemoteResourceType.File;
			branchOrTag?: string;
			fileName: string;
			range?: Range;
	  }
	| {
			type: RemoteResourceType.Repo;
	  }
	| {
			type: RemoteResourceType.Revision;
			branchOrTag?: string;
			commit?: GitCommit;
			fileName: string;
			range?: Range;
			sha?: string;
	  };

export function getNameFromRemoteResource(resource: RemoteResource) {
	switch (resource.type) {
		case RemoteResourceType.Branch:
			return 'Branch';
		case RemoteResourceType.Branches:
			return 'Branches';
		case RemoteResourceType.Commit:
			return 'Commit';
		case RemoteResourceType.Comparison:
			return 'Comparison';
		case RemoteResourceType.CreatePullRequest:
			return 'Create Pull Request';
		case RemoteResourceType.File:
			return 'File';
		case RemoteResourceType.Repo:
			return 'Repository';
		case RemoteResourceType.Revision:
			return 'File';
		default:
			return '';
	}
}

export abstract class RemoteProvider implements RemoteProviderReference {
	readonly type: 'simple' | 'rich' = 'simple';
	protected readonly _name: string | undefined;

	constructor(
		public readonly domain: string,
		public readonly path: string,
		public readonly protocol: string = 'https',
		name?: string,
		public readonly custom: boolean = false,
	) {
		this._name = name;
	}

	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		return [];
	}

	get displayPath(): string {
		return this.path;
	}

	get icon(): string {
		return 'remote';
	}

	abstract get id(): string;
	abstract get name(): string;

	async copy(resource: RemoteResource): Promise<void> {
		const url = this.url(resource);
		if (url == null) return;

		await env.clipboard.writeText(url);
	}

	hasRichApi(): this is RichRemoteProvider {
		return RichRemoteProvider.is(this);
	}

	abstract getLocalInfoFromRemoteUri(
		repository: Repository,
		uri: Uri,
		options?: { validate?: boolean },
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined>;

	open(resource: RemoteResource): Promise<boolean | undefined> {
		return this.openUrl(this.url(resource));
	}

	url(resource: RemoteResource): string | undefined {
		switch (resource.type) {
			case RemoteResourceType.Branch:
				return this.getUrlForBranch(resource.branch);
			case RemoteResourceType.Branches:
				return this.getUrlForBranches();
			case RemoteResourceType.Commit:
				return this.getUrlForCommit(resource.sha);
			case RemoteResourceType.Comparison: {
				return this.getUrlForComparison?.(resource.base, resource.compare, resource.notation ?? '...');
			}
			case RemoteResourceType.CreatePullRequest: {
				return this.getUrlForCreatePullRequest?.(resource.base, resource.compare);
			}
			case RemoteResourceType.File:
				return this.getUrlForFile(
					resource.fileName,
					resource.branchOrTag != null ? resource.branchOrTag : undefined,
					undefined,
					resource.range,
				);
			case RemoteResourceType.Repo:
				return this.getUrlForRepository();
			case RemoteResourceType.Revision:
				return this.getUrlForFile(
					resource.fileName,
					resource.branchOrTag != null ? resource.branchOrTag : undefined,
					resource.sha != null ? resource.sha : undefined,
					resource.range,
				);
			default:
				return undefined;
		}
	}

	protected get baseUrl(): string {
		return `${this.protocol}://${this.domain}/${this.path}`;
	}

	protected formatName(name: string) {
		if (this._name != null) return this._name;
		return `${name}${this.custom ? ` (${this.domain})` : ''}`;
	}

	protected splitPath(): [string, string] {
		const index = this.path.indexOf('/');
		return [this.path.substring(0, index), this.path.substring(index + 1)];
	}

	protected abstract getUrlForBranch(branch: string): string;

	protected abstract getUrlForBranches(): string;

	protected abstract getUrlForCommit(sha: string): string;

	protected getUrlForComparison?(base: string, compare: string, notation: '..' | '...'): string | undefined;

	protected getUrlForCreatePullRequest?(
		base: { branch?: string; remote: { path: string; url: string } },
		compare: { branch: string; remote: { path: string; url: string } },
	): string | undefined;

	protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

	protected getUrlForRepository(): string {
		return this.baseUrl;
	}

	private async openUrl(url?: string): Promise<boolean | undefined> {
		if (url == null) return undefined;

		const uri = Uri.parse(url);
		// Pass a string to openExternal to avoid double encoding issues: https://github.com/microsoft/vscode/issues/85930
		if (uri.path.includes('#')) {
			// .d.ts currently says it only supports a Uri, but it actually accepts a string too
			return (env.openExternal as unknown as (target: string) => Thenable<boolean>)(uri.toString());
		}
		return env.openExternal(uri);
	}

	protected encodeUrl(url: string): string;
	protected encodeUrl(url: string | undefined): string | undefined;
	protected encodeUrl(url: string | undefined): string | undefined {
		return encodeUrl(url)?.replace(/#/g, '%23');
	}
}

const _connectedCache = new Set<string>();
const _onDidChangeAuthentication = new EventEmitter<{ reason: 'connected' | 'disconnected'; key: string }>();
function fireAuthenticationChanged(key: string, reason: 'connected' | 'disconnected') {
	// Only fire events if the key is being connected for the first time (we could probably do the same for disconnected, but better safe on those imo)
	if (_connectedCache.has(key)) {
		if (reason === 'connected') return;

		_connectedCache.delete(key);
	} else if (reason === 'connected') {
		_connectedCache.add(key);
	}

	_onDidChangeAuthentication.fire({ key: key, reason: reason });
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Authentication {
	static get onDidChange(): Event<{ reason: 'connected' | 'disconnected'; key: string }> {
		return _onDidChangeAuthentication.event;
	}
}

// TODO@eamodio revisit how once authenticated, all remotes are always connected, even after a restart

export abstract class RichRemoteProvider extends RemoteProvider {
	override readonly type: 'simple' | 'rich' = 'rich';

	static is(provider: RemoteProvider | undefined): provider is RichRemoteProvider {
		return provider?.type === 'rich';
	}

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	constructor(domain: string, path: string, protocol?: string, name?: string, custom?: boolean) {
		super(domain, path, protocol, name, custom);

		Container.instance.context.subscriptions.push(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this._ignoreSSLErrors.clear();
				}
			}),
			// TODO@eamodio revisit how connections are linked or not
			Authentication.onDidChange(e => {
				if (e.key !== this.key) return;

				if (e.reason === 'disconnected') {
					void this.disconnect({ silent: true });
				} else if (e.reason === 'connected') {
					void this.ensureSession(false);
				}
			}),
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	abstract get apiBaseUrl(): string;
	protected abstract get authProvider(): { id: string; scopes: string[] };
	protected get authProviderDescriptor(): IntegrationAuthenticationSessionDescriptor {
		return { domain: this.domain, scopes: this.authProvider.scopes };
	}

	private get key() {
		return this.custom ? `${this.name}:${this.domain}` : this.name;
	}

	private get connectedKey(): `connected:${string}` {
		return `connected:${this.key}`;
	}

	get maybeConnected(): boolean | undefined {
		if (this._session === undefined) return undefined;

		return this._session !== null;
	}

	protected _session: AuthenticationSession | null | undefined;
	protected session() {
		if (this._session === undefined) {
			return this.ensureSession(false);
		}
		return this._session ?? undefined;
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		if (e.provider.id === this.authProvider.id) {
			void this.ensureSession(false);
		}
	}

	@log()
	async connect(): Promise<boolean> {
		try {
			const session = await this.ensureSession(true);
			return Boolean(session);
		} catch (ex) {
			return false;
		}
	}

	@gate()
	@log()
	async disconnect(options?: { silent?: boolean; currentSessionOnly?: boolean }): Promise<void> {
		if (options?.currentSessionOnly && this._session === null) return;

		const connected = this._session != null;

		const container = Container.instance;

		if (connected && !options?.silent) {
			if (options?.currentSessionOnly) {
				void showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(this.name);
			} else {
				const disable = { title: 'Disable' };
				const signout = { title: 'Disable & Sign Out' };
				const cancel = { title: 'Cancel', isCloseAffordance: true };

				let result: MessageItem | undefined;
				if (container.integrationAuthentication.hasProvider(this.authProvider.id)) {
					result = await window.showWarningMessage(
						`Are you sure you want to disable the rich integration with ${this.name}?\n\nNote: signing out clears the saved authentication.`,
						{ modal: true },
						disable,
						signout,
						cancel,
					);
				} else {
					result = await window.showWarningMessage(
						`Are you sure you want to disable the rich integration with ${this.name}?`,
						{ modal: true },
						disable,
						cancel,
					);
				}

				if (result == null || result === cancel) return;
				if (result === signout) {
					void container.integrationAuthentication.deleteSession(this.id, this.authProviderDescriptor);
				}
			}
		}

		this.resetRequestExceptionCount();
		this._prsByCommit.clear();
		this._session = null;

		if (connected) {
			// Don't store the disconnected flag if this only for this current VS Code session (will be re-connected on next restart)
			if (!options?.currentSessionOnly) {
				void container.storage.storeWorkspace(this.connectedKey, false);
			}

			this._onDidChange.fire();
			if (!options?.silent && !options?.currentSessionOnly) {
				fireAuthenticationChanged(this.key, 'disconnected');
			}
		}
	}

	@log()
	async reauthenticate(): Promise<void> {
		if (this._session === undefined) return;

		this._session = undefined;
		void (await this.ensureSession(true, true));
	}

	private requestExceptionCount = 0;

	resetRequestExceptionCount() {
		this.requestExceptionCount = 0;
	}

	@debug()
	trackRequestException() {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= 5 && this._session !== null) {
			void this.disconnect({ currentSessionOnly: true });
		}
	}

	@gate()
	@debug<RichRemoteProvider['isConnected']>({
		exit: connected => `returned ${connected}`,
	})
	async isConnected(): Promise<boolean> {
		return (await this.session()) != null;
	}

	@gate()
	@debug()
	async getAccountForCommit(
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForCommit(this._session!, ref, options);
			this.resetRequestExceptionCount();
			return author;
		} catch (ex) {
			Logger.error(ex, scope);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.trackRequestException();
			}
			return undefined;
		}
	}

	protected abstract getProviderAccountForCommit(
		session: AuthenticationSession,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getAccountForEmail(
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForEmail(this._session!, email, options);
			this.resetRequestExceptionCount();
			return author;
		} catch (ex) {
			Logger.error(ex, scope);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.trackRequestException();
			}
			return undefined;
		}
	}

	protected abstract getProviderAccountForEmail(
		session: AuthenticationSession,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getDefaultBranch(): Promise<DefaultBranch | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const defaultBranch = await this.getProviderDefaultBranch(this._session!);
			this.resetRequestExceptionCount();
			return defaultBranch;
		} catch (ex) {
			Logger.error(ex, scope);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.trackRequestException();
			}
			return undefined;
		}
	}

	protected abstract getProviderDefaultBranch({
		accessToken,
	}: AuthenticationSession): Promise<DefaultBranch | undefined>;

	@gate()
	@debug()
	async getIssueOrPullRequest(id: string): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issueOrPullRequest = await this.getProviderIssueOrPullRequest(this._session!, id);
			this.resetRequestExceptionCount();
			return issueOrPullRequest;
		} catch (ex) {
			Logger.error(ex, scope);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.trackRequestException();
			}
			return undefined;
		}
	}

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	getIgnoreSSLErrors(): boolean | 'force' {
		if (isWeb) return false;

		let ignoreSSLErrors = this._ignoreSSLErrors.get(this.id);
		if (ignoreSSLErrors === undefined) {
			const cfg = configuration
				.get('remotes')
				?.find(remote => remote.type.toLowerCase() === this.id && remote.domain === this.domain);
			ignoreSSLErrors = cfg?.ignoreSSLErrors ?? false;
			this._ignoreSSLErrors.set(this.id, ignoreSSLErrors);
		}

		return ignoreSSLErrors;
	}

	protected abstract getProviderIssueOrPullRequest(
		session: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined>;

	@gate()
	@debug()
	async getPullRequestForBranch(
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const pr = await this.getProviderPullRequestForBranch(this._session!, branch, options);
			this.resetRequestExceptionCount();
			return pr;
		} catch (ex) {
			Logger.error(ex, scope);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.trackRequestException();
			}
			return undefined;
		}
	}
	protected abstract getProviderPullRequestForBranch(
		session: AuthenticationSession,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined>;

	private _prsByCommit = new Map<string, Promise<PullRequest | null> | PullRequest | null>();

	@debug()
	getPullRequestForCommit(ref: string): Promise<PullRequest | undefined> | PullRequest | undefined {
		let pr = this._prsByCommit.get(ref);
		if (pr === undefined) {
			pr = this.getPullRequestForCommitCore(ref);
			this._prsByCommit.set(ref, pr);
		}
		if (pr == null || !isPromise(pr)) return pr ?? undefined;

		return pr.then(pr => pr ?? undefined);
	}

	@debug()
	private async getPullRequestForCommitCore(ref: string) {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return null;

		try {
			const pr = (await this.getProviderPullRequestForCommit(this._session!, ref)) ?? null;
			this._prsByCommit.set(ref, pr);
			this.resetRequestExceptionCount();
			return pr;
		} catch (ex) {
			Logger.error(ex, scope);

			this._prsByCommit.delete(ref);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.trackRequestException();
			}
			return null;
		}
	}

	protected abstract getProviderPullRequestForCommit(
		session: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined>;

	@gate()
	private async ensureSession(
		createIfNeeded: boolean,
		forceNewSession: boolean = false,
	): Promise<AuthenticationSession | undefined> {
		if (this._session != null) return this._session;
		if (!configuration.get('integrations.enabled')) return undefined;

		const { instance: container } = Container;

		if (createIfNeeded) {
			await container.storage.deleteWorkspace(this.connectedKey);
		} else if (container.storage.getWorkspace(this.connectedKey) === false) {
			return undefined;
		}

		let session: AuthenticationSession | undefined | null;
		try {
			if (container.integrationAuthentication.hasProvider(this.authProvider.id)) {
				session = await container.integrationAuthentication.getSession(
					this.authProvider.id,
					this.authProviderDescriptor,
					{ createIfNeeded: createIfNeeded, forceNewSession: forceNewSession },
				);
			} else {
				session = await wrapForForcedInsecureSSL(this.getIgnoreSSLErrors(), () =>
					authentication.getSession(this.authProvider.id, this.authProvider.scopes, {
						createIfNone: forceNewSession ? undefined : createIfNeeded,
						silent: !createIfNeeded && !forceNewSession ? true : undefined,
						forceNewSession: forceNewSession ? true : undefined,
					}),
				);
			}
		} catch (ex) {
			await container.storage.deleteWorkspace(this.connectedKey);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNeeded) {
			await container.storage.deleteWorkspace(this.connectedKey);
		}

		this._session = session ?? null;
		this.resetRequestExceptionCount();

		if (session != null) {
			await container.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				fireAuthenticationChanged(this.key, 'connected');
			});
		}

		return session ?? undefined;
	}
}
