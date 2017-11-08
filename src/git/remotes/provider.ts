'use strict';
import { commands, Range, Uri } from 'vscode';
import { BuiltInCommands } from '../../constants';
import { GitLogCommit } from '../../gitService';

export enum RemoteResourceType {
    Branch = 'branch',
    Branches = 'branches',
    Commit = 'commit',
    File = 'file',
    Repo = 'repo',
    Revision = 'revision'
}

export type RemoteResource =
    { type: RemoteResourceType.Branch, branch: string } |
    { type: RemoteResourceType.Branches } |
    { type: RemoteResourceType.Commit, sha: string } |
    { type: RemoteResourceType.File, branch?: string, fileName: string, range?: Range } |
    { type: RemoteResourceType.Repo } |
    { type: RemoteResourceType.Revision, branch?: string, commit?: GitLogCommit, fileName: string, range?: Range, sha?: string };

export function getNameFromRemoteResource(resource: RemoteResource) {
    switch (resource.type) {
        case RemoteResourceType.Branch: return 'Branch';
        case RemoteResourceType.Branches: return 'Branches';
        case RemoteResourceType.Commit: return 'Commit';
        case RemoteResourceType.File: return 'File';
        case RemoteResourceType.Repo: return 'Repository';
        case RemoteResourceType.Revision: return 'Revision';
        default: return '';
    }
}

export abstract class RemoteProvider {

    private _name: string | undefined;

    constructor(
        public readonly domain: string,
        public readonly path: string,
        name?: string,
        public readonly protocol: string = 'https'
        public readonly custom: boolean = false
    ) {
        this._name = name;
    }

    abstract get name(): string;

    protected get baseUrl() {
      return `${this.protocol}://${this.domain}/${this.path}`;
    }

    protected formatName(name: string) {
        if (this._name !== undefined) return this._name;
        return `${name}${this.custom ? ` (${this.domain})` : ''}`;
    }

    protected splitPath(): [string, string] {
        const index = this.path.indexOf('/');
        return [ this.path.substring(0, index), this.path.substring(index + 1) ];
    }

    protected getUrlForRepository(): string {
        return this.baseUrl;
    }
    protected abstract getUrlForBranches(): string;
    protected abstract getUrlForBranch(branch: string): string;
    protected abstract getUrlForCommit(sha: string): string;
    protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

    private async openUrl(url: string): Promise<{} | undefined> {
        if (url === undefined) return undefined;

        return commands.executeCommand(BuiltInCommands.Open, Uri.parse(url));
    }

    open(resource: RemoteResource): Promise<{} | undefined> {
        switch (resource.type) {
            case RemoteResourceType.Branch: return this.openBranch(resource.branch);
            case RemoteResourceType.Branches: return this.openBranches();
            case RemoteResourceType.Commit: return this.openCommit(resource.sha);
            case RemoteResourceType.File: return this.openFile(resource.fileName, resource.branch, undefined, resource.range);
            case RemoteResourceType.Repo: return this.openRepo();
            case RemoteResourceType.Revision: return this.openFile(resource.fileName, resource.branch, resource.sha, resource.range);
        }
    }

    openRepo() {
        return this.openUrl(this.getUrlForRepository());
    }

    openBranches() {
        return this.openUrl(this.getUrlForBranches());
    }

    openBranch(branch: string) {
        return this.openUrl(this.getUrlForBranch(branch));
    }

    openCommit(sha: string) {
        return this.openUrl(this.getUrlForCommit(sha));
    }

    openFile(fileName: string, branch?: string, sha?: string, range?: Range) {
        return this.openUrl(this.getUrlForFile(fileName, branch, sha, range));
    }
}
