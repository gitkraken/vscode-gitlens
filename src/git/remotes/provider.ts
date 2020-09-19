'use strict';
import {
	authentication,
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	env,
	Event,
	EventEmitter,
	Range,
	Uri,
	window,
} from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { Container } from '../../container';
import { Logger } from '../../logger';
import { Messages } from '../../messages';
import { IssueOrPullRequest } from '../models/issue';
import { GitLogCommit } from '../models/logCommit';
import { PullRequest } from '../models/pullRequest';
import { Repository } from '../models/repository';
import { debug, gate, Promises } from '../../system';

export class AuthenticationError extends Error {
	constructor(private original: Error) {
		super(original.message);

		Error.captureStackTrace(this, AuthenticationError);
	}
}

export enum RemoteResourceType {
	Branch = 'branch',
	Branches = 'branches',
	Commit = 'commit',
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
		if (url === undefined) return;

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

			Logger.error(ex, 'CopyRemoteUrlToClipboardCommand');
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
				return this.getUrlForBranch(encodeURIComponent(resource.branch));
			case RemoteResourceType.Branches:
				return this.getUrlForBranches();
			case RemoteResourceType.Commit:
				return this.getUrlForCommit(encodeURIComponent(resource.sha));
			case RemoteResourceType.File:
				return this.getUrlForFile(
					resource.fileName,
					resource.branch !== undefined ? encodeURIComponent(resource.branch) : undefined,
					undefined,
					resource.range,
				);
			case RemoteResourceType.Repo:
				return this.getUrlForRepository();
			case RemoteResourceType.Revision:
				return this.getUrlForFile(
					resource.fileName,
					resource.branch !== undefined ? encodeURIComponent(resource.branch) : undefined,
					resource.sha !== undefined ? encodeURIComponent(resource.sha) : undefined,
					resource.range,
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

	protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

	protected getUrlForRepository(): string {
		return this.baseUrl;
	}

	private async openUrl(url?: string): Promise<boolean | undefined> {
		if (url == null) return undefined;

		return env.openExternal(Uri.parse(url));
	}
}

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
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		if (e.provider.id === this.authProvider.id) {
			this._session = null;
			this._onDidChange.fire();
		}
	}

	abstract get apiBaseUrl(): string;

	async connect(): Promise<boolean> {
		try {
			const session = await this.ensureSession(true);
			return Boolean(session);
		} catch (ex) {
			return false;
		}
	}

	disconnect(): void {
		this._prsByCommit.clear();
		this.invalidAuthenticationCount = 0;
		this._session = null;
		this._onDidChange.fire();
	}

	@gate()
	@debug<RemoteProviderWithApi['isConnected']>({
		exit: connected => `returned ${connected}`,
	})
	async isConnected(): Promise<boolean> {
		return (await this.session()) != null;
	}

	get maybeConnected(): boolean | undefined {
		if (this._session === undefined) return undefined;

		return this._session !== null;
	}

	@gate()
	@debug()
	async getIssueOrPullRequest(id: string): Promise<IssueOrPullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issueOrPullRequest = await this.onGetIssueOrPullRequest(this._session!, id);
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

	protected abstract get authProvider(): { id: string; scopes: string[] };

	protected abstract onGetIssueOrPullRequest(
		session: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined>;
	protected abstract onGetPullRequestForCommit(
		session: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined>;

	protected _session: AuthenticationSession | null | undefined;
	protected session() {
		if (this._session === undefined) {
			return this.ensureSession(false);
		}
		return this._session ?? undefined;
	}

	private async ensureSession(createIfNone: boolean) {
		if (this._session != null) return this._session;

		let session;
		try {
			session = await authentication.getSession(this.authProvider.id, this.authProvider.scopes, {
				createIfNone: createIfNone,
			});
		} catch (ex) {
			// TODO@eamodio	save that the user rejected auth?
		}

		this._session = session ?? null;
		this.invalidAuthenticationCount = 0;

		if (session != null) {
			this._onDidChange.fire();
		}

		return session ?? undefined;
	}

	@gate()
	@debug()
	private async getPullRequestForCommitCore(ref: string) {
		const cc = Logger.getCorrelationContext();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return null;

		try {
			const pr = (await this.onGetPullRequestForCommit(this._session!, ref)) ?? null;
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

	private handleAuthenticationException() {
		this.invalidAuthenticationCount++;

		if (this.invalidAuthenticationCount >= 5) {
			this.disconnect();
		}
	}
}
