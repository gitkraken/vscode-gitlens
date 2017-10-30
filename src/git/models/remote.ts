'use strict';
import { RemoteProvider, RemoteProviderFactory } from '../remotes/factory';

export enum GitRemoteType {
    Fetch = 'fetch',
    Push = 'push'
}

export class GitRemote {

    provider?: RemoteProvider;

    constructor(
        public readonly repoPath: string,
        public readonly name: string,
        public readonly domain: string,
        public readonly path: string,
        public readonly types: { type: GitRemoteType, url: string }[]
    ) {
        this.provider = RemoteProviderFactory.getRemoteProvider(this.domain, this.path);
    }
}