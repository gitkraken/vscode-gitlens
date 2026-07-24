import type { IntegrationServiceContext } from '../context.js';

/**
 * VS Code-free configuration for the package-owned provider API clients
 * ({@link GitLabApi}, {@link BitbucketApi}, {@link AzureDevOpsApi}).
 *
 * Mirrors the role {@link import('@gitlens/git-github/api/config.js').GitHubApiConfig}
 * plays for `GitHubApi`: instead of taking the full {@link IntegrationServiceContext},
 * a client takes only the narrow HTTP + callback surface it actually uses. The
 * `createIntegrationManager` path wires this from `ctx` (see the `create*Api`
 * factories); a token-scoped consumer builds it from a `fetch` plus a
 * `wrapForForcedInsecureSSL` (a pass-through is fine when not toggling SSL).
 *
 * Every field beyond `fetch`/`wrapForForcedInsecureSSL` is optional — a client omits
 * the call when unset, so a minimal consumer only supplies the two required members.
 */
export interface ProviderApiConfig {
	/** The `fetch` implementation to use for HTTP requests. */
	fetch(input: string | URL, init?: RequestInit): Promise<Response>;

	/**
	 * Wraps an async operation so that TLS certificate validation is disabled when the
	 * provider's `getIgnoreSSLErrors()` returns `'force'`. On the browser it's a no-op.
	 */
	wrapForForcedInsecureSSL<T>(ignoreSSLErrors: boolean | 'force', fn: () => Promise<T> | PromiseLike<T>): Promise<T>;

	/**
	 * Fires when the HTTP proxy configuration changes, so the client can reset its HTTP caches.
	 * The factory filters the underlying config-change event down to the keys the client cares about.
	 */
	onConfigChanged?(listener: () => void): { dispose(): void };

	/**
	 * Ask the consumer to confirm reauthentication after an auth/permission failure (401/403). Resolves to
	 * the user's choice; the client performs the actual `provider.reauthenticate()` when this is truthy.
	 * Only GitLab wires this today.
	 */
	onReauthenticationRequired?(message: string): Promise<boolean | undefined>;

	/** A non-fatal error to surface (debug display / notification). */
	onError?(message: string): void;

	/** The provider API returned a server-side (500-level) error. */
	onRequestFailed?(message: string): void;

	/** The provider API request timed out; `providerName` names the integration for the message. */
	onRequestTimedOut?(providerName: string): void;

	/** Bitbucket's "Pull Requests for Commit" app isn't installed; `revLink` opens the install page. */
	onBitbucketCommitLinksAppMissing?(revLink: string): void;
}

/**
 * The `ctx` → {@link ProviderApiConfig} mapping shared by every `create*Api` factory. Each provider
 * spreads this and layers on its own deltas (GitLab also resets on `remotes` + wires reauth/timeout;
 * Bitbucket adds the commit-links-app hook). Resets HTTP caches on HTTP proxy config changes.
 */
export function baseProviderApiConfig(ctx: IntegrationServiceContext): ProviderApiConfig {
	return {
		fetch: ctx.http.fetch.bind(ctx.http),
		wrapForForcedInsecureSSL: ctx.http.wrapForForcedInsecureSSL.bind(ctx.http),
		onConfigChanged: listener =>
			ctx.config.onDidChange(e => {
				if (e.httpProxy) {
					listener();
				}
			}),
		onError: message => ctx.hooks?.ui?.onError?.(message),
		onRequestFailed: message => ctx.hooks?.ui?.onRequestFailed?.(message),
	};
}
