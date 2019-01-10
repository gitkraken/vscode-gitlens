'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

const issueEnricherRegex = /(^|\s)(#([0-9]+))\b/gi;
const stripGitRegex = /\/_git\/?/i;

const sshDomainRegex = /^ssh\./i;
const sshPathRegex = /^\/?v\d\//i;

export class AzureDevOpsRemote extends RemoteProvider {
    constructor(domain: string, path: string, protocol?: string, name?: string) {
        domain = domain.replace(sshDomainRegex, '');
        path = path.replace(sshPathRegex, '').replace(stripGitRegex, '/');

        super(domain, path, protocol, name);
    }

    get baseUrl() {
        const [orgAndProject, repo] = this.splitPath();
        return `https://${this.domain}/${orgAndProject}/_git/${repo}`;
    }

    get icon() {
        return 'vsts';
    }

    get name() {
        return 'Azure DevOps';
    }

    enrichMessage(message: string): string {
        // Strip off any `_git` part from the repo url
        const baseUrl = this.baseUrl.replace(stripGitRegex, '/');
        // Matches #123
        return message.replace(issueEnricherRegex, `$1[$2](${baseUrl}/_workitems/edit/$3 "Open Work Item $2")`);
    }

    protected getUrlForBranches(): string {
        return `${this.baseUrl}/branches`;
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/?version=GB${branch}&_a=history`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commit/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
        let line = '';
        if (range) {
            if (range.start.line === range.end.line) {
                line = `&line=${range.start.line}`;
            }
            else {
                line = `&line=${range.start.line}&lineEnd=${range.end.line}`;
            }
        }

        if (sha) return `${this.baseUrl}/commit/${sha}/?_a=contents&path=%2F${fileName}${line}`;
        if (branch) return `${this.baseUrl}/?path=%2F${fileName}&version=GB${branch}&_a=contents${line}`;
        return `${this.baseUrl}?path=%2F${fileName}${line}`;
    }

    protected splitPath(): [string, string] {
        const index = this.path.lastIndexOf('/');
        return [this.path.substring(0, index), this.path.substring(index + 1)];
    }

}
