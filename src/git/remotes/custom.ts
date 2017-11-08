'use strict';
import { Strings } from '../../system';
import { Range } from 'vscode';
import { IRemotesUrlsConfig } from '../../configuration';
import { RemoteProvider } from './provider';

export class CustomService extends RemoteProvider {

    private readonly urls: IRemotesUrlsConfig;

    constructor(
        domain: string,
        path: string,
        urls: IRemotesUrlsConfig,
        protocol?: string,
        name?: string
    ) {
        super(domain, path, protocol, name, true);
        this.urls = urls;
    }

    get name() {
        return this.formatName('Custom');
    }

    protected getUrlForRepository(): string {
        return Strings.interpolate(this.urls.repository, { repo: this.path });
    }

    protected getUrlForBranches(): string {
        return Strings.interpolate(this.urls.branches, { repo: this.path });
    }

    protected getUrlForBranch(branch: string): string {
        return Strings.interpolate(this.urls.branch, { repo: this.path, branch: branch });
    }

    protected getUrlForCommit(sha: string): string {
        return Strings.interpolate(this.urls.commit, { repo: this.path, id: sha });
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
        let line = '';
        if (range) {
            if (range.start.line === range.end.line) {
                line = Strings.interpolate(this.urls.fileLine, { line: range.start.line });
            }
            else {
                line = Strings.interpolate(this.urls.fileRange, { start: range.start.line, end: range.end.line });
            }
        }

        if (sha) return Strings.interpolate(this.urls.fileInCommit, { repo: this.path, id: sha, file: fileName, line: line });
        if (branch) return Strings.interpolate(this.urls.fileInBranch, { repo: this.path, branch: branch, file: fileName, line: line });
        return Strings.interpolate(this.urls.file, { repo: this.path, file: fileName, line: line });
    }
}