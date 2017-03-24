'use strict';
import { HostingProvider } from './hostingProvider';

export class GitHubService extends HostingProvider {

    constructor(public domain: string, public path: string) {
        super(domain, path);
    }

    get name() {
        return 'GitHub';
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/tree/${branch}`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commit/${sha}`;
    }

    protected getUrlForFile(fileName: string, sha?: string): string {
        if (sha) return `${this.baseUrl}/blob/${sha}/${fileName}`;
        return `${this.baseUrl}?path=${fileName}`;
    }
}