import type { RemotesConfig } from '../../config';
import type { Container } from '../../container';
import { Logger } from '../../system/logger';
import { configuration } from '../../system/vscode/configuration';
import { AzureDevOpsRemote } from './azure-devops';
import { BitbucketRemote } from './bitbucket';
import { BitbucketServerRemote } from './bitbucket-server';
import { CustomRemote } from './custom';
import { GerritRemote } from './gerrit';
import { GiteaRemote } from './gitea';
import { GitHubRemote } from './github';
import { GitLabRemote } from './gitlab';
import { GoogleSourceRemote } from './google-source';
import type { RemoteProvider } from './remoteProvider';

export type RemoteProviders = {
	custom: boolean;
	matcher: string | RegExp;
	creator: (container: Container, domain: string, path: string) => RemoteProvider;
}[];

const builtInProviders: RemoteProviders = [
	{
		custom: false,
		matcher: 'bitbucket.org',
		creator: (_container: Container, domain: string, path: string) => new BitbucketRemote(domain, path),
	},
	{
		custom: false,
		matcher: 'github.com',
		creator: (_container: Container, domain: string, path: string) => new GitHubRemote(domain, path),
	},
	{
		custom: false,
		matcher: 'gitlab.com',
		creator: (_container: Container, domain: string, path: string) => new GitLabRemote(domain, path),
	},
	{
		custom: false,
		matcher: /\bdev\.azure\.com$/i,
		creator: (_container: Container, domain: string, path: string) => new AzureDevOpsRemote(domain, path),
	},
	{
		custom: true,
		matcher: /^(.+\/(?:bitbucket|stash))\/scm\/(.+)$/i,
		creator: (_container: Container, domain: string, path: string) => new BitbucketServerRemote(domain, path),
	},
	{
		custom: false,
		matcher: /\bgitlab\b/i,
		creator: (_container: Container, domain: string, path: string) => new GitLabRemote(domain, path),
	},
	{
		custom: false,
		matcher: /\bvisualstudio\.com$/i,
		creator: (_container: Container, domain: string, path: string) =>
			new AzureDevOpsRemote(domain, path, undefined, undefined, true),
	},
	{
		custom: false,
		matcher: /\bgitea\b/i,
		creator: (_container: Container, domain: string, path: string) => new GiteaRemote(domain, path),
	},
	{
		custom: false,
		matcher: /\bgerrithub\.io$/i,
		creator: (_container: Container, domain: string, path: string) => new GerritRemote(domain, path),
	},
	{
		custom: false,
		matcher: /\bgooglesource\.com$/i,
		creator: (_container: Container, domain: string, path: string) => new GoogleSourceRemote(domain, path),
	},
];

export function loadRemoteProviders(cfg: RemotesConfig[] | null | undefined): RemoteProviders {
	const providers: RemoteProviders = [];

	if (cfg?.length) {
		for (const rc of cfg) {
			const providerCreator = getCustomProviderCreator(rc);
			if (providerCreator == null) continue;

			let matcher: string | RegExp | undefined;
			try {
				matcher = rc.regex ? new RegExp(rc.regex, 'i') : rc.domain?.toLowerCase();
				if (matcher == null) throw new Error('No matcher found');
			} catch (ex) {
				Logger.error(ex, `Loading remote provider '${rc.name ?? ''}' failed`);
			}

			providers.push({
				custom: true,
				matcher: matcher!,
				creator: providerCreator,
			});
		}
	}

	providers.push(...builtInProviders);

	return providers;
}

function getCustomProviderCreator(cfg: RemotesConfig) {
	switch (cfg.type) {
		case 'AzureDevOps':
			return (_container: Container, domain: string, path: string) =>
				new AzureDevOpsRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'Bitbucket':
			return (_container: Container, domain: string, path: string) =>
				new BitbucketRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'BitbucketServer':
			return (_container: Container, domain: string, path: string) =>
				new BitbucketServerRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'Custom':
			return (_container: Container, domain: string, path: string) =>
				new CustomRemote(domain, path, cfg.urls!, cfg.protocol, cfg.name);
		case 'Gerrit':
			return (_container: Container, domain: string, path: string) =>
				new GerritRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'GoogleSource':
			return (_container: Container, domain: string, path: string) =>
				new GoogleSourceRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'Gitea':
			return (_container: Container, domain: string, path: string) =>
				new GiteaRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'GitHub':
			return (_container: Container, domain: string, path: string) =>
				new GitHubRemote(domain, path, cfg.protocol, cfg.name, true);
		case 'GitLab':
			return (_container: Container, domain: string, path: string) =>
				new GitLabRemote(domain, path, cfg.protocol, cfg.name, true);
		default:
			return undefined;
	}
}

export function getRemoteProviderMatcher(
	container: Container,
	providers?: RemoteProviders,
): (url: string, domain: string, path: string) => RemoteProvider | undefined {
	if (providers == null) {
		providers = loadRemoteProviders(configuration.get('remotes', null));
	}

	return (url: string, domain: string, path: string) =>
		createBestRemoteProvider(container, providers, url, domain, path);
}

function createBestRemoteProvider(
	container: Container,
	providers: RemoteProviders,
	url: string,
	domain: string,
	path: string,
): RemoteProvider | undefined {
	try {
		const key = domain.toLowerCase();
		for (const { custom, matcher, creator } of providers) {
			if (typeof matcher === 'string') {
				if (matcher === key) return creator(container, domain, path);

				continue;
			}

			if (matcher.test(key)) return creator(container, domain, path);
			if (!custom) continue;

			const match = matcher.exec(url);
			if (match != null) {
				return creator(container, match[1], match[2]);
			}
		}

		return undefined;
	} catch (ex) {
		debugger;
		Logger.error(ex, 'createRemoteProvider');
		return undefined;
	}
}
