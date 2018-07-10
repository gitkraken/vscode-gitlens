'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

const issueEnricherRegEx = /(^|\s)(#([0-9]+))\b/gi;
const stripGitRegex = /\/_git\/?/i;

export class VisualStudioService extends RemoteProvider {
    constructor(domain: string, path: string, protocol?: string, name?: string) {
        super(domain, path, protocol, name);
    }

    get icon() {
        return 'vsts';
    }

    get name() {
        return 'Visual Studio Team Services';
    }

    enrichMessage(message: string): string {
        // Strip off any `_git` part from the repo url
        const baseUrl = this.baseUrl.replace(stripGitRegex, '/');
        // Matches #123
        return message.replace(issueEnricherRegEx, `$1[$2](${baseUrl}/_workitems/edit/$3 "Open Work Item $2")`);
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
}
