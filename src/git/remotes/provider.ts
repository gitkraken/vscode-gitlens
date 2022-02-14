import {
	authentication,
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	env,
	Event,
	EventEmitter,
	Range,
	Uri,
} from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { Container } from '../../container';
import { AuthenticationError, ProviderRequestClientError } from '../../errors';
import { Logger } from '../../logger';
import { WorkspaceStorageKeys } from '../../storage';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { encodeUrl } from '../../system/encoding';
import { isPromise } from '../../system/promise';
import {
	Account,
	DefaultBranch,
	GitCommit,
	IssueOrPullRequest,
	PullRequest,
	PullRequestState,
	RemoteProviderReference,
	Repository,
} from '../models';

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

		void (await env.clipboard.writeText(url));
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

		return env.openExternal(Uri.parse(url));
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

	private invalidClientExceptionCount = 0;

	constructor(domain: string, path: string, protocol?: string, name?: string, custom?: boolean) {
		super(domain, path, protocol, name, custom);

		Container.instance.context.subscriptions.push(
			// TODO@eamodio revisit how connections are linked or not
			Authentication.onDidChange(e => {
				if (e.key !== this.key) return;

				if (e.reason === 'disconnected') {
					this.disconnect(true);
				} else if (e.reason === 'connected') {
					void this.ensureSession(false);
				}
			}),
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	abstract get apiBaseUrl(): string;
	protected abstract get authProvider(): { id: string; scopes: string[] };

	private get key() {
		return this.custom ? `${this.name}:${this.domain}` : this.name;
	}

	private get connectedKey(): `${WorkspaceStorageKeys.ConnectedPrefix}${string}` {
		return `${WorkspaceStorageKeys.ConnectedPrefix}${this.key}`;
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

	@log()
	disconnect(silent: boolean = false): void {
		const connected = this._session != null;

		this.invalidClientExceptionCount = 0;
		this._prsByCommit.clear();
		this._session = null;

		if (connected) {
			void Container.instance.storage.storeWorkspace(this.connectedKey, false);

			this._onDidChange.fire();
			if (!silent) {
				fireAuthenticationChanged(this.key, 'disconnected');
			}
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
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForCommit(this._session!, ref, options);
			this.invalidClientExceptionCount = 0;
			return author;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.handleClientException();
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
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForEmail(this._session!, email, options);
			this.invalidClientExceptionCount = 0;
			return author;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.handleClientException();
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
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const defaultBranch = await this.getProviderDefaultBranch(this._session!);
			this.invalidClientExceptionCount = 0;
			return defaultBranch;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.handleClientException();
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
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issueOrPullRequest = await this.getProviderIssueOrPullRequest(this._session!, id);
			this.invalidClientExceptionCount = 0;
			return issueOrPullRequest;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.handleClientException();
			}
			return undefined;
		}
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
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const pr = await this.getProviderPullRequestForBranch(this._session!, branch, options);
			this.invalidClientExceptionCount = 0;
			return pr;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.handleClientException();
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

	@gate()
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
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return null;

		try {
			const pr = (await this.getProviderPullRequestForCommit(this._session!, ref)) ?? null;
			this._prsByCommit.set(ref, pr);
			this.invalidClientExceptionCount = 0;
			return pr;
		} catch (ex) {
			Logger.error(ex, cc);

			this._prsByCommit.delete(ref);

			if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
				this.handleClientException();
			}
			return null;
		}
	}

	protected abstract getProviderPullRequestForCommit(
		session: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined>;

	@gate()
	private async ensureSession(createIfNeeded: boolean): Promise<AuthenticationSession | undefined> {
		if (this._session != null) return this._session;

		if (!Container.instance.config.integrations.enabled) return undefined;

		if (createIfNeeded) {
			await Container.instance.storage.deleteWorkspace(this.connectedKey);
		} else if (Container.instance.storage.getWorkspace<boolean>(this.connectedKey) === false) {
			return undefined;
		}

		let session;
		try {
			session = await authentication.getSession(this.authProvider.id, this.authProvider.scopes, {
				createIfNone: createIfNeeded,
				silent: !createIfNeeded,
			});
		} catch (ex) {
			await Container.instance.storage.deleteWorkspace(this.connectedKey);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNeeded) {
			await Container.instance.storage.deleteWorkspace(this.connectedKey);
		}

		this._session = session ?? null;
		this.invalidClientExceptionCount = 0;

		if (session != null) {
			await Container.instance.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				fireAuthenticationChanged(this.key, 'connected');
			});
		}

		return session ?? undefined;
	}

	@debug()
	private handleClientException() {
		this.invalidClientExceptionCount++;

		if (this.invalidClientExceptionCount >= 5) {
			this.disconnect();
		}
	}
}
