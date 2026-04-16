import { Logger } from '@gitlens/utils/logger.js';
import type { RemoteProviderContext } from '../context.js';
import type {
	RemoteProvider,
	RemoteProviderId,
	RemoteProviderMatcher,
	RemotesUrlsConfig,
} from '../models/remoteProvider.js';
import { AzureDevOpsRemoteProvider, isVsts } from './azure-devops.js';
import { BitbucketServerRemoteProvider } from './bitbucket-server.js';
import { BitbucketRemoteProvider } from './bitbucket.js';
import { CustomRemoteProvider } from './custom.js';
import { GerritRemoteProvider } from './gerrit.js';
import { GiteaRemoteProvider } from './gitea.js';
import { GitHubRemoteProvider } from './github.js';
import { GitLabRemoteProvider } from './gitlab.js';
import { GoogleSourceRemoteProvider } from './google-source.js';

export type { RemoteProviderMatcher } from '../models/remoteProvider.js';

/**
 * Configuration for a remote provider, provided by the host.
 * The library uses these to build a {@link RemoteProviderMatcher} internally.
 *
 * Each config describes either a user-configured custom remote (from settings)
 * or a cloud self-managed host (from integration descriptors).
 */
export interface RemoteProviderConfig {
	readonly type: RemoteProviderId;
	/** Domain for exact string matching (mutually exclusive with `regex`) */
	readonly domain?: string;
	/** Regex pattern for flexible matching (mutually exclusive with `domain`) */
	readonly regex?: string;
	/** URL protocol override (e.g., `'https'`) */
	readonly protocol?: string;
	/** Display name override */
	readonly name?: string;
	/** Custom URL templates — required when `type` is `'Custom'` */
	readonly urls?: RemotesUrlsConfig;
}

interface ProviderEntry {
	custom: boolean;
	/** When true, the regex is also tested against the full URL (not just the domain) */
	matchUrl?: boolean;
	matcher: string | RegExp;
	type: RemoteProviderId;
	protocol?: string;
	name?: string;
	urls?: RemotesUrlsConfig;
}

const builtInProviders: ProviderEntry[] = [
	{ custom: false, matcher: 'bitbucket.org', type: 'bitbucket' },
	{ custom: false, matcher: 'github.com', type: 'github' },
	{ custom: false, matcher: 'gitlab.com', type: 'gitlab' },
	{ custom: false, matcher: /\bdev\.azure\.com$/i, type: 'azure-devops' },
	{ custom: false, matchUrl: true, matcher: /^(.+\/(?:bitbucket|stash))\/scm\/(.+)$/i, type: 'bitbucket-server' },
	{ custom: false, matcher: /\bgitlab\b/i, type: 'gitlab' },
	{ custom: false, matcher: /\bvisualstudio\.com$/i, type: 'azure-devops' },
	{ custom: false, matcher: /\bgitea\b/i, type: 'gitea' },
	{ custom: false, matcher: /\bgerrithub\.io$/i, type: 'gerrit' },
	{ custom: false, matcher: /\bgooglesource\.com$/i, type: 'google-source' },
];

const protocolRegex = /(\w+)\W*/;
function cleanProtocol(scheme: string | undefined): string | undefined {
	const protocol = scheme?.match(protocolRegex)?.[1];
	// Only preserve web protocols; non-web schemes (e.g. `ssh`, `git`) must fall back to the
	// provider's default so web URLs (commit/issue/PR pages) don't inherit an unreachable scheme
	return protocol === 'http' || protocol === 'https' ? protocol : undefined;
}

function createProvider(
	entry: ProviderEntry,
	domain: string,
	path: string,
	scheme: string | undefined,
	context?: RemoteProviderContext,
): RemoteProvider | undefined {
	const protocol = entry.protocol ?? cleanProtocol(scheme);

	if (entry.type === 'custom' && entry.urls != null) {
		return new CustomRemoteProvider(domain, path, entry.urls, protocol, entry.name);
	}

	return createBuiltInProvider(entry.type, domain, path, protocol, entry.name, entry.custom, context);
}

function createBuiltInProvider(
	type: RemoteProviderId,
	domain: string,
	path: string,
	protocol?: string,
	name?: string,
	custom?: boolean,
	context?: RemoteProviderContext,
): RemoteProvider | undefined {
	switch (type) {
		case 'azure-devops':
			return new AzureDevOpsRemoteProvider(domain, path, protocol, name, isVsts(domain), context);
		case 'bitbucket':
			return new BitbucketRemoteProvider(domain, path, protocol, name, custom, context);
		case 'bitbucket-server':
			return new BitbucketServerRemoteProvider(domain, path, protocol, name, custom, context);
		case 'custom':
			return undefined; // Custom requires urls — handled in config entries
		case 'gerrit':
			return new GerritRemoteProvider(domain, path, protocol, name, custom, undefined, context);
		case 'google-source':
			return new GoogleSourceRemoteProvider(domain, path, protocol, name, custom, context);
		case 'gitea':
			return new GiteaRemoteProvider(domain, path, protocol, name, custom, context);
		case 'github':
			return new GitHubRemoteProvider(domain, path, protocol, name, custom, context);
		case 'gitlab':
			return new GitLabRemoteProvider(domain, path, protocol, name, custom, context);
		default:
			return undefined;
	}
}

function configsToEntries(configs: RemoteProviderConfig[]): ProviderEntry[] {
	const entries: ProviderEntry[] = [];
	for (const cfg of configs) {
		let matcher: string | RegExp | undefined;
		try {
			matcher = cfg.regex ? new RegExp(cfg.regex, 'i') : cfg.domain?.toLowerCase();
			if (matcher == null) {
				Logger.error(undefined, `Remote provider config for '${cfg.name ?? cfg.type}' has no domain or regex`);
				continue;
			}
		} catch (ex) {
			Logger.error(ex, `Loading remote provider config '${cfg.name ?? cfg.type}' failed`);
			continue;
		}

		entries.push({
			custom: true,
			matchUrl: true,
			matcher: matcher,
			type: cfg.type,
			protocol: cfg.protocol,
			name: cfg.name,
			urls: cfg.urls,
		});
	}
	return entries;
}

function matchEntries(
	entries: ProviderEntry[],
	url: string,
	domain: string,
	path: string,
	scheme: string | undefined,
	hooks?: RemoteProviderContext,
): RemoteProvider | undefined {
	const key = domain?.toLowerCase();
	for (const entry of entries) {
		if (typeof entry.matcher === 'string') {
			if (entry.matcher === key) {
				return createProvider(entry, domain, path, scheme, hooks);
			}
			continue;
		}

		if (entry.matcher.test(key)) {
			return createProvider(entry, domain, path, scheme, hooks);
		}
		if (!entry.matchUrl) continue;

		const match = entry.matcher.exec(url);
		if (match != null) {
			const matchDomain = match[1].replace(/^[a-zA-Z][\w+.-]*:\/\//, '');
			return createProvider(entry, matchDomain, match[2], scheme, hooks);
		}
	}

	return undefined;
}

/**
 * Creates a {@link RemoteProviderMatcher} from optional extra configs and built-in providers.
 *
 * Extra configs (from user settings or cloud integrations) are matched first, then built-ins.
 * The optional {@link RemoteProviderContext} is attached to each created provider so it can
 * call host-side providers (e.g., cross-fork PR URLs, autolink decoration).
 *
 * @param configs - Extra provider configs beyond built-ins (user custom remotes, cloud self-managed hosts)
 * @param context - Optional host-provided context to attach to created providers
 */
export function createRemoteProviderMatcher(
	configs?: RemoteProviderConfig[],
	context?: RemoteProviderContext,
): RemoteProviderMatcher {
	const extraEntries = configs?.length ? configsToEntries(configs) : undefined;

	return (url: string, domain: string, path: string, scheme: string | undefined): RemoteProvider | undefined => {
		try {
			// Try extra configs first (user-configured + cloud self-managed take priority)
			if (extraEntries != null) {
				const provider = matchEntries(extraEntries, url, domain, path, scheme, context);
				if (provider != null) return provider;
			}

			// Fall back to built-in providers
			return matchEntries(builtInProviders, url, domain, path, scheme, context);
		} catch (ex) {
			debugger;
			Logger.error(ex, 'createRemoteProviderMatcher');
			return undefined;
		}
	};
}
