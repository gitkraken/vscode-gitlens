'use strict';
import { commands, Range, Uri } from 'vscode';
import { BuiltInCommands } from '../../constants';
import { GitLogCommit } from '../../gitService';

export type RemoteResourceType = 'branch' | 'commit' | 'file' | 'repo' | 'revision';
export type RemoteResource =
    { type: 'branch', branch: string } |
    { type: 'commit', sha: string } |
    { type: 'file', branch?: string, fileName: string, range?: Range } |
    { type: 'repo' } |
    { type: 'revision', branch?: string, commit?: GitLogCommit, fileName: string, range?: Range, sha?: string };

export function getNameFromRemoteResource(resource: RemoteResource) {
    switch (resource.type) {
        case 'branch': return 'Branch';
        case 'commit': return 'Commit';
        case 'file': return 'File';
        case 'repo': return 'Repository';
        case 'revision': return 'Revision';
        default: return '';
    }
}

export abstract class RemoteProvider {

    constructor(public domain: string, public path: string) { }

    abstract get name(): string;

    protected get baseUrl() {
        return `https://${this.domain}/${this.path}`;
    }

    protected abstract getUrlForBranch(branch: string): string;
    protected abstract getUrlForCommit(sha: string): string;
    protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

    private async _openUrl(url: string): Promise<{} | undefined> {
        if (url === undefined) return undefined;

        return commands.executeCommand(BuiltInCommands.Open, Uri.parse(url));
    }

    open(resource: RemoteResource): Promise<{} | undefined> {
        switch (resource.type) {
            case 'branch': return this.openBranch(resource.branch);
            case 'commit': return this.openCommit(resource.sha);
            case 'file': return this.openFile(resource.fileName, resource.branch, undefined, resource.range);
            case 'repo': return this.openRepo();
            case 'revision': return this.openFile(resource.fileName, resource.branch, resource.sha, resource.range);
        }
    }

    openRepo() {
        return this._openUrl(this.baseUrl);
    }

    openBranch(branch: string) {
        return this._openUrl(this.getUrlForBranch(branch));
    }

    openCommit(sha: string) {
        return this._openUrl(this.getUrlForCommit(sha));
    }

    openFile(fileName: string, branch?: string, sha?: string, range?: Range) {
        return this._openUrl(this.getUrlForFile(fileName, branch, sha, range));
    }
}