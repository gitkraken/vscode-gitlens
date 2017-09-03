'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

export class BitbucketService extends RemoteProvider {

    constructor(public domain: string, public path: string) {
        super(domain, path);
    }

    get name() {
        return 'Bitbucket';
    }

    protected getUrlForBranches(): string {
        return `${this.baseUrl}/branches`;
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/commits/branch/${branch}`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commits/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
        let line = '';
        if (range) {
            if (range.start.line === range.end.line) {
                line = `#${fileName}-${range.start.line}`;
            }
            else {
                line = `#${fileName}-${range.start.line}:${range.end.line}`;
            }
        }

        if (sha) return `${this.baseUrl}/src/${sha}/${fileName}${line}`;
        if (branch) return `${this.baseUrl}/src/${branch}/${fileName}${line}`;
        return `${this.baseUrl}?path=${fileName}${line}`;
    }
}