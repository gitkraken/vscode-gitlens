'use strict';
import { HostingProvider } from './hostingProvider';
import { GitHubService } from './github';
import { Logger } from '../../logger';

export { HostingProvider };

const serviceMap = new Map<string, (domain: string, path: string) => HostingProvider>([
    ['github.com', (domain: string, path: string) => new GitHubService(domain, path)]
]);

const UrlRegex = /^(?:git:\/\/(.*?)\/|https:\/\/(.*?)\/|http:\/\/(.*?)\/|git@(.*):\/\/|ssh:\/\/git@(.*?)\/)(.*)$/;

export class HostingProviderFactory {

    static getHostingProvider(url: string): HostingProvider {
        try {
            const match = UrlRegex.exec(url);
            const domain = match[1] || match[2] || match[3] || match[4] || match[5];
            const path = match[6].replace(/\.git/, '');

            const serviceCreator = serviceMap.get(domain);
            if (!serviceCreator) return undefined;

            return serviceCreator(domain, path);
        }
        catch (ex) {
            Logger.error(ex);
            return undefined;
        }
    }
}