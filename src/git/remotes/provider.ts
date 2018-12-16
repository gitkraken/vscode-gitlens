'use strict';
import { commands, env, Range, Uri, window } from 'vscode';
import { BuiltInCommands } from '../../constants';
import { Logger } from '../../logger';
import { Messages } from '../../messages';
import { GitLogCommit } from '../models/logCommit';

export enum RemoteResourceType {
    Branch = 'branch',
    Branches = 'branches',
    Commit = 'commit',
    File = 'file',
    Repo = 'repo',
    Revision = 'revision'
}

export type RemoteResource =
    | {
          type: RemoteResourceType.Branch;
          branch: string;
      }
    | {
          type: RemoteResourceType.Branches;
      }
    | {
          type: RemoteResourceType.Commit;
          sha: string;
      }
    | {
          type: RemoteResourceType.File;
          branch?: string;
          fileName: string;
          range?: Range;
      }
    | {
          type: RemoteResourceType.Repo;
      }
    | {
          type: RemoteResourceType.Revision;
          branch?: string;
          commit?: GitLogCommit;
          fileName: string;
          range?: Range;
          sha?: string;
      };

export function getNameFromRemoteResource(resource: RemoteResource) {
    switch (resource.type) {
        case RemoteResourceType.Branch:
            return 'Branch';
        case RemoteResourceType.Branches:
            return 'Branches';
        case RemoteResourceType.Commit:
            return 'Commit';
        case RemoteResourceType.File:
            return 'File';
        case RemoteResourceType.Repo:
            return 'Repository';
        case RemoteResourceType.Revision:
            return 'Revision';
        default:
            return '';
    }
}

export abstract class RemoteProvider {
    private _name: string | undefined;

    constructor(
        public readonly domain: string,
        public readonly path: string,
        public readonly protocol: string = 'https',
        name?: string,
        public readonly custom: boolean = false
    ) {
        this._name = name;
    }

    get icon(): string {
        return 'remote';
    }

    abstract get name(): string;

    protected get baseUrl() {
        return `${this.protocol}://${this.domain}/${this.path}`;
    }

    enrichMessage(message: string): string {
        return message;
    }

    protected formatName(name: string) {
        if (this._name !== undefined) return this._name;
        return `${name}${this.custom ? ` (${this.domain})` : ''}`;
    }

    protected splitPath(): [string, string] {
        const index = this.path.indexOf('/');
        return [this.path.substring(0, index), this.path.substring(index + 1)];
    }

    protected getUrlForRepository(): string {
        return this.baseUrl;
    }
    protected abstract getUrlForBranches(): string;
    protected abstract getUrlForBranch(branch: string): string;
    protected abstract getUrlForCommit(sha: string): string;
    protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

    private async openUrl(url?: string): Promise<{} | undefined> {
        if (url === undefined) return undefined;

        return commands.executeCommand(BuiltInCommands.Open, Uri.parse(url));
    }

    async copy(resource: RemoteResource): Promise<{} | undefined> {
        const url = this.url(resource);
        if (url === undefined) return undefined;

        try {
            void (await env.clipboard.writeText(url));

            return undefined;
        }
        catch (ex) {
            if (ex.message.includes("Couldn't find the required `xsel` binary")) {
                window.showErrorMessage(
                    `Unable to copy remote url, xsel is not installed. Please install it via your package manager, e.g. \`sudo apt install xsel\``
                );
                return;
            }

            Logger.error(ex, 'CopyRemoteUrlToClipboardCommand');
            return Messages.showGenericErrorMessage('Unable to copy remote url');
        }
    }

    open(resource: RemoteResource): Promise<{} | undefined> {
        return this.openUrl(this.url(resource));
    }

    url(resource: RemoteResource): string | undefined {
        switch (resource.type) {
            case RemoteResourceType.Branch:
                return this.getUrlForBranch(resource.branch);
            case RemoteResourceType.Branches:
                return this.getUrlForBranches();
            case RemoteResourceType.Commit:
                return this.getUrlForCommit(resource.sha);
            case RemoteResourceType.File:
                return this.getUrlForFile(resource.fileName, resource.branch, undefined, resource.range);
            case RemoteResourceType.Repo:
                return this.getUrlForRepository();
            case RemoteResourceType.Revision:
                return this.getUrlForFile(resource.fileName, resource.branch, resource.sha, resource.range);
        }

        return undefined;
    }
}
