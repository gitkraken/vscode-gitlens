'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

export class GitHubService extends RemoteProvider {

    constructor(public domain: string, public path: string) {
        super(domain, path);
    }

    get name() {
        return 'GitHub';
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/commits/${branch}`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commit/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
        let line: string = '';
        if (range) {
            if (range.start.line === range.end.line) {
                line = `#L${range.start.line}`;
            }
            else {
                line = `#L${range.start.line}-L${range.end.line}`;
            }
        }

        if (sha) return `${this.baseUrl}/blob/${sha}/${fileName}${line}`;
        if (branch) return `${this.baseUrl}/blob/${branch}/${fileName}${line}`;
        return `${this.baseUrl}?path=${fileName}${line}`;
    }
}