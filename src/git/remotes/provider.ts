'use strict';
import {
	authentication,
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	env,
	Event,
	EventEmitter,
	MessageItem,
	Range,
	Uri,
	window,
} from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { Logger } from '../../logger';
import { Messages } from '../../messages';
import { Account, GitLogCommit, IssueOrPullRequest, PullRequest, PullRequestState, Repository } from '../models/models';
import { debug, gate, log, Promises } from '../../system';

export enum RemoteResourceType {
	Branch = 'branch',
	Branches = 'branches',
	Commit = 'commit',
	Comparison = 'comparison',
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
			ref1: string;
			ref2: string;
			notation?: '..' | '...';
	  }
	| {
			type: RemoteResourceType.File;
			branch?: string;
			fileName: string;
			range?: Range;
	  }
	| {
			type: RemoteResourceType.Repo;
	  }
	| {
			type: RemoteResourceType.Revision;
			branch?: string;
			commit?: GitLogCommit;
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

export abstract class RemoteProvider {
	protected _name: string | undefined;

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

	abstract get name(): string;

	async copy(resource: RemoteResource): Promise<void> {
		const url = this.url(resource);
		if (url == null) return;

		try {
			void (await env.clipboard.writeText(url));
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (msg.includes("Couldn't find the required `xsel` binary")) {
				void window.showErrorMessage(
					'Unable to copy remote url, xsel is not installed. Please install it via your package manager, e.g. `sudo apt install xsel`',
				);

				return;
			}

			Logger.error(ex, 'CopyRemoteUrlCommand');
			void Messages.showGenericErrorMessage('Unable to copy remote url');
		}
	}

	hasApi(): this is RemoteProviderWithApi {
		return RemoteProviderWithApi.is(this);
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
				return encodeURI(this.getUrlForBranch(resource.branch));
			case RemoteResourceType.Branches:
				return encodeURI(this.getUrlForBranches());
			case RemoteResourceType.Commit:
				return encodeURI(this.getUrlForCommit(resource.sha));
			case RemoteResourceType.Comparison: {
				const url = this.getUrlForComparison?.(resource.ref1, resource.ref2, resource.notation ?? '...');
				return url != null ? encodeURI(url) : undefined;
			}
			case RemoteResourceType.File:
				return encodeURI(
					this.getUrlForFile(
						resource.fileName,
						resource.branch != null ? resource.branch : undefined,
						undefined,
						resource.range,
					),
				);
			case RemoteResourceType.Repo:
				return encodeURI(this.getUrlForRepository());
			case RemoteResourceType.Revision:
				return encodeURI(
					this.getUrlForFile(
						resource.fileName,
						resource.branch != null ? resource.branch : undefined,
						resource.sha != null ? resource.sha : undefined,
						resource.range,
					),
				);
			default:
				return undefined;
		}
	}

	protected get baseUrl() {
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

	protected getUrlForComparison?(ref1: string, ref2: string, notation: '..' | '...'): string | undefined;

	protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

	protected getUrlForRepository(): string {
		return this.baseUrl;
	}

	private async openUrl(url?: string): Promise<boolean | undefined> {
		if (url == null) return undefined;

		return env.openExternal(Uri.parse(url));
	}
}

const _onDidChangeAuthentication = new EventEmitter<{ reason: 'connected' | 'disconnected'; key: string }>();

export class Authentication {
	static get onDidChange(): Event<{ reason: 'connected' | 'disconnected'; key: string }> {
		return _onDidChangeAuthentication.event;
	}
}

export class AuthenticationError extends Error {
	constructor(private original: Error) {
		super(original.message);

		Error.captureStackTrace(this, AuthenticationError);
	}
}

// TODO@eamodio revisit how once authenticated, all remotes are always connected, even after a restart

export abstract class RemoteProviderWithApi extends RemoteProvider {
	static is(provider: RemoteProvider | undefined): provider is RemoteProviderWithApi {
		return provider instanceof RemoteProviderWithApi;
	}

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private invalidAuthenticationCount = 0;

	constructor(domain: string, path: string, protocol?: string, name?: string, custom?: boolean) {
		super(domain, path, protocol, name, custom);

		Container.context.subscriptions.push(
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

	private get disallowConnectionKey() {
		return `${WorkspaceState.DisallowConnectionPrefix}${this.key}`;
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
			this.disconnect();
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
		const disconnected = this._session != null;

		this.invalidAuthenticationCount = 0;
		this._prsByCommit.clear();
		this._session = null;

		if (disconnected) {
			void Container.context.workspaceState.update(this.disallowConnectionKey, true);

			this._onDidChange.fire();
			if (!silent) {
				_onDidChangeAuthentication.fire({ reason: 'disconnected', key: this.key });
			}
		}
	}

	@gate()
	@debug<RemoteProviderWithApi['isConnected']>({
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
			this.invalidAuthenticationCount = 0;
			return author;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError) {
				this.handleAuthenticationException();
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
			this.invalidAuthenticationCount = 0;
			return author;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError) {
				this.handleAuthenticationException();
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
	async getIssueOrPullRequest(id: string): Promise<IssueOrPullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issueOrPullRequest = await this.getProviderIssueOrPullRequest(this._session!, id);
			this.invalidAuthenticationCount = 0;
			return issueOrPullRequest;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError) {
				this.handleAuthenticationException();
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
			this.invalidAuthenticationCount = 0;
			return pr;
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex instanceof AuthenticationError) {
				this.handleAuthenticationException();
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
		if (pr == null || !Promises.is(pr)) return pr ?? undefined;

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
			this.invalidAuthenticationCount = 0;
			return pr;
		} catch (ex) {
			Logger.error(ex, cc);

			this._prsByCommit.delete(ref);

			if (ex instanceof AuthenticationError) {
				this.handleAuthenticationException();
			}
			return null;
		}
	}

	protected abstract getProviderPullRequestForCommit(
		session: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined>;

	@gate()
	private async ensureSession(createIfNone: boolean): Promise<AuthenticationSession | undefined> {
		if (this._session != null) return this._session;

		if (createIfNone) {
			await Container.context.workspaceState.update(this.disallowConnectionKey, undefined);
		} else if (Container.context.workspaceState.get<boolean>(this.disallowConnectionKey)) {
			return undefined;
		}

		let session;
		try {
			session = await authentication.getSession(this.authProvider.id, this.authProvider.scopes, {
				createIfNone: createIfNone,
			});
		} catch (ex) {
			await Container.context.workspaceState.update(this.disallowConnectionKey, true);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				if (!createIfNone) {
					void this.promptToRetyConnection();
				}
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNone) {
			await Container.context.workspaceState.update(this.disallowConnectionKey, true);

			void this.promptToConnect();
		}

		this._session = session ?? null;
		this.invalidAuthenticationCount = 0;

		if (session != null) {
			await Container.context.workspaceState.update(this.disallowConnectionKey, undefined);

			if (createIfNone) {
				this._onDidChange.fire();
				_onDidChangeAuthentication.fire({ reason: 'connected', key: this.key });
			}
		}

		return session ?? undefined;
	}

	@gate()
	private async promptToConnect() {
		const connect: MessageItem = { title: `Connect to ${this.name}` };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

		const result = await window.showInformationMessage(
			`GitLens would like to connect to ${this.name} to provide a rich integration with pull requests, issues, avatars, and more. If you choose to connect, you will be prompted to authenticate with ${this.name}.`,
			connect,
			cancel,
		);

		if (result === connect) {
			void this.connect();
		}
	}

	@gate()
	private async promptToRetyConnection() {
		const connect: MessageItem = { title: `Connect to ${this.name}` };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

		const result = await window.showErrorMessage(
			`GitLens wants to connect to ${this.name} to provide a rich integration with pull requests, issues, avatars, and more. If you choose to connect, you will be prompted again to allow authentication with ${this.name}.`,
			connect,
			cancel,
		);

		if (result === connect) {
			void this.connect();
		}
	}

	@debug()
	private handleAuthenticationException() {
		this.invalidAuthenticationCount++;

		if (this.invalidAuthenticationCount >= 5) {
			this.disconnect();
		}
	}
}
