'use strict';
import { CustomRemoteType, RemotesConfig } from '../../configuration';
import { Logger } from '../../logger';
import { AzureDevOpsRemote } from './azure-devops';
import { BitbucketRemote } from './bitbucket';
import { BitbucketServerRemote } from './bitbucket-server';
import { CustomRemote } from './custom';
import { GitHubRemote } from './github';
import { GitLabRemote } from './gitlab';
import { RemoteProvider } from './provider';

export { RemoteProvider };

const defaultProviderMap = new Map<string, (domain: string, path: string) => RemoteProvider>([
    ['bitbucket.org', (domain: string, path: string) => new BitbucketRemote(domain, path)],
    ['github.com', (domain: string, path: string) => new GitHubRemote(domain, path)],
    ['gitlab.com', (domain: string, path: string) => new GitLabRemote(domain, path)],
    ['visualstudio.com', (domain: string, path: string) => new AzureDevOpsRemote(domain, path)],
    ['dev.azure.com', (domain: string, path: string) => new AzureDevOpsRemote(domain, path)]
]);

export type RemoteProviderMap = Map<string, (domain: string, path: string) => RemoteProvider>;

export class RemoteProviderFactory {
    static factory(providerMap: RemoteProviderMap): (domain: string, path: string) => RemoteProvider | undefined {
        return (domain: string, path: string) => this.create(providerMap, domain, path);
    }

    static create(providerMap: RemoteProviderMap, domain: string, path: string): RemoteProvider | undefined {
        try {
            let key = domain.toLowerCase();
            if (key.endsWith('visualstudio.com')) {
                key = 'visualstudio.com';
            }

            const creator = providerMap.get(key);
            if (creator === undefined) return undefined;

            return creator(domain, path);
        }
        catch (ex) {
            Logger.error(ex, 'RemoteProviderFactory');
            return undefined;
        }
    }

    static createMap(cfg: RemotesConfig[] | null | undefined): RemoteProviderMap {
        const providerMap = new Map(defaultProviderMap);
        if (cfg != null && cfg.length > 0) {
            for (const rc of cfg) {
                const provider = this.getCustomProvider(rc);
                if (provider === undefined) continue;

                providerMap.set(rc.domain.toLowerCase(), provider);
            }
        }
        return providerMap;
    }

    private static getCustomProvider(cfg: RemotesConfig) {
        switch (cfg.type) {
            case CustomRemoteType.Bitbucket:
                return (domain: string, path: string) =>
                    new BitbucketRemote(domain, path, cfg.protocol, cfg.name, true);
            case CustomRemoteType.BitbucketServer:
                return (domain: string, path: string) =>
                    new BitbucketServerRemote(domain, path, cfg.protocol, cfg.name, true);
            case CustomRemoteType.Custom:
                return (domain: string, path: string) =>
                    new CustomRemote(domain, path, cfg.urls!, cfg.protocol, cfg.name);
            case CustomRemoteType.GitHub:
                return (domain: string, path: string) => new GitHubRemote(domain, path, cfg.protocol, cfg.name, true);
            case CustomRemoteType.GitLab:
                return (domain: string, path: string) => new GitLabRemote(domain, path, cfg.protocol, cfg.name, true);
        }
        return undefined;
    }
}
