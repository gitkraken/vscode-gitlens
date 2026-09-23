import type { RemoteProvider } from '@gitlens/git/models/remoteProvider.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { RemoteProviderConfig } from '@gitlens/git/remotes/matcher.js';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import type { ConfiguredIntegrationDescriptor } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { AuthenticationError, RequestNotFoundError } from '../errors.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import { isAzureCloudDomain, isBitbucketCloudDomain, isGitHubDotCom, isGitLabDotCom } from '../providers/models.js';
import type { RepositoryIdentity, RepositoryResolution, ResolveRepositoryResult } from '../results.js';
import { toProviderWarning } from '../results.js';
import {
	areDomainsOnSameHost,
	areDomainsOnSameHostname,
	decodePathSegment,
	hostFromDomain,
} from '../utils/domain.utils.js';
import {
	getIntegrationIdForRemote,
	getSelfManagedBaseUrl,
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
	remoteProviderTypeForConfig,
	remoteProviderTypeForIntegration,
} from '../utils/integration.utils.js';
import type { RepositoryResolutionContext } from './context.js';
import { noConnectionWarning } from './warnings.js';

type ResolveRepositoryOptions = {
	providerId?: IntegrationIds;
	remoteUrl: string;
	host?: string;
	connectionId?: string;
	/**
	 * Explicit self-managed host domain used to select the integration instance. Used only when the requested
	 * connection has no configured domain; it must come from the trusted authentication configuration, not
	 * repository or remote data.
	 */
	domain?: string;
};

/**
 * Resolution of a remote URL to a provider repository identity — the facade's equivalent of `gk repo resolve`.
 *
 * Unlike every other read here, this one's input is REPOSITORY data, so most of the code below is about not
 * letting that data choose the credentials: an explicit cloud `providerId` must agree with the remote's canonical
 * host, and a self-managed host resolves only against a domain the user already authenticated. The
 * `host-mismatch` returns are those guards, not edge cases — resolving `owner/repo` against the wrong account
 * would hand back a confidently wrong identity and seed the domain-keyed instance cache from remote data.
 */
export async function resolveRepository(
	ctx: RepositoryResolutionContext,
	options: ResolveRepositoryOptions,
): Promise<ResolveRepositoryResult> {
	const result = (status: RepositoryResolution['status']): ResolveRepositoryResult => ({
		resolution: { status: status },
	});

	const [scheme, parsedDomain, path] = parseGitRemoteUrl(options.remoteUrl);
	// An SSH remote's port belongs to its SSH daemon, not to the web authority a connection is keyed by.
	const hostsMatch = isWebRemoteScheme(scheme) ? areDomainsOnSameHost : areDomainsOnSameHostname;
	const parsedHost = hostFromDomain(parsedDomain);
	const explicitHost = hostFromDomain(options.host);
	if (parsedHost != null && explicitHost != null && !hostsMatch(parsedHost, explicitHost)) {
		return result('host-mismatch');
	}

	const matcherDomain = parsedDomain || options.host || '';

	// An explicit cloud provider must agree with the remote's canonical cloud host. Without this guard the
	// synthetic matcher below can reinterpret, for example, a gitlab.com URL as GitHub and then resolve a
	// homonymous owner/repo through the wrong account. Match once without caller configs/synthetic entries;
	// Azure's matcher also normalizes ssh.dev.azure.com and vs-ssh.visualstudio.com to their web host.
	if (options.providerId != null && isGitCloudHostIntegrationId(options.providerId)) {
		const nativeProvider = createRemoteProviderMatcher([])(options.remoteUrl, matcherDomain, path, scheme);
		const nativeId = nativeProvider != null ? getIntegrationIdForRemote(nativeProvider) : undefined;
		const nativeDomain = nativeProvider?.domain ?? matcherDomain;
		const canonicalHost =
			options.providerId === GitCloudHostIntegrationId.GitHub
				? isGitHubDotCom(nativeDomain)
				: options.providerId === GitCloudHostIntegrationId.GitLab
					? isGitLabDotCom(nativeDomain)
					: options.providerId === GitCloudHostIntegrationId.Bitbucket
						? isBitbucketCloudDomain(nativeDomain)
						: isAzureCloudDomain(nativeDomain);
		if (nativeId !== options.providerId || !canonicalHost) return result('host-mismatch');
	}

	let provider = createRemoteProviderMatcher(buildMatcherConfigs(ctx, options, parsedDomain))(
		options.remoteUrl,
		matcherDomain,
		path,
		scheme,
	);
	if (provider == null) return result('invalid-remote-url');

	let id = options.providerId ?? getIntegrationIdForRemote(provider);
	// Custom Azure DevOps Server domains matched via getRemoteConfigs return undefined from
	// getIntegrationIdForRemote because the provider is marked custom; map them to the server id so the
	// project-scoped lookup uses that host's configured connection and API base URL.
	if (id == null && provider.id === 'azure-devops' && provider.custom) {
		id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	}
	if (id == null) return result('unsupported-provider');

	// On a self-managed host, resolve only against a TRUSTED host: the pinned connection's configured
	// domain, the explicit `domain`, or — when neither was supplied — a configured host matching the
	// remote's. That last case keeps `remoteUrl` (repository-supplied) out of the trusted path: it selects
	// among hosts the user already authenticated and can never introduce a new one. Resolving `owner/repo`
	// against some other host's account would, if that host has the same owner/repo, return a confidently
	// wrong identity — and would seed the domain-keyed integration cache (never evicted before dispose) with
	// an entry derived from repository data.
	const urlHost = hostFromDomain(provider.domain);
	// Normalize BOTH sides before comparing: a stored connection domain is usually a full URL
	// (`https://git.example.com`) while `urlHost` is already a bare host, so a raw compare would fail on
	// scheme/trailing-slash alone and wrongly reject a correctly-configured connection.
	let trustedHost =
		options.connectionId != null || options.domain != null
			? hostFromDomain(ctx.resolveDomainForRead(id, options.connectionId, options.domain))
			: undefined;
	let connectionId = options.connectionId;
	let providerRepo: ResourceDescriptor | undefined;
	if (isGitSelfManagedHostIntegrationId(id)) {
		if (path.split('/').some(segment => /^(?:\.|%2e){1,2}$/i.test(segment) || /%2f|%5c|\\/i.test(segment))) {
			return result('invalid-remote-url');
		}

		const configured = ctx.getConfigured(id);
		const configuredHosts = configured.map(c => hostFromDomain(c.domain));
		if (trustedHost == null && urlHost != null) {
			const matchingHosts = new Set(configuredHosts.filter(host => hostsMatch(host, urlHost)));
			if (matchingHosts.size > 1) return result('host-mismatch');

			trustedHost = matchingHosts.values().next().value;
		}
		// A configured host that doesn't match the remote's is a genuine mismatch. With nothing configured
		// there is no host to mismatch against — it's simply not connected, so fall through to the
		// `unauthorized` path below (still WITHOUT resolving by the URL domain, so repo data can't seed the
		// cache).
		if (trustedHost == null && configuredHosts.length !== 0) return result('host-mismatch');
		if (trustedHost != null && urlHost != null && !hostsMatch(trustedHost, urlHost)) {
			return result('host-mismatch');
		}

		const installation = matchInstallation(
			ctx,
			options,
			id,
			configured.filter(c => hostFromDomain(c.domain) === trustedHost),
			{ scheme: scheme, domain: parsedDomain, path: path },
		);
		if (typeof installation === 'string') return result(installation);

		if (installation != null) {
			provider = installation.provider;
			connectionId = installation.connectionId;
			providerRepo = installation.repoDesc;
		}
	}

	const owner = provider.owner;
	const name = provider.repoName;
	if (owner == null || name == null) return result('invalid-remote-url');

	providerRepo ??= provider.repoDesc;

	let integration;
	try {
		// Resolve the instance through the trusted target (as `getIntegrationForRead` does):
		// `resolveReadSession` looks the session up against the instance's domain-scoped descriptor, so
		// selecting the instance by the URL domain could miss the session and degrade to `no-connection`.
		integration = isGitSelfManagedHostIntegrationId(id)
			? trustedHost != null
				? await ctx.getIntegrationForRead(id, connectionId, trustedHost)
				: undefined
			: await ctx.getIntegrationForDomain(id, provider.domain);
	} catch {
		integration = undefined;
	}
	if (integration == null) {
		// Attach a warning, as the thrown-AuthenticationError branch below does: a consumer driving auth
		// recovery off `warning.kind` would otherwise get nothing for an unresolvable target.
		return {
			resolution: {
				status: 'unauthorized',
				warning: noConnectionWarning(id, provider.domain, connectionId),
			},
		};
	}
	// Issue trackers have no `getRepo` client; a git host without `getRepoFn` leaves `getRepoInfo`
	// undefined. Either way this provider can't resolve repositories.
	if (isIssuesIntegration(integration) || integration.getRepoInfo == null) {
		return result('unsupported-provider');
	}

	// Azure repos are org + project scoped; the remote provider exposes project as `providerDesc.repoDomain`.
	const project = provider.id === 'azure-devops' ? provider.providerDesc?.repoDomain : undefined;
	const domain = trustedHost ?? provider.domain;

	// Azure's lookup is project-scoped and returns `undefined` without one, which the connection-gap branch
	// below would misreport as `unauthorized` (driving a pointless reconnect). A remote URL that carries no
	// project simply can't address an Azure repo.
	if (provider.id === 'azure-devops' && project == null) return result('invalid-remote-url');

	try {
		const repo = await integration.getRepoInfo({
			...providerRepo,
			owner: owner,
			name: name,
			project: project,
			connectionId: connectionId,
		});
		if (repo == null) {
			// `getRepoInfo` returns undefined only when no session could be resolved (not connected, or the
			// requested connection is gone) — a real 404 throws below. So this is a connection gap. Attach a
			// warning so a consumer driving auth recovery off `warning.kind` sees the same signal it gets from
			// the thrown-AuthenticationError branch below; without it, the most common unauthorized case is
			// silent.
			return {
				resolution: {
					status: 'unauthorized',
					warning: noConnectionWarning(id, domain, connectionId),
				},
			};
		}

		// Prefer the provider's canonical namespace/name (GitHub's REST/GraphQL lookup follows the 301
		// rename redirect, so a stale old name resolves to the new canonical identity), falling back to the
		// parsed remote when the response omits them. `renamed` is a case-insensitive compare of input vs
		// canonical, mirroring gkcli's `EqualFold`, so hosts that merely echo the input casing (e.g.
		// Bitbucket Server/Azure) don't get spuriously flagged.
		const canonicalOwner = repo.namespace || owner;
		const canonicalName = repo.name || name;
		const renamed =
			canonicalOwner.toLowerCase() !== owner.toLowerCase() || canonicalName.toLowerCase() !== name.toLowerCase();

		const identity: RepositoryIdentity = {
			providerId: id,
			domain: domain,
			owner: canonicalOwner,
			name: canonicalName,
			project: project,
			remoteUrl: options.remoteUrl,
			renamed: renamed,
		};
		return { resolution: { status: 'resolved', identity: identity } };
	} catch (ex) {
		// Order matters: 404 throws RequestNotFoundError (not `undefined`), so check not-found before auth
		// and before the generic 5xx/unknown bucket — never classify a 401/403 as not-found.
		let resolution: RepositoryResolution;
		if (ex instanceof RequestNotFoundError) {
			resolution = { status: 'not-found' };
		} else if (ex instanceof AuthenticationError) {
			resolution = { status: 'unauthorized', warning: toProviderWarning(id, domain, connectionId, ex) };
		} else {
			resolution = { status: 'undetermined', warning: toProviderWarning(id, domain, connectionId, ex) };
		}
		return { resolution: resolution };
	}
}

function isWebRemoteScheme(scheme: string | undefined): boolean {
	return scheme === 'https://' || scheme === 'http://';
}

/**
 * Narrows a web remote on a self-managed host to the configured installation it lives under: the pinned
 * connection's or, unpinned, the one whose installation path is the longest prefix of the remote's, so two
 * installations behind one host each resolve with their own credentials. The provider is re-matched against the
 * path relative to that installation, because the remote parsers expect the repository path to start at the
 * host root. An SSH remote carries no installation path, so it is left to the host-level checks.
 */
function matchInstallation(
	ctx: RepositoryResolutionContext,
	options: ResolveRepositoryOptions,
	id: GitSelfManagedHostIntegrationId,
	connections: ConfiguredIntegrationDescriptor[],
	remote: { scheme: string; domain: string; path: string },
):
	| { provider: RemoteProvider; connectionId: string | undefined; repoDesc: ResourceDescriptor }
	| 'host-mismatch'
	| 'invalid-remote-url'
	| undefined {
	if (!isWebRemoteScheme(remote.scheme)) return undefined;

	const installationPath = (connection: ConfiguredIntegrationDescriptor | undefined): string | undefined => {
		const baseUrl = getSelfManagedBaseUrl(
			id,
			connection != null ? (connection.baseUrl ?? connection.domain) : options.domain,
		);
		return baseUrl != null ? new URL(baseUrl).pathname.replace(/\/+$/, '') : undefined;
	};

	// The connection an unpinned read already targets comes first, so it wins a tie between installations.
	const defaultConnection = connections.find(c => c.primary) ?? connections[0];
	// A cloud sync serves the host's cloud-scoped default instead, even over a local primary (see
	// `getStoredSession`), so an unpinned read reaches the default's installation only when both agree.
	const cloudConnections = connections.filter(c => c.cloud);
	const cloudDefault = cloudConnections.find(c => c.primary) ?? cloudConnections[0];
	const isDefaultReadable =
		defaultConnection?.cloud !== false ||
		cloudDefault == null ||
		installationPath(cloudDefault) === installationPath(defaultConnection);
	// Whether an unpinned read can reach this connection's session: the default one is read without an id, any
	// other only by a real cloud token id. Session lookup treats every connection id as one, and a local (PAT)
	// descriptor's or domain-derived legacy id is not (see `getConfiguredConnectionId`).
	const isReadable = (connection: ConfiguredIntegrationDescriptor | undefined): boolean =>
		options.connectionId != null ||
		(connection === defaultConnection
			? isDefaultReadable
			: connection?.cloud === true && hostFromDomain(connection.id) !== connection.domain);

	const candidates: (ConfiguredIntegrationDescriptor | undefined)[] =
		options.connectionId != null
			? connections.filter(c => c.id === options.connectionId)
			: [defaultConnection, ...connections.filter(c => c !== defaultConnection)];
	// With no configured candidate, the explicit (trusted) `domain` is the only installation address there is.
	if (!candidates.length) {
		candidates.push(undefined);
	}

	const remotePath = `/${remote.path}`;
	const remoteSegments = remote.path.split('/');
	// The remote's path below an installation, or `undefined` when it isn't under it. Azure DevOps Server runs on
	// IIS, which serves its paths decoded and case-insensitively, so it compares segment by segment.
	const relativeTo = (basePath: string): string | undefined => {
		if (id !== GitSelfManagedHostIntegrationId.AzureDevOpsServer) {
			return remotePath.startsWith(`${basePath}/`) ? remotePath.slice(basePath.length + 1) : undefined;
		}

		const baseSegments = basePath.split('/').filter(Boolean);
		const isUnder =
			remoteSegments.length > baseSegments.length &&
			baseSegments.every(
				(segment, i) =>
					decodePathSegment(segment).toLowerCase() === decodePathSegment(remoteSegments[i]).toLowerCase(),
			);
		return isUnder ? remoteSegments.slice(baseSegments.length).join('/') : undefined;
	};
	let match: { connection: ConfiguredIntegrationDescriptor | undefined; basePath: string } | undefined;
	let checked = false;
	for (const connection of candidates) {
		const basePath = installationPath(connection);
		if (basePath == null) continue;

		checked = true;
		if (relativeTo(basePath) == null) continue;

		// The longest installation wins; on a tie, a readable connection replaces an unreadable one.
		const isBetter =
			match == null ||
			basePath.length > match.basePath.length ||
			(basePath.length === match.basePath.length && !isReadable(match.connection) && isReadable(connection));
		if (isBetter) {
			match = { connection: connection, basePath: basePath };
		}
	}
	if (match == null) return checked ? 'host-mismatch' : undefined;
	// Reading through the default connection instead would address its installation with a path relative to
	// another one, so an unreachable installation fails closed.
	if (!isReadable(match.connection)) return 'host-mismatch';

	const connectionId =
		options.connectionId ?? (match.connection !== defaultConnection ? match.connection?.id : undefined);

	const matcher = createRemoteProviderMatcher(
		buildMatcherConfigs(ctx, { ...options, providerId: id }, remote.domain),
	);
	const rematch = (path: string) => matcher(options.remoteUrl, remote.domain, relativeTo(path) ?? '', remote.scheme);
	let basePath = match.basePath;
	let provider = rematch(basePath);
	if (id !== GitSelfManagedHostIntegrationId.AzureDevOpsServer) {
		return provider != null
			? { provider: provider, connectionId: connectionId, repoDesc: provider.repoDesc }
			: 'invalid-remote-url';
	}

	// An Azure DevOps Server address may name the collection as well as the virtual directory; the parser expects
	// the collection in the path, so re-base on the address's parent when no project was found.
	if (basePath && provider?.providerDesc?.repoDomain == null) {
		basePath = basePath.slice(0, basePath.lastIndexOf('/'));
		provider = rematch(basePath);
	}
	if (provider == null) return 'invalid-remote-url';

	// Requests address the repository's virtual directory from the host root, not from the installation the
	// re-match made it relative to; the absolute form also tells a directory apart from a collection of that name.
	const repoDesc = provider.repoDesc;
	const relative = typeof repoDesc.virtualDirectory === 'string' ? repoDesc.virtualDirectory : undefined;
	const virtualDirectory =
		[...basePath.split('/').filter(Boolean).map(decodePathSegment), ...(relative?.split('/') ?? [])].join('/') ||
		undefined;
	return {
		provider: provider,
		connectionId: connectionId,
		repoDesc: { ...repoDesc, virtualDirectory: virtualDirectory },
	};
}

/**
 * The remote-matcher configs for this resolution: the user's own host remote configs (self-managed/custom
 * domains), plus a synthetic exact-domain entry for an explicit `providerId` + host so a custom domain still maps
 * to the right provider for path parsing.
 */
function buildMatcherConfigs(
	ctx: RepositoryResolutionContext,
	options: { providerId?: IntegrationIds; host?: string },
	parsedDomain: string,
): RemoteProviderConfig[] {
	const configs: RemoteProviderConfig[] = [];
	for (const cfg of ctx.getRemoteConfigs()) {
		const type = remoteProviderTypeForConfig(cfg.type);
		if (type == null) continue;

		// Forward both domain- and regex-based custom remotes (carrying any protocol override), so a
		// regex-configured host resolves instead of falling through to `unsupported`.
		if (cfg.domain) {
			configs.push({ type: type, domain: cfg.domain, protocol: cfg.protocol });
		} else if (cfg.regex) {
			configs.push({ type: type, regex: cfg.regex, protocol: cfg.protocol });
		}
	}
	if (options.providerId == null) return configs;

	const type = remoteProviderTypeForIntegration(options.providerId);
	const domain = parsedDomain || options.host;
	if (type == null || !domain) return configs;

	// The synthetic exact-domain entry is unshifted to the front, so it wins the match over the user's own
	// config for the same host. Carry that config's protocol override across (matched by domain or regex,
	// mirroring `ignoreSSLErrors`) so a self-managed host configured for a custom protocol — e.g. plain
	// `http` — isn't silently downgraded to the provider default here.
	const lowerDomain = domain.toLowerCase();
	const protocol = configs.find(c => {
		if (c.type !== type) return false;
		if (c.domain != null) return c.domain.toLowerCase() === lowerDomain;

		// Truthy (not just non-null): an empty regex would compile to a match-everything pattern.
		if (c.regex) {
			try {
				return new RegExp(c.regex, 'i').test(lowerDomain);
			} catch {
				return false;
			}
		}

		return false;
	})?.protocol;
	configs.unshift({ type: type, domain: domain, protocol: protocol });
	return configs;
}
