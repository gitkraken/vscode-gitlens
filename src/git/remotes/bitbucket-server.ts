'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

export class BitbucketServerService extends RemoteProvider {

    constructor(
        domain: string,
        path: string,
        name?: string,
        custom: boolean = false
    ) {
        super(domain, path, name, custom);
    }

    get name() {
        return this.formatName('Bitbucket Server');
    }

    protected get baseUrl() {
        const [project, repo] = super.splitPath();
        return `https://${this.domain}/projects/${project}/repos/${repo}`;
    }

    protected getUrlForBranches(): string {
        return `${this.baseUrl}/branches`;
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/commits?until=${branch}`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commits/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
        let line = '';
        if (range) {
            if (range.start.line === range.end.line) {
                line = `#${range.start.line}`;
            }
            else {
                line = `#${range.start.line}-${range.end.line}`;
            }
        }

        if (sha) return `${this.baseUrl}/browse/${fileName}?at=${sha}${line}`;
        if (branch) return `${this.baseUrl}/browse/${fileName}?at=${branch}${line}`;
        return `${this.baseUrl}/browse/${fileName}${line}`;
    }
}