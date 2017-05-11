'use strict';
import { RemoteProvider } from './provider';
import { BitbucketService } from './bitbucket';
import { GitHubService } from './github';
import { GitLabService } from './gitlab';
import { VisualStudioService } from './visualStudio';
import { Logger } from '../../logger';

export { RemoteProvider };

const providerMap = new Map<string, (domain: string, path: string) => RemoteProvider>([
    ['bitbucket.org', (domain: string, path: string) => new BitbucketService(domain, path)],
    ['github.com', (domain: string, path: string) => new GitHubService(domain, path)],
    ['gitlab.com', (domain: string, path: string) => new GitLabService(domain, path)],
    ['visualstudio.com', (domain: string, path: string) => new VisualStudioService(domain, path)]
]);

const UrlRegex = /^(?:git:\/\/(.*?)\/|https:\/\/(.*?)\/|http:\/\/(.*?)\/|git@(.*):\/\/|ssh:\/\/git@(.*?)\/)(.*)$/;

export class RemoteProviderFactory {

    static getRemoteProvider(url: string): RemoteProvider | undefined {
        try {
            const match = UrlRegex.exec(url);
            if (match == null) return undefined;

            const domain = match[1] || match[2] || match[3] || match[4] || match[5];
            const path = match[6].replace(/\.git/, '');

            const key = domain.toLowerCase().endsWith('visualstudio.com')
                ? 'visualstudio.com'
                : domain;

            const creator = providerMap.get(key.toLowerCase());
            if (!creator) return undefined;

            return creator(domain, path);
        }
        catch (ex) {
            Logger.error(ex, 'RemoteProviderFactory');
            return undefined;
        }
    }
}