import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { Event } from '@gitlens/utils/event.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import type { ConfiguredIntegrationService } from './authentication/configuredIntegrationService.js';
import type { IntegrationAuthenticationProvider } from './authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from './authentication/integrationAuthenticationService.js';
import type { IntegrationIds } from './constants.js';
import type { GitHostIntegration } from './models/gitHostIntegration.js';
import type { IntegrationBase } from './models/integration.js';
import type { Source } from './telemetry.js';

/**
 * Context provided to {@link IntegrationService} at construction time.
 *
 * Replaces all extension-host coupling that integrations would otherwise reach
 * for: storage, subscription, cloud connection, host-side authentication,
 * configuration, commands, UI surfaces, etc. The package boundary at
 * `@gitlens/integrations` cannot import `vscode` or reach into the extension
 * host directly — every cross-boundary concern is named here so the host can
 * adapt its own services to satisfy it.
 *
 * Mirrors the {@link import('@gitlens/git/context.js').GitServiceContext} pattern.
 */
export interface IntegrationServiceContext {
	readonly storage: IntegrationStorageProvider;
	readonly account: AccountProvider;
	readonly config: ConfigProvider;
	readonly http: HttpProvider;
	readonly cache: IntegrationCacheProvider;
	readonly repositories: RepositoriesProvider;
	readonly hooks?: IntegrationServiceHooks;
}

/**
 * The GitKraken account + the GK-cloud connect/manage flows. Unifies the former
 * subscription/cloudConnection/authentication/uris ports: the host owns the GK-Dev OAuth round-trips
 * end-to-end (URL shape, exchange token, redirect, callback, redeem), so the package stays out of the
 * GK-cloud UI and only orchestrates (state, sync, hooks) around `connect`/`openManagement`.
 */
export interface AccountProvider {
	/**
	 * The signed-in GK account, or `undefined` when signed out. `createIfNeeded` triggers the host's
	 * sign-in/sign-up flow (folds the former `loginOrSignUp`/`isSignedIn`/`hasAccountSession`).
	 */
	getAccount(options?: {
		createIfNeeded?: boolean;
		source?: Source;
	}): Promise<{ id: string; name?: string; email?: string } | undefined>;
	/** Fires when account/subscription state changes (login, logout, plan change). */
	readonly onDidChange: Event<void>;
	/**
	 * Fires on a host account check-in; `force` requests a force-refresh of cloud integration sessions
	 * (explicit re-validation: login, trial activation, manual validate).
	 */
	readonly onDidCheckIn: Event<{ force?: boolean }>;
	/** Fires when a host auth session changes (carries the changed provider id the package matches). */
	readonly onDidChangeSessions: Event<AuthenticationSessionsChangeEvent>;
	/**
	 * Whether the account is in a trial-or-paid state. Read by {@link IntegrationBase.access} to decide
	 * whether a connected integration's rich features are usable.
	 */
	isTrialOrPaid(): Promise<boolean>;
	/**
	 * Authenticated request against the GK cloud API (the connections/tokens endpoints used by
	 * `CloudIntegrationService`). Routes through the host's shared `ServerConnection` (circuit-breaker).
	 */
	fetchGkApi(path: string, init?: RequestInit): Promise<Response>;
	/**
	 * Run the GK-Dev connect flow for the given integrations: the host builds the connect URL (query,
	 * provider, exchange-token vs redirect), opens it, awaits its own OAuth callback, and signs in +
	 * connects in one round-trip. Returns `true` on success; the package syncs + fires hooks around it.
	 */
	connect(options: { integrationIds?: IntegrationIds[]; source?: Source }): Promise<boolean>;
	/**
	 * Open the GK-Dev integrations-management page (signing in first if needed) and resolve when the user
	 * returns to the window — `true` if they returned (so the package re-syncs), `false` otherwise.
	 */
	openManagement(source?: Source): Promise<boolean>;
}

/** A cached value, possibly still resolving. Mirrors the host `CacheProvider`'s result shape. */
type CacheResult<T> = Promise<T | undefined> | T | undefined;
/** Produces the value (and optional expiry) to cache on a miss; the controller allows invalidation. */
type Cacheable<T> = (cacheable: CacheController) => { value: CacheResult<T>; expiresAt?: number };
/** Cache expiry controls. */
interface CacheExpiryOptions {
	expiryOverride?: boolean | number;
	expireOnError?: boolean;
}

/**
 * Cross-call cache for expensive provider lookups. Wraps the host's cache
 * service, which deduplicates concurrent loads for the same logical key.
 *
 * Method names + shapes mirror the host's `CacheProvider` so the package routes
 * every cache call through this provider without adapting call sites — and the
 * host adapter can assign its real `CacheProvider` directly (no cast).
 */
export interface IntegrationCacheProvider {
	getRepositoryMetadata(
		repo: ResourceDescriptor,
		integration: GitHostIntegration | undefined,
		cacheable: Cacheable<RepositoryMetadata>,
		options?: CacheExpiryOptions,
	): CacheResult<RepositoryMetadata>;
	getRepositoryDefaultBranch(
		repo: ResourceDescriptor,
		integration: GitHostIntegration | undefined,
		cacheable: Cacheable<DefaultBranch>,
		options?: CacheExpiryOptions,
	): CacheResult<DefaultBranch>;
	getPullRequestForSha(
		sha: string,
		repo: ResourceDescriptor,
		integration: GitHostIntegration | undefined,
		cacheable: Cacheable<PullRequest>,
		options?: CacheExpiryOptions,
	): CacheResult<PullRequest>;
	getPullRequestForBranch(
		branch: string,
		repo: ResourceDescriptor,
		integration: GitHostIntegration | undefined,
		cacheable: Cacheable<PullRequest>,
		options?: CacheExpiryOptions,
	): CacheResult<PullRequest>;
	getPullRequest(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationBase | undefined,
		cacheable: Cacheable<PullRequest>,
		options?: CacheExpiryOptions,
	): CacheResult<PullRequest>;
	getIssueOrPullRequest(
		id: string,
		type: IssueOrPullRequestType | undefined,
		resource: ResourceDescriptor,
		integration: IntegrationBase | undefined,
		cacheable: Cacheable<IssueOrPullRequest>,
		options?: CacheExpiryOptions,
	): CacheResult<IssueOrPullRequest>;
	getIssue(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationBase | undefined,
		cacheable: Cacheable<Issue>,
		options?: CacheExpiryOptions,
	): CacheResult<Issue>;
	getCurrentAccount(
		integration: IntegrationBase,
		cacheable: Cacheable<Account>,
		options?: CacheExpiryOptions,
	): CacheResult<Account>;
}

/**
 * The remotes across all currently-open repositories. The package only ever needs the *remotes* (to map
 * them to integrations) — never the repositories themselves — so the host flattens to a remote list
 * rather than leaking a repository shape across the boundary. Used for "across all open repos" queries:
 * issue aggregation by remote ({@link IntegrationService.getMyIssues}) and bitbucket's reviewing-PRs search.
 */
export interface RepositoriesProvider {
	getOpenRemotes(): Promise<readonly GitRemote[]>;
}

/**
 * HTTP primitives the package uses to call out to provider APIs. Wraps the
 * host's `@env/fetch` (which differs between Node and browser builds) so the
 * package itself stays environment-agnostic.
 */
export interface HttpProvider {
	/** Whether the package is running in a webworker/browser environment. */
	readonly isWeb: boolean;
	/** Pre-assembled User-Agent string for provider API requests (host builds it from its env facts). */
	readonly userAgent: string;
	/** Host-supplied fetch implementation. */
	fetch(input: string | URL, init?: RequestInit): Promise<Response>;
	/**
	 * Wrap a fetch in the host's "ignore SSL errors" toggle. On Node, this
	 * disables TLS verification while the wrapped fetch is in flight; on the
	 * browser, it's a no-op.
	 */
	wrapForForcedInsecureSSL<T>(ignoreSSLErrors: boolean | 'force', fn: () => Promise<T> | PromiseLike<T>): Promise<T>;
}

/**
 * Persists integration token/session/configured-integration state.
 * Wraps the host's `Container.storage` (global + workspace + secret stores).
 *
 * Two non-secret namespaces:
 *  - **Global** (`get`/`store`/`delete`/`deleteWithPrefix`) — values shared
 *    across all workspaces (e.g., the `integrations:configured` descriptor
 *    map, per-account caches keyed by access token).
 *  - **Workspace** (`getWorkspace`/`storeWorkspace`/`deleteWorkspace`) —
 *    values scoped to the active workspace (e.g., `connected:<id>` flags).
 *
 * Plus a **Secret** namespace (`getSecret`/`storeSecret`/`deleteSecret`)
 * for OAuth tokens and other credentials.
 *
 * Method names mirror the host's `Storage` API so the package can route
 * every storage access through this provider without renaming call sites.
 */
export interface IntegrationStorageProvider {
	/** Read a global (cross-workspace) value (non-secret). */
	get<T = any>(key: string): T | undefined;
	/** Write a global (cross-workspace) value (non-secret). */
	store<T = any>(key: string, value: T): Promise<void>;
	/** Delete a global value. */
	delete(key: string): Promise<void>;
	/** Delete every global key with the given prefix. */
	deleteWithPrefix(prefix: string): Promise<void>;
	/** Read a workspace-scoped value (non-secret). */
	getWorkspace<T = any>(key: string): T | undefined;
	/** Write a workspace-scoped value (non-secret). */
	storeWorkspace<T = any>(key: string, value: T): Promise<void>;
	/** Delete a workspace-scoped value (non-secret). */
	deleteWorkspace(key: string): Promise<void>;
	/** Read a secret (e.g., access token). */
	getSecret(key: string): Promise<string | undefined>;
	/** Store a secret. */
	storeSecret(key: string, value: string): Promise<void>;
	/** Delete a secret. */
	deleteSecret(key: string): Promise<void>;
}

export interface AuthenticationSessionsChangeEvent {
	readonly provider: { readonly id: string };
}

/**
 * Per-remote-host configuration entry (subset of the host's `RemotesConfig`).
 * Used by `IntegrationService.ignoreSSLErrors` to look up self-managed remote
 * settings.
 */
export interface IntegrationsRemoteConfig {
	readonly type: string;
	/** Exact-match domain (mutually exclusive with `regex`) */
	readonly domain?: string;
	/** Regex pattern for flexible host matching (mutually exclusive with `domain`) */
	readonly regex?: string;
	/** URL protocol override (e.g., `'https'`) */
	readonly protocol?: string;
	readonly ignoreSSLErrors?: boolean | 'force';
}

/**
 * Snapshot of integration-relevant config values + reactive change detection.
 *
 * Only the keys integrations actually read are surfaced; everything else is
 * the host's concern. Host adapter wraps the `system/-webview/configuration`
 * helper to satisfy this.
 */
export interface ConfigProvider {
	/** `integrations.enabled`. Optional — omit (or omit a `false` return) and integrations are enabled. */
	isIntegrationsEnabled?(): boolean;
	/**
	 * `launchpad.*` knobs surfaced to the GitHub provider.
	 */
	getLaunchpadOptions(): {
		queryLimit?: number;
		ignoredRepositories?: readonly string[];
		includedOrganizations?: readonly string[];
		ignoredOrganizations?: readonly string[];
	};
	/** Per-remote-host configurations from `remotes`. */
	getRemoteConfigs(): readonly IntegrationsRemoteConfig[];
	/** Fires when any integration-relevant config changes. */
	readonly onDidChange: Event<ConfigChangeEvent>;
}

/** Typed change descriptor returned by {@link ConfigProvider.onDidChange}. */
export interface ConfigChangeEvent {
	/** Whether `remotes` configuration changed. */
	readonly remotes: boolean;
	/** Whether `integrations.enabled` changed. */
	readonly integrationsEnabled: boolean;
	/** Whether one of the `launchpad.*` keys changed. */
	readonly launchpad: boolean;
	/** Whether `http.proxy` or `http.proxyStrictSSL` (VS Code core) changed. */
	readonly httpProxy: boolean;
}

/**
 * Outbound hooks: the package raises domain events the host wants to observe
 * and exposes host-owned composition hooks (e.g., `createAuthenticationProvider`).
 *
 * Hooks are optional; the package omits the call when unset. They follow the
 * pattern used by `@gitlens/agents` (`AgentProviderCallbacks`) and the
 * existing `GitServiceHooks` — the package surfaces named events; the host
 * decides what to do (send telemetry, log, update UI, etc.).
 *
 * Replaces the direct `Container.telemetry.sendEvent` calls scattered through
 * integration source today. Each hook below is named after the domain event,
 * not its current telemetry event name; the host adapter forwards each one to
 * the corresponding `telemetry.sendEvent('cloudIntegrations/...')` call to
 * preserve existing analytics.
 */
export interface IntegrationServiceHooks {
	/**
	 * Ask the host to confirm reauthentication after an integration auth/permission failure. The host
	 * owns the prompt (and its "Reauthenticate" affordance) and resolves to the user's choice; the
	 * package performs the actual reauth when this resolves truthy. Omit to never prompt.
	 */
	onReauthenticationRequired?(message: string): Promise<boolean | undefined>;

	/**
	 * Confirm disabling a connected integration. The host renders the dialog (offering a "sign out"
	 * choice when `offerSignOut`); resolves to the user's decision, or `undefined` to cancel. Omit to
	 * make interactive `disconnect()` a no-op (callers should pass `silent`/`currentSessionOnly` then).
	 */
	onConfirmDisconnect?(e: {
		integrationName: string;
		offerSignOut: boolean;
	}): Promise<{ signOut: boolean } | undefined>;

	/**
	 * Optional consumer override: construct a custom authentication provider for `id` (e.g. a manual-token
	 * provider via {@link createManualTokenAuthProvider}). Return `undefined` to defer to the package's own
	 * cloud-OAuth provider. GitLens omits this — the package builds its cloud providers internally; an
	 * external consumer can plug in any auth strategy here.
	 */
	createAuthenticationProvider?(args: {
		id: IntegrationIds;
		auth: IntegrationAuthenticationService;
		configured: ConfiguredIntegrationService;
	}): Promise<IntegrationAuthenticationProvider | undefined>;

	/**
	 * Outbound behavioral events, nested by domain — mirroring `@gitlens/git`'s `GitServiceHooks`. The
	 * package raises typed domain events; the host decides what to do (GitLens maps each to its telemetry
	 * schema, but a consumer could log or ignore them — they're behavioral, not telemetry-specific).
	 * Optional throughout — omit to opt out entirely (no stub functions needed).
	 */
	connection?: {
		/** A connect flow was initiated. */
		onStarted?(e: { integrationIds: IntegrationIds[] | undefined }, source: Source | undefined): void;
		/** A connect flow finished syncing. */
		onCompleted?(
			e: { integrationIds: IntegrationIds[] | undefined; connectedIntegrationIds: IntegrationIds[] | undefined },
			source: Source | undefined,
		): void;
		/** The user opened the integrations management surface. */
		onManaged?(source: Source | undefined): void;
		/** A hosting/remote/issue integration's connection state changed. */
		onStateChanged?(e: {
			id: IntegrationIds;
			key: string;
			connected: boolean;
			kind: 'hosting' | 'remote' | 'issue';
		}): void;
		/** The set of connected integrations changed (e.g. for connected-count attributes). */
		onConnectedChanged?(e: { integrationIds: IntegrationIds[] }): void;
		/** Fetching the set of connected providers failed. */
		onConnectionsFetchFailed?(e: { code: number | undefined }): void;
		/** Fetching/refreshing a single provider's token failed. */
		onConnectionFetchFailed?(e: { id: IntegrationIds; code: number | undefined; refreshing: boolean }): void;
		/** Disconnecting a provider's token failed. */
		onDisconnectFailed?(e: { id: IntegrationIds; code: number | undefined }): void;
	};
	/** Outbound session events (behavioral; the host maps to telemetry). */
	session?: {
		/** A session refresh was skipped (reported once per reason). */
		onRefreshSkipped?(e: {
			id: IntegrationIds;
			reason: 'skip-non-cloud' | 'missing-expiry';
			cloud: boolean | undefined;
		}): void;
	};
	/** Outbound user-facing notifications (fire-and-forget). The host renders them; a consumer may log/ignore. */
	ui?: {
		/** A non-fatal error to surface. */
		onError?(message: string): void;
		/** The integration's API returned a 500-level error. */
		onRequestFailed?(message: string): void;
		/** The integration's API request timed out. */
		onRequestTimedOut?(integrationName: string): void;
		/** An integration was disconnected after too many consecutive failed requests. */
		onDisconnectedAfterTooManyFailures?(integrationName: string): void;
		/** Bitbucket's "Pull Requests for Commit" app isn't installed; `revLink` opens the install page. */
		onBitbucketCommitLinksAppMissing?(revLink: string): void;
	};
}
