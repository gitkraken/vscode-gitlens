'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

export class GitLabService extends RemoteProvider {

    constructor(
        domain: string,
        path: string,
        protocol?: string,
        name?: string,
        custom: boolean = false
    ) {
        super(domain, path, protocol, name, custom);
    }

    get name() {
        return this.formatName('GitLab');
    }

    protected getUrlForBranches(): string {
        return `${this.baseUrl}/branches`;
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/commits/${branch}`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commit/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
        let line = '';
        if (range) {
            if (range.start.line === range.end.line) {
                line = `#L${range.start.line}`;
            }
            else {
                line = `#L${range.start.line}-${range.end.line}`;
            }
        }

        if (sha) return `${this.baseUrl}/blob/${sha}/${fileName}${line}`;
        if (branch) return `${this.baseUrl}/blob/${branch}/${fileName}${line}`;
        return `${this.baseUrl}?path=${fileName}${line}`;
    }
}