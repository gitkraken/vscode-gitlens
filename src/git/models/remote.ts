'use strict';
import { RemoteProvider } from '../remotes/factory';

export enum GitRemoteType {
    Fetch = 'fetch',
    Push = 'push'
}

export class GitRemote {

    constructor(
        public readonly repoPath: string,
        public readonly name: string,
        public readonly domain: string,
        public readonly path: string,
        public readonly provider: RemoteProvider | undefined,
        public readonly types: { type: GitRemoteType, url: string }[]
    ) { }
}