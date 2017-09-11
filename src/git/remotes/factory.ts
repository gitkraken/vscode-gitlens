'use strict';
import { ExtensionContext, workspace } from 'vscode';
import { BitbucketService } from './bitbucket';
import { CustomRemoteType, IConfig, IRemotesConfig } from '../../configuration';
import { ExtensionKey } from '../../constants';
import { GitHubService } from './github';
import { GitLabService } from './gitlab';
import { Logger } from '../../logger';
import { RemoteProvider } from './provider';
import { VisualStudioService } from './visualStudio';
import { Objects } from '../../system';

export { RemoteProvider };

const UrlRegex = /^(?:git:\/\/(.*?)\/|https:\/\/(.*?)\/|http:\/\/(.*?)\/|git@(.*):|ssh:\/\/(?:.*@)?(.*?)(?::.*?)?\/)(.*)$/;

function getProviderKey(type: CustomRemoteType) {
    switch (type) {
        case CustomRemoteType.Bitbucket: return 'bitbucket.org';
        case CustomRemoteType.GitHub: return 'github.com';
        case CustomRemoteType.GitLab: return 'gitlab.com';
    }
    return undefined;
}

const defaultProviderMap = new Map<string, (domain: string, path: string) => RemoteProvider>([
    ['bitbucket.org', (domain: string, path: string) => new BitbucketService(domain, path)],
    ['github.com', (domain: string, path: string) => new GitHubService(domain, path)],
    ['gitlab.com', (domain: string, path: string) => new GitLabService(domain, path)],
    ['visualstudio.com', (domain: string, path: string) => new VisualStudioService(domain, path)]
]);

let providerMap: Map<string, (domain: string, path: string) => RemoteProvider>;
let remotesCfg: IRemotesConfig[];

function onConfigurationChanged() {
    const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey);
    if (cfg === undefined) return;

    if (!Objects.areEquivalent(cfg.remotes, remotesCfg)) {
        providerMap = new Map(defaultProviderMap);

        remotesCfg = cfg.remotes;
        if (remotesCfg != null && remotesCfg.length > 0) {
            for (const svc of remotesCfg) {
                const key = getProviderKey(svc.type);
                if (key === undefined) continue;

                providerMap.set(svc.domain.toLowerCase(), providerMap.get(key)!);
            }
        }
    }
}

export class RemoteProviderFactory {

    static configure(context: ExtensionContext) {
        context.subscriptions.push(workspace.onDidChangeConfiguration(onConfigurationChanged));
        onConfigurationChanged();
    }

    static getRemoteProvider(url: string): RemoteProvider | undefined {
        try {
            const match = UrlRegex.exec(url);
            if (match == null) return undefined;

            const domain = match[1] || match[2] || match[3] || match[4] || match[5];
            const path = match[6].replace(/\.git\/?$/, '');

            const key = domain.toLowerCase().endsWith('visualstudio.com')
                ? 'visualstudio.com'
                : domain;

            const creator = providerMap.get(key.toLowerCase());
            if (creator === undefined) return undefined;

            return creator(domain, path);
        }
        catch (ex) {
            Logger.error(ex, 'RemoteProviderFactory');
            return undefined;
        }
    }
}