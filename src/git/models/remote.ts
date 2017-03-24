'use strict';
import { HostingProvider, HostingProviderFactory } from '../hosting/factory';

export type GitRemoteType = 'fetch' | 'push';

export class GitRemote {

    name: string;
    url: string;
    type: GitRemoteType;

    provider?: HostingProvider;

    constructor(remote: string) {
        remote = remote.trim();

        const [name, info] = remote.split('\t');
        this.name = name;

        const [url, typeInfo] = info.split(' ');
        this.url = url;

        this.type = typeInfo.substring(1, typeInfo.length - 1) as GitRemoteType;

        this.provider = HostingProviderFactory.getHostingProvider(this.url);
    }
}