'use strict';
import { commands, Uri } from 'vscode';
import { BuiltInCommands } from '../../constants';

export type HostingProviderOpenType = 'branch' | 'commit' | 'file';

export abstract class HostingProvider {

    constructor(public domain: string, public path: string) { }

    abstract get name(): string;

    protected get baseUrl() {
        return `https://${this.domain}/${this.path}`;
    }

    protected abstract getUrlForBranch(branch: string): string;
    protected abstract getUrlForCommit(sha: string): string;
    protected abstract getUrlForFile(fileName: string, sha?: string): string;

    private async _openUrl(url: string): Promise<{}> {
        return url && commands.executeCommand(BuiltInCommands.Open, Uri.parse(url));
    }

    open(type: 'branch', branch: string): Promise<{}>;
    open(type: 'commit', sha: string): Promise<{}>;
    open(type: 'file', fileName: string, sha?: string): Promise<{}>;
    open(type: HostingProviderOpenType, ...args: string[]): Promise<{}>;
    open(type: HostingProviderOpenType, branchOrShaOrFileName: string, sha?: string): Promise<{}> {
        switch (type) {
            case 'branch': return this.openBranch(branchOrShaOrFileName);
            case 'commit': return this.openCommit(branchOrShaOrFileName);
            case 'file': return this.openFile(branchOrShaOrFileName, sha);
        }
    }

    openBranch(branch: string) {
        return this._openUrl(this.getUrlForBranch(branch));
    }

    openCommit(sha: string) {
        return this._openUrl(this.getUrlForCommit(sha));
    }

    openFile(fileName: string, sha?: string) {
        return this._openUrl(this.getUrlForFile(fileName, sha));
    }
}