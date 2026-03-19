import type { AuthenticationError } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';

/**
 * VS Code-free configuration interface for {@link GitHubApi}.
 *
 * The extension creates an instance by wiring VS Code-specific values
 * (settings, proxy agent, SSL wrapper, UI dialogs) into these callbacks.
 * The package never imports anything from VS Code.
 */
export interface GitHubApiConfig {
	/** Whether we're running in a web worker (vscode.dev) vs Node.js desktop. */
	readonly isWeb: boolean;

	/** The `fetch` implementation to use for HTTP requests. */
	readonly fetch: (url: string, init?: any) => Promise<Response>;

	/** Returns an HTTPS proxy agent (Node.js desktop only). */
	getProxyAgent?(): unknown;

	/**
	 * Wraps an async operation so that TLS certificate validation
	 * is disabled when the provider's `getIgnoreSSLErrors()` returns `'force'`.
	 */
	wrapForForcedInsecureSSL<T>(ignoreSSLErrors: boolean | 'force', fn: () => Promise<T>): Promise<T>;

	/**
	 * Fires when proxy/SSL configuration changes, so the API can reset
	 * its HTTP caches (proxy agent, default request instances, etc.).
	 */
	onConfigChanged?(listener: () => void): { dispose(): void };

	/**
	 * Called when authentication fails (401/403) and reauthentication might help.
	 *
	 * The extension shows a dialog and calls `provider.reauthenticate()` if
	 * the user confirms. Returns `true` if the user chose to reauthenticate,
	 * allowing the package to reset caches and fire `onDidReauthenticate`.
	 */
	onAuthenticationFailure?(error: AuthenticationError, provider: Provider | undefined): Promise<boolean>;

	/**
	 * Called on server errors (500/502/503) or timeouts.
	 * The extension decides how to present this (notification, status bar, etc.).
	 */
	onRequestError?(provider: Provider | undefined, message: string): void;

	/**
	 * Called for debug-mode error display (only when `Logger.isDebugging`).
	 * The extension may show an error notification or log it.
	 */
	onDebugError?(message: string): void;

	// These are passed through config because they come from VS Code settings.
	// The code in GitHubApi's searchMyPullRequests has "Hack" comments noting
	// these should eventually be passed through method options instead.

	/**
	 * Returns the Launchpad search query limit (max PRs to fetch).
	 * Defaults to 100 if not provided.
	 */
	getLaunchpadQueryLimit?(): number;

	/**
	 * Returns repositories to exclude from Launchpad search queries.
	 * Format: `owner/repo` strings.
	 */
	getLaunchpadIgnoredRepositories?(): string[];

	/**
	 * Returns organizations to include in Launchpad search queries.
	 * When non-empty, only these orgs are searched.
	 */
	getLaunchpadIncludedOrganizations?(): string[];

	/**
	 * Returns organizations to exclude from Launchpad search queries.
	 * Only used when `getLaunchpadIncludedOrganizations` returns empty.
	 */
	getLaunchpadIgnoredOrganizations?(): string[];
}
