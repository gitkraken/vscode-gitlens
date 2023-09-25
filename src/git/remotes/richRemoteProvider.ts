/* eslint-disable @typescript-eslint/no-confusing-void-expression */
import type {
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	CancellationToken,
	Event,
	MessageItem,
} from 'vscode';
import { authentication, CancellationError, Disposable, EventEmitter, window } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import { isWeb } from '@env/platform';
import type { Container } from '../../container';
import { AuthenticationError, ProviderRequestClientError } from '../../errors';
import { showIntegrationDisconnectedTooManyFailedRequestsWarningMessage } from '../../messages';
import type { IntegrationAuthenticationSessionDescriptor } from '../../plus/integrationAuthentication';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../../subscription';
import { configuration } from '../../system/configuration';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import type { Account } from '../models/author';
import type { DefaultBranch } from '../models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../models/pullRequest';
import type { RepositoryMetadata } from '../models/repositoryMetadata';
import { RemoteProvider } from './remoteProvider';

// TODO@eamodio revisit how once authenticated, all remotes are always connected, even after a restart

export abstract class RichRemoteProvider extends RemoteProvider implements Disposable {
	override readonly type: 'simple' | 'rich' = 'rich';

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private readonly _disposable: Disposable;

	constructor(
		protected readonly container: Container,
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom?: boolean,
	) {
		super(domain, path, protocol, name, custom);

		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this._ignoreSSLErrors.clear();
				}
			}),
			// TODO@eamodio revisit how connections are linked or not
			container.richRemoteProviders.onDidChangeConnectionState(e => {
				if (e.key !== this.key) return;

				if (e.reason === 'disconnected') {
					void this.disconnect({ silent: true });
				} else if (e.reason === 'connected') {
					void this.ensureSession(false);
				}
			}),
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);

		container.context.subscriptions.push(this._disposable);

		// If we think we should be connected, try to
		if (this.shouldConnect) {
			void this.isConnected();
		}
	}

	disposed = false;

	dispose() {
		this._disposable.dispose();
		this.disposed = true;
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

	override get maybeConnected(): boolean | undefined {
		return this._session === undefined ? undefined : this._session !== null;
	}

	// This is a hack for now, since providers come and go with remotes
	get shouldConnect(): boolean {
		return this.container.richRemoteProviders.isConnected(this.key);
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

		if (connected && !options?.silent) {
			if (options?.currentSessionOnly) {
				void showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(this.name);
			} else {
				const disable = { title: 'Disable' };
				const signout = { title: 'Disable & Sign Out' };
				const cancel = { title: 'Cancel', isCloseAffordance: true };

				let result: MessageItem | undefined;
				if (this.container.integrationAuthentication.hasProvider(this.authProvider.id)) {
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
					void this.container.integrationAuthentication.deleteSession(
						this.authProvider.id,
						this.authProviderDescriptor,
					);
				}
			}
		}

		this.resetRequestExceptionCount();
		this._session = null;

		if (connected) {
			// Don't store the disconnected flag if this only for this current VS Code session (will be re-connected on next restart)
			if (!options?.currentSessionOnly) {
				void this.container.storage.storeWorkspace(this.connectedKey, false);
			}

			this._onDidChange.fire();
			if (!options?.silent && !options?.currentSessionOnly) {
				this.container.richRemoteProviders.disconnected(this.key);
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

	private handleProviderException<T>(ex: Error, scope: LogScope | undefined, defaultValue: T): T {
		if (ex instanceof CancellationError) return defaultValue;

		Logger.error(ex, scope);

		if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
			this.trackRequestException();
		}
		return defaultValue;
	}

	@debug()
	trackRequestException() {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= 5 && this._session !== null) {
			void this.disconnect({ currentSessionOnly: true });
		}
	}

	@gate()
	@debug({ exit: true })
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
			return this.handleProviderException(ex, scope, undefined);
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
			return this.handleProviderException(ex, scope, undefined);
		}
	}

	protected abstract getProviderAccountForEmail(
		session: AuthenticationSession,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined>;

	@debug()
	async getDefaultBranch(): Promise<DefaultBranch | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const defaultBranch = this.container.cache.getRepositoryDefaultBranch(this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderDefaultBranch(this._session!);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<DefaultBranch | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return defaultBranch;
	}

	protected abstract getProviderDefaultBranch({
		accessToken,
	}: AuthenticationSession): Promise<DefaultBranch | undefined>;

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

	@debug()
	async getRepositoryMetadata(_cancellation?: CancellationToken): Promise<RepositoryMetadata | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const metadata = this.container.cache.getRepositoryMetadata(this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderRepositoryMetadata(this._session!);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<RepositoryMetadata | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return metadata;
	}

	protected abstract getProviderRepositoryMetadata({
		accessToken,
	}: AuthenticationSession): Promise<RepositoryMetadata | undefined>;

	@debug()
	async getIssueOrPullRequest(id: string): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const issueOrPR = this.container.cache.getIssueOrPullRequest(id, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderIssueOrPullRequest(this._session!, id);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<IssueOrPullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return issueOrPR;
	}

	protected abstract getProviderIssueOrPullRequest(
		session: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined>;

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

		const pr = this.container.cache.getPullRequestForBranch(branch, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderPullRequestForBranch(this._session!, branch, options);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return pr;
	}

	protected abstract getProviderPullRequestForBranch(
		session: AuthenticationSession,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined>;

	@debug()
	async getPullRequestForCommit(ref: string): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const pr = this.container.cache.getPullRequestForSha(ref, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderPullRequestForCommit(this._session!, ref);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return pr;
	}

	protected abstract getProviderPullRequestForCommit(
		session: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined>;

	@gate()
	@debug()
	async searchMyIssues(): Promise<SearchedIssue[] | undefined> {
		const scope = getLogScope();

		try {
			const issues = await this.searchProviderMyIssues(this._session!);
			this.resetRequestExceptionCount();
			return issues;
		} catch (ex) {
			return this.handleProviderException(ex, scope, undefined);
		}
	}
	protected abstract searchProviderMyIssues(session: AuthenticationSession): Promise<SearchedIssue[] | undefined>;

	@gate()
	@debug()
	async searchMyPullRequests(): Promise<SearchedPullRequest[] | undefined> {
		const scope = getLogScope();

		try {
			const pullRequests = await this.searchProviderMyPullRequests(this._session!);
			this.resetRequestExceptionCount();
			return pullRequests;
		} catch (ex) {
			return this.handleProviderException(ex, scope, undefined);
		}
	}
	protected abstract searchProviderMyPullRequests(
		session: AuthenticationSession,
	): Promise<SearchedPullRequest[] | undefined>;

	@gate()
	private async ensureSession(
		createIfNeeded: boolean,
		forceNewSession: boolean = false,
	): Promise<AuthenticationSession | undefined> {
		if (this._session != null) return this._session;
		if (!configuration.get('integrations.enabled')) return undefined;

		if (createIfNeeded) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		} else if (this.container.storage.getWorkspace(this.connectedKey) === false) {
			return undefined;
		}

		let session: AuthenticationSession | undefined | null;
		try {
			if (this.container.integrationAuthentication.hasProvider(this.authProvider.id)) {
				session = await this.container.integrationAuthentication.getSession(
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
			await this.container.storage.deleteWorkspace(this.connectedKey);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNeeded) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		}

		this._session = session ?? null;
		this.resetRequestExceptionCount();

		if (session != null) {
			await this.container.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				this.container.richRemoteProviders.connected(this.key);
			});
		}

		return session ?? undefined;
	}
}

export async function ensurePaidPlan(providerName: string, container: Container): Promise<boolean> {
	const title = `Connecting to a ${providerName} instance for rich integration features requires a trial or paid plan.`;

	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Verification' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
				{ modal: true },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification()) {
					continue;
				}
			}

			return false;
		}

		const plan = subscription.plan.effective.id;
		if (isSubscriptionPaidPlan(plan)) break;

		if (subscription.account == null && !isSubscriptionPreviewTrialExpired(subscription)) {
			const startTrial = { title: 'Preview Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to preview ✨ features for 3 days?`,
				{ modal: true },
				startTrial,
				cancel,
			);

			if (result !== startTrial) return false;

			void container.subscription.startPreviewTrial();
			break;
		} else if (subscription.account == null) {
			const signIn = { title: 'Start Free Pro Trial' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to continue to use ✨ features on privately hosted repos, free for an additional 7 days?`,
				{ modal: true },
				signIn,
				cancel,
			);

			if (result === signIn) {
				if (await container.subscription.loginOrSignUp()) {
					continue;
				}
			}
		} else {
			const upgrade = { title: 'Upgrade to Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to continue to use ✨ features on privately hosted repos?`,
				{ modal: true },
				upgrade,
				cancel,
			);

			if (result === upgrade) {
				void container.subscription.purchase();
			}
		}

		return false;
	}

	return true;
}
