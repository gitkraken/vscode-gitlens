// A lightweight, token-scoped entry point for stateless single-shot provider reads.
//
// Unlike `createIntegrationManager`, this does NOT build an `IntegrationServiceContext`
// (no storage/account/config/cache/repositories/hooks) and runs no session/OAuth lifecycle.
// A consumer that already holds a provider access token (obtained by its own means, e.g.
// the GitKraken account backend's `v1/provider-tokens/{provider}` endpoint) can call the
// per-provider API client directly and get back the same DTOs the session-managed
// `GitHostIntegration` returns.
//
// Provider notes:
// - Azure DevOps encodes the repository as the composite string `"{project}/_git/{repoName}"`
//   in the `repo` argument (matching the descriptor `GitHostIntegration` uses); `owner` is the
//   organization. Pass `repo` in that shape for Azure.
// - Bitbucket Cloud `getDefaultBranch`/`getRepositoryMetadata` depend on `mainbranch`/`parent`
//   fields the API may omit for some repos; they resolve to `undefined` when absent.
// - Bitbucket Server (`bitbucket-server`) is not supported here — its reads use a different
//   REST surface that this token-scoped path doesn't wire up.

import type { GitHubApiConfig } from '@gitlens/git-github/api/config.js';
import { GitHubApi } from '@gitlens/git-github/api/github.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { TokenWithInfo } from './authentication/models.js';
import { toTokenInfo } from './authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from './constants.js';
import type { ProviderApiConfig } from './providers/apiConfig.js';
import { AzureDevOpsApi } from './providers/azure/azure.js';
import { BitbucketApi } from './providers/bitbucket/bitbucket.js';
import { GitLabApi } from './providers/gitlab/gitlab.js';
import { providersMetadata } from './providers/models.js';

/** The git-hosting integrations that expose a token-scoped read path here. */
export type TokenScopedGitHostId =
	| GitCloudHostIntegrationId.GitHub
	| GitCloudHostIntegrationId.GitLab
	| GitCloudHostIntegrationId.Bitbucket
	| GitCloudHostIntegrationId.AzureDevOps
	| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
	| GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
	| GitSelfManagedHostIntegrationId.AzureDevOpsServer;

export interface TokenScopedGitHostToken {
	/** The provider access token the consumer already holds. */
	readonly accessToken: string;
	/**
	 * Host domain for self-managed instances (e.g. `git.example.com`). Ignored for cloud ids. For an Azure
	 * DevOps Server reachable over plain HTTP, include the scheme (e.g. `http://tfs.example.com`); otherwise
	 * `https` is assumed.
	 */
	readonly domain?: string;
	/** Optional scopes carried by the token, surfaced only in logging metadata. */
	readonly scopes?: readonly string[];
	/** Whether the token came from a GK-cloud connection (vs a raw PAT). Defaults to `true`. */
	readonly cloud?: boolean;
}

export interface TokenScopedHttpConfig {
	/** The `fetch` implementation to use for HTTP requests. */
	fetch(input: string | URL, init?: RequestInit): Promise<Response>;
	/**
	 * Wrap an async op so TLS validation is disabled when `ignoreSSLErrors` is `'force'`. Optional —
	 * defaults to a pass-through, which is correct for the browser and for any consumer not toggling SSL.
	 */
	wrapForForcedInsecureSSL?<T>(ignoreSSLErrors: boolean | 'force', fn: () => Promise<T> | PromiseLike<T>): Promise<T>;
	/** Whether to ignore SSL certificate errors on requests. Defaults to `false`. */
	ignoreSSLErrors?: boolean | 'force';
	/**
	 * Whether the consumer runs in a web worker / browser (vs Node.js). GitHub uses this to drop the
	 * `user-agent` header, which browsers reject and warn about. Defaults to `false`.
	 */
	isWeb?: boolean;
}

/** The stateless reads a token-scoped integration exposes. */
export interface TokenScopedGitHostIntegration {
	getRepositoryMetadata(
		owner: string,
		repo: string,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined>;
	getDefaultBranch(owner: string, repo: string, cancellation?: AbortSignal): Promise<DefaultBranch | undefined>;
}

/**
 * Build a token-scoped git-host integration for a single provider, backed only by a `fetch` + a token —
 * no `IntegrationServiceContext`, no session/OAuth lifecycle. The returned DTOs match those from the
 * session-managed {@link GitHostIntegration}.
 */
export function createTokenScopedGitHostIntegration(
	id: TokenScopedGitHostId,
	token: TokenScopedGitHostToken,
	http: TokenScopedHttpConfig,
): TokenScopedGitHostIntegration {
	// `token.domain` only applies to self-managed ids; cloud ids always use their canonical domain.
	const selfManaged =
		id === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise ||
		id === GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted ||
		id === GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	// Self-managed ids carry no canonical domain (`providersMetadata[id].domain` is empty), so a missing
	// `token.domain` would silently build a malformed base URL (e.g. `https:///api/v3`). Fail fast instead.
	if (selfManaged && !token.domain) {
		throw new Error(`A token-scoped integration for the self-managed host '${id}' requires 'token.domain'.`);
	}

	const rawDomain = (selfManaged && token.domain) || providersMetadata[id].domain;
	// The provider/DTO domain drops the scheme (a subpath/collection is preserved for Azure Server and subpath
	// installs); only Azure DevOps Server's base URL honors an explicit scheme (per its doc). Stripping keeps a
	// scheme out of the DTO and prevents a malformed base URL (e.g. `https://http://host/api/v3`) if one is
	// accidentally passed for GHE/GitLab.
	const host = stripScheme(rawDomain);
	const provider = createProviderStub(id, host, http.ignoreSSLErrors ?? false);
	const tokenInfo = buildTokenWithInfo(id, token);
	const baseUrl = resolveApiBaseUrl(id, rawDomain, host);

	const wrapForForcedInsecureSSL: NonNullable<TokenScopedHttpConfig['wrapForForcedInsecureSSL']> =
		// `Promise.resolve().then(fn)` (not `Promise.resolve(fn())`) so a synchronous throw in `fn` surfaces as
		// a rejected promise, honoring the `Promise<T>` contract.
		http.wrapForForcedInsecureSSL ?? ((_ignore, fn) => Promise.resolve().then(fn));

	// GitHub has its own VS Code-free config type and a `getDefaultBranch` without a cancellation param.
	if (id === GitCloudHostIntegrationId.GitHub || id === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise) {
		const config: GitHubApiConfig = {
			isWeb: http.isWeb ?? false,
			fetch: (url, init) => http.fetch(url, init),
			wrapForForcedInsecureSSL: wrapForForcedInsecureSSL,
		};
		const api = new GitHubApi(config);
		return {
			getRepositoryMetadata: (owner, repo, cancellation) =>
				api.getRepositoryMetadata(provider, tokenInfo, owner, repo, { baseUrl: baseUrl }, cancellation),
			// `GitHubApi.getDefaultBranch` has no cancellation param; accept and intentionally ignore it here so
			// the signature matches the other providers and the drop is explicit at the call site.
			getDefaultBranch: (owner, repo, _cancellation) =>
				api.getDefaultBranch(provider, tokenInfo, owner, repo, { baseUrl: baseUrl }),
		};
	}

	// GitLab, Bitbucket, and Azure DevOps share the `ProviderApiConfig` client shape and identical read signatures.
	const config = toProviderApiConfig(http, wrapForForcedInsecureSSL);
	const api =
		id === GitCloudHostIntegrationId.GitLab || id === GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
			? new GitLabApi(config)
			: id === GitCloudHostIntegrationId.Bitbucket
				? new BitbucketApi(config)
				: new AzureDevOpsApi(config);
	return {
		getRepositoryMetadata: (owner, repo, cancellation) =>
			api.getRepositoryMetadata(provider, tokenInfo, owner, repo, { baseUrl: baseUrl }, cancellation),
		getDefaultBranch: (owner, repo, cancellation) =>
			api.getDefaultBranch(provider, tokenInfo, owner, repo, { baseUrl: baseUrl }, cancellation),
	};
}

function toProviderApiConfig(
	http: TokenScopedHttpConfig,
	wrapForForcedInsecureSSL: NonNullable<TokenScopedHttpConfig['wrapForForcedInsecureSSL']>,
): ProviderApiConfig {
	return {
		fetch: (input, init) => http.fetch(input, init),
		wrapForForcedInsecureSSL: wrapForForcedInsecureSSL,
	};
}

function buildTokenWithInfo(id: TokenScopedGitHostId, token: TokenScopedGitHostToken): TokenWithInfo {
	const cloud = token.cloud ?? true;
	return {
		...toTokenInfo(id, token.accessToken, { cloud: cloud, type: undefined, scopes: token.scopes }),
		accessToken: token.accessToken,
	};
}

/** A minimal {@link Provider} for the API clients: identity + no-op reauth/telemetry, SSL from config. */
function createProviderStub(id: TokenScopedGitHostId, domain: string, ignoreSSLErrors: boolean | 'force'): Provider {
	const metadata = providersMetadata[id];
	return {
		id: id,
		name: metadata.name,
		domain: domain,
		icon: metadata.iconKey,
		getIgnoreSSLErrors: () => ignoreSSLErrors,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	};
}

/** Strips a leading `scheme://` and any trailing slashes; a subpath/collection (e.g. `host/tfs/Col`) is preserved. */
function stripScheme(domain: string): string {
	return domain.replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Mirrors the per-provider `apiBaseUrl` getters on the `GitHostIntegration` subclasses. `rawDomain` may
 * carry a scheme (only Azure DevOps Server honors it); `host` is the bare host used everywhere else.
 */
function resolveApiBaseUrl(id: TokenScopedGitHostId, rawDomain: string, host: string): string {
	switch (id) {
		case GitCloudHostIntegrationId.GitHub:
			return 'https://api.github.com';
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return `https://${host}/api/v3`;
		case GitCloudHostIntegrationId.GitLab:
			return 'https://gitlab.com/api';
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return `https://${host}/api`;
		case GitCloudHostIntegrationId.Bitbucket:
			return 'https://api.bitbucket.org/2.0';
		case GitCloudHostIntegrationId.AzureDevOps:
			return 'https://dev.azure.com';
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			// Mirror the session-managed getter, which honors the connection protocol; default to https.
			return rawDomain.includes('://') ? rawDomain.replace(/\/+$/, '') : `https://${host}`;
	}
}
