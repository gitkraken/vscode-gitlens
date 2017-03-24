'use strict';
import { commands, Uri } from 'vscode';
import { BuiltInCommands } from '../../constants';

export type RemoteOpenType = 'branch' | 'commit' | 'file' | 'working-file';

export abstract class RemoteProvider {

    constructor(public domain: string, public path: string) { }

    abstract get name(): string;

    protected get baseUrl() {
        return `https://${this.domain}/${this.path}`;
    }

    protected abstract getUrlForBranch(branch: string): string;
    protected abstract getUrlForCommit(sha: string): string;
    protected abstract getUrlForFile(fileName: string, branch: string, sha?: string): string;

    private async _openUrl(url: string): Promise<{}> {
        return url && commands.executeCommand(BuiltInCommands.Open, Uri.parse(url));
    }

    open(type: 'branch', branch: string): Promise<{}>;
    open(type: 'commit', sha: string): Promise<{}>;
    open(type: 'file', fileName: string, branch?: string, sha?: string): Promise<{}>;
    open(type: RemoteOpenType, ...args: string[]): Promise<{}>;
    open(type: RemoteOpenType, branchOrShaOrFileName: string, fileBranch?: string, fileSha?: string): Promise<{}> {
        switch (type) {
            case 'branch':
                return this.openBranch(branchOrShaOrFileName);
            case 'commit':
                return this.openCommit(branchOrShaOrFileName);
            case 'file':
            case 'working-file':
                return this.openFile(branchOrShaOrFileName, fileBranch, fileSha);
        }
    }

    openBranch(branch: string) {
        return this._openUrl(this.getUrlForBranch(branch));
    }

    openCommit(sha: string) {
        return this._openUrl(this.getUrlForCommit(sha));
    }

    openFile(fileName: string, branch?: string, sha?: string) {
        return this._openUrl(this.getUrlForFile(fileName, branch, sha));
    }
}