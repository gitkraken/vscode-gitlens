import { CustomRemoteType, RemotesConfig, RemotesUrlsConfig } from '../../configuration';
import { Logger } from '../../logger';
import { GitRemoteUrl } from '../parsers';
import { AzureDevOpsRemote } from './azure-devops';
import { BitbucketRemote } from './bitbucket';
import { BitbucketServerRemote } from './bitbucket-server';
import { CustomRemote } from './custom';
import { GerritRemote } from './gerrit';
import { GiteaRemote } from './gitea';
import { GitHubRemote } from './github';
import { GitLabRemote } from './gitlab';
import { GoogleSourceRemote } from './google-source';
import { RemoteProvider } from './provider';

// export { RemoteProvider, RichRemoteProvider };
export type RemoteProviders = {
	custom: boolean;
	matcher: string | RegExp;
	creator: (gitRemoteUrl: GitRemoteUrl) => RemoteProvider;
}[];

const builtInProviders: RemoteProviders = [
	{
		custom: false,
		matcher: 'bitbucket.org',
		creator: (gitRemoteUrl: GitRemoteUrl) => new BitbucketRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: 'github.com',
		creator: (gitRemoteUrl: GitRemoteUrl) => new GitHubRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: 'gitlab.com',
		creator: (gitRemoteUrl: GitRemoteUrl) => new GitLabRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: /\bdev\.azure\.com$/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new AzureDevOpsRemote(gitRemoteUrl),
	},
	{
		custom: true,
		matcher: /^(.+\/(?:bitbucket|stash))\/scm\/(.+)$/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new BitbucketServerRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: /\bgitlab\b/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new GitLabRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: /\bvisualstudio\.com$/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new AzureDevOpsRemote(gitRemoteUrl, undefined, true),
	},
	{
		custom: false,
		matcher: /\bgitea\b/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new GiteaRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: /\bgerrithub\.io$/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new GerritRemote(gitRemoteUrl),
	},
	{
		custom: false,
		matcher: /\bgooglesource\.com$/i,
		creator: (gitRemoteUrl: GitRemoteUrl) => new GoogleSourceRemote(gitRemoteUrl),
	},
];

export class RemoteProviderFactory {
	static factory(
		providers: RemoteProviders,
	): (gitRemoteUrl: GitRemoteUrl) => RemoteProvider | undefined {
		return (gitRemoteUrl: GitRemoteUrl) => this.create(providers, gitRemoteUrl);
	}

	static create(providers: RemoteProviders, gitRemoteUrl: GitRemoteUrl): RemoteProvider | undefined {
		try {
			const key = gitRemoteUrl.domain.toLowerCase();
			for (const { custom, matcher, creator } of providers) {
				if (typeof matcher === 'string') {
					if (matcher === key) return creator(gitRemoteUrl);

					continue;
				}

				if (matcher.test(key)) return creator(gitRemoteUrl);
				if (!custom) continue;

				const match = matcher.exec(gitRemoteUrl.url);
				if (match != null) {
					return creator(gitRemoteUrl);
				}
			}

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'RemoteProviderFactory');
			return undefined;
		}
	}

	static loadProviders(cfg: RemotesConfig[] | null | undefined): RemoteProviders {
		const providers: RemoteProviders = [];

		if (cfg != null && cfg.length > 0) {
			for (const rc of cfg) {
				const provider = this.getCustomProvider(rc);
				if (provider == null) continue;

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
					creator: provider,
				});
			}
		}

		providers.push(...builtInProviders);

		return providers;
	}

	private static getCustomProvider(cfg: RemotesConfig) {
		switch (cfg.type) {
			case CustomRemoteType.AzureDevOps:
				return (gitRemoteUrl: GitRemoteUrl) =>
					new AzureDevOpsRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.Bitbucket:
				return (gitRemoteUrl: GitRemoteUrl) =>
					new BitbucketRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.BitbucketServer:
				return (gitRemoteUrl: GitRemoteUrl) =>
					new BitbucketServerRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.Custom:
				return (gitRemoteUrl: GitRemoteUrl) =>
					new CustomRemote(gitRemoteUrl, cfg);
			case CustomRemoteType.Gerrit:
				return (gitRemoteUrl: GitRemoteUrl) => new GerritRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.GoogleSource:
				return (gitRemoteUrl: GitRemoteUrl) =>
					new GoogleSourceRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.Gitea:
				return (gitRemoteUrl: GitRemoteUrl) => new GiteaRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.GitHub:
				return (gitRemoteUrl: GitRemoteUrl) => new GitHubRemote(gitRemoteUrl, cfg, true);
			case CustomRemoteType.GitLab:
				return (gitRemoteUrl: GitRemoteUrl) => new GitLabRemote(gitRemoteUrl, cfg, true);
			default:
				return undefined;
		}
	}
}
