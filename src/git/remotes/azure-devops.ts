'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';

const issueEnricherRegex = /(^|\s)(#([0-9]+))\b/gi;

const gitRegex = /\/_git\/?/i;
const legacyDefaultCollectionRegex = /^DefaultCollection\//i;
const orgAndProjectRegex = /^(.*?)\/(.*?)\/(.*)/;
const sshDomainRegex = /^(ssh|vs-ssh)\./i;
const sshPathRegex = /^\/?v\d\//i;

export class AzureDevOpsRemote extends RemoteProvider {
    constructor(domain: string, path: string, protocol?: string, name?: string, legacy: boolean = false) {
        if (sshDomainRegex.test(domain)) {
            path = path.replace(sshPathRegex, '');
            domain = domain.replace(sshDomainRegex, '');

            // Add in /_git/ into ssh urls
            const match = orgAndProjectRegex.exec(path);
            if (match != null) {
                const [, org, project, rest] = match;

                // Handle legacy vsts urls
                if (legacy) {
                    domain = `${org}.${domain}`;
                    path = `${project}/_git/${rest}`;
                }
                else {
                    path = `${org}/${project}/_git/${rest}`;
                }
            }
        }

        super(domain, path, protocol, name);
    }

    get icon() {
        return 'vsts';
    }

    get name() {
        return 'Azure DevOps';
    }

    private _displayPath: string | undefined;
    get displayPath(): string {
        if (this._displayPath === undefined) {
            this._displayPath = this.path.replace(gitRegex, '/').replace(legacyDefaultCollectionRegex, '');
        }
        return this._displayPath;
    }

    enrichMessage(message: string): string {
        // Strip off any `_git` part from the repo url
        const baseUrl = this.baseUrl.replace(gitRegex, '/');
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
        let line;
        if (range) {
            if (range.start.line === range.end.line) {
                line = `&line=${range.start.line}`;
            }
            else {
                line = `&line=${range.start.line}&lineEnd=${range.end.line}`;
            }
        }
        else {
            line = '';
        }

        if (sha) return `${this.baseUrl}/commit/${sha}/?_a=contents&path=%2F${fileName}${line}`;
        if (branch) return `${this.baseUrl}/?path=%2F${fileName}&version=GB${branch}&_a=contents${line}`;
        return `${this.baseUrl}?path=%2F${fileName}${line}`;
    }
}
