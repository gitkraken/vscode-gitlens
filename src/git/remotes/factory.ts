'use strict';
import { CustomRemoteType, RemotesConfig } from '../../configuration';
import { Logger } from '../../logger';
import { BitbucketService } from './bitbucket';
import { BitbucketServerService } from './bitbucket-server';
import { CustomService } from './custom';
import { GitHubService } from './github';
import { GitLabService } from './gitlab';
import { RemoteProvider } from './provider';
import { VisualStudioService } from './visualStudio';

export { RemoteProvider };

const defaultProviderMap = new Map<string, (domain: string, path: string) => RemoteProvider>([
    ['bitbucket.org', (domain: string, path: string) => new BitbucketService(domain, path)],
    ['github.com', (domain: string, path: string) => new GitHubService(domain, path)],
    ['gitlab.com', (domain: string, path: string) => new GitLabService(domain, path)],
    ['visualstudio.com', (domain: string, path: string) => new VisualStudioService(domain, path)]
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
                    new BitbucketService(domain, path, cfg.protocol, cfg.name, true);
            case CustomRemoteType.BitbucketServer:
                return (domain: string, path: string) =>
                    new BitbucketServerService(domain, path, cfg.protocol, cfg.name, true);
            case CustomRemoteType.Custom:
                return (domain: string, path: string) =>
                    new CustomService(domain, path, cfg.urls!, cfg.protocol, cfg.name);
            case CustomRemoteType.GitHub:
                return (domain: string, path: string) => new GitHubService(domain, path, cfg.protocol, cfg.name, true);
            case CustomRemoteType.GitLab:
                return (domain: string, path: string) => new GitLabService(domain, path, cfg.protocol, cfg.name, true);
        }
        return undefined;
    }
}
