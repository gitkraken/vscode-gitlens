'use strict';
import { Range } from 'vscode';
import { GitHubService } from './github';

export class GitLabService extends GitHubService {

    constructor(public domain: string, public path: string, public custom: boolean = false) {
        super(domain, path);
    }

    get name() {
        return this.formatName('GitLab');
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