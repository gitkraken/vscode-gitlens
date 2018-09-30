'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

const issueEnricherRegEx = /(^|\s)(issue #([0-9]+))\b/gi;
const prEnricherRegEx = /(^|\s)(pull request #([0-9]+))\b/gi;

export class BitbucketServerRemote extends RemoteProvider {
    constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
        super(domain, path, protocol, name, custom);
    }

    protected get baseUrl() {
        const [project, repo] = this.splitPath();
        return `https://${this.domain}/projects/${project}/repos/${repo}`;
    }

    get icon() {
        return 'bitbucket';
    }

    get name() {
        return this.formatName('Bitbucket Server');
    }

    enrichMessage(message: string): string {
        return (
            message
                // Matches issue #123
                .replace(issueEnricherRegEx, `$1[$2](${this.baseUrl}/issues/$3 "Open Issue $2")`)
                // Matches pull request #123
                .replace(prEnricherRegEx, `$1[$2](${this.baseUrl}/pull-requests/$3 "Open PR $2")`)
        );
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
