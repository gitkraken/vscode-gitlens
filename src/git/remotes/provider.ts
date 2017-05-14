'use strict';
import { commands, Range, Uri } from 'vscode';
import { BuiltInCommands } from '../../constants';
import { GitLogCommit } from '../../gitService';

export type RemoteResourceType = 'branch' | 'commit' | 'file' | 'working-file';
export type RemoteResource = { type: 'branch', branch: string } |
    { type: 'commit', sha: string } |
    { type: 'file', branch?: string, commit?: GitLogCommit, fileName: string, range?: Range, sha?: string } |
    { type: 'working-file', branch?: string, fileName: string, range?: Range };

export function getNameFromRemoteResource(resource: RemoteResource) {
    switch (resource.type) {
        case 'branch': return 'Branch';
        case 'commit': return 'Commit';
        case 'file': return 'File';
        case 'working-file': return 'Working File';
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

    open(resource: RemoteResource): Promise<{}> {
        switch (resource.type) {
            case 'branch':
                return this.openBranch(resource.branch);
            case 'commit':
                return this.openCommit(resource.sha);
            case 'file':
                return this.openFile(resource.fileName, resource.branch, resource.sha, resource.range);
            case 'working-file':
                return this.openFile(resource.fileName, resource.branch, undefined, resource.range);
        }
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