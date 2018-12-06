'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

const issueEnricherRegex = /(^|\s)((?:#|gh-)([0-9]+))\b/gi;
const issueEnricher3rdParyRegex = /\b((\w+-?\w+(?!-)\/\w+-?\w+(?!-))#([0-9]+))\b/g;

export class GitHubRemote extends RemoteProvider {
    constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
        super(domain, path, protocol, name, custom);
    }

    get icon() {
        return 'github';
    }

    get name() {
        return this.formatName('GitHub');
    }

    enrichMessage(message: string): string {
        return (
            message
                // Matches #123 or gh-123 or GH-123
                .replace(issueEnricherRegex, `$1[$2](${this.baseUrl}/issues/$3 "Open Issue $2")`)
                // Matches eamodio/vscode-gitlens#123
                .replace(
                    issueEnricher3rdParyRegex,
                    `[$1](${this.protocol}://${this.domain}/$2/issues/$3 "Open Issue #$3 from $2")`
                )
        );
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
                line = `#L${range.start.line}-L${range.end.line}`;
            }
        }

        if (sha) return `${this.baseUrl}/blob/${sha}/${fileName}${line}`;
        if (branch) return `${this.baseUrl}/blob/${branch}/${fileName}${line}`;
        return `${this.baseUrl}?path=${fileName}${line}`;
    }
}
