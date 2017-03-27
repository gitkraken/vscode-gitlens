'use strict';
import { RemoteProvider } from './provider';
import { GitHubService } from './github';
import { Logger } from '../../logger';

export { RemoteProvider };

const providerMap = new Map<string, (domain: string, path: string) => RemoteProvider>([
    ['github.com', (domain: string, path: string) => new GitHubService(domain, path)]
]);

const UrlRegex = /^(?:git:\/\/(.*?)\/|https:\/\/(.*?)\/|http:\/\/(.*?)\/|git@(.*):\/\/|ssh:\/\/git@(.*?)\/)(.*)$/;

export class RemoteProviderFactory {

    static getRemoteProvider(url: string): RemoteProvider {
        try {
            const match = UrlRegex.exec(url);
            const domain = match[1] || match[2] || match[3] || match[4] || match[5];
            const path = match[6].replace(/\.git/, '');

            const creator = providerMap.get(domain);
            if (!creator) return undefined;

            return creator(domain, path);
        }
        catch (ex) {
            Logger.error(ex, 'RemoteProviderFactory');
            return undefined;
        }
    }
}