'use strict';
import { Objects } from '../../system';
import { Event, EventEmitter, ExtensionContext, workspace } from 'vscode';
import { BitbucketService } from './bitbucket';
import { BitbucketServerService } from './bitbucket-server';
import { CustomRemoteType, IConfig, IRemotesConfig } from '../../configuration';
import { ExtensionKey } from '../../constants';
import { CustomService } from './custom';
import { GitHubService } from './github';
import { GitLabService } from './gitlab';
import { Logger } from '../../logger';
import { RemoteProvider } from './provider';
import { VisualStudioService } from './visualStudio';

export { RemoteProvider };

const defaultProviderMap = new Map<string, (domain: string, path: string) => RemoteProvider>([
    ['bitbucket.org', (domain: string, path: string) => new BitbucketService(domain, path)],
    ['github.com', (domain: string, path: string) => new GitHubService(domain, path)],
    ['gitlab.com', (domain: string, path: string) => new GitLabService(domain, path)],
    ['visualstudio.com', (domain: string, path: string) => new VisualStudioService(domain, path)]
]);

export class RemoteProviderFactory {

    private static _providerMap: Map<string, (domain: string, path: string) => RemoteProvider>;
    private static _remotesCfg: IRemotesConfig[];

    private static _onDidChange = new EventEmitter<void>();
    public static get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }

    static configure(context: ExtensionContext) {
        context.subscriptions.push(workspace.onDidChangeConfiguration(() => this.onConfigurationChanged()));
        this.onConfigurationChanged(true);
    }

    static getRemoteProvider(domain: string, path: string): RemoteProvider | undefined {
        try {
            let key = domain.toLowerCase();
            if (key.endsWith('visualstudio.com')) {
                key = 'visualstudio.com';
            }

            const creator = this._providerMap.get(key);
            if (creator === undefined) return undefined;

            return creator(domain, path);
        }
        catch (ex) {
            Logger.error(ex, 'RemoteProviderFactory');
            return undefined;
        }
    }

    private static onConfigurationChanged(silent: boolean = false) {
        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey);
        if (cfg === undefined) return;

        if (!Objects.areEquivalent(cfg.remotes, this._remotesCfg)) {
            this._providerMap = new Map(defaultProviderMap);

            this._remotesCfg = cfg.remotes;
            if (this._remotesCfg != null && this._remotesCfg.length > 0) {
                for (const remoteCfg of this._remotesCfg) {
                    const provider = this.getCustomProvider(remoteCfg);
                    if (provider === undefined) continue;

                    this._providerMap.set(remoteCfg.domain.toLowerCase(), provider);
                }

                if (!silent) {
                    this._onDidChange.fire();
                }
            }
        }
    }

    private static getCustomProvider(cfg: IRemotesConfig) {
        switch (cfg.type) {
            case CustomRemoteType.Bitbucket: return (domain: string, path: string) => new BitbucketService(domain, path, cfg.name, true);
            case CustomRemoteType.BitbucketServer: return (domain: string, path: string) => new BitbucketServerService(domain, path, cfg.name, true);
            case CustomRemoteType.Custom: return (domain: string, path: string) => new CustomService(domain, path, cfg);
            case CustomRemoteType.GitHub: return (domain: string, path: string) => new GitHubService(domain, path, cfg.name, true);
            case CustomRemoteType.GitLab: return (domain: string, path: string) => new GitLabService(domain, path, cfg.name, true);
        }
        return undefined;
    }
}