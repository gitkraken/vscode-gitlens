'use strict';
import { RemoteProvider } from './provider';

export class BitbucketService extends RemoteProvider {

    constructor(public domain: string, public path: string) {
        super(domain, path);
    }

    get name() {
        return 'Bitbucket';
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/commits/branch/${branch}`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commits/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string): string {
        if (sha) return `${this.baseUrl}/src/${sha}/${fileName}`;
        if (branch) return `${this.baseUrl}/src/${branch}/${fileName}`;
        return `${this.baseUrl}?path=${fileName}`;
    }
}