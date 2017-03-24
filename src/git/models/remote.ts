'use strict';
import { RemoteProvider, RemoteProviderFactory } from '../remotes/factory';

export type GitRemoteType = 'fetch' | 'push';

export class GitRemote {

    name: string;
    url: string;
    type: GitRemoteType;

    provider?: RemoteProvider;

    constructor(remote: string) {
        remote = remote.trim();

        const [name, info] = remote.split('\t');
        this.name = name;

        const [url, typeInfo] = info.split(' ');
        this.url = url;

        this.type = typeInfo.substring(1, typeInfo.length - 1) as GitRemoteType;

        this.provider = RemoteProviderFactory.getRemoteProvider(this.url);
    }
}