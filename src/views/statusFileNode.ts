'use strict';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithCommandArgs } from '../commands';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { getGitStatusIcon, GitStatusFile, GitUri, IStatusFormatOptions, StatusFileFormatter } from '../gitService';
import * as path from 'path';

export class StatusFileNode extends ExplorerNode {

    constructor(
        readonly repoPath: string,
        private readonly status: GitStatusFile,
        private readonly ref1: string,
        private readonly ref2: string,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromFileStatus(status, repoPath));
    }

    getChildren(): ExplorerNode[] {
        return [];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.StatusFile;

        const icon = getGitStatusIcon(this.status.status);
        item.iconPath = {
            dark: this.explorer.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: this.explorer.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        item.command = this.getCommand();
        return item;
    }

    private _folderName: string | undefined;
    get folderName() {
        if (this._folderName === undefined) {
            this._folderName = path.dirname(this.uri.getRelativePath());
        }
        return this._folderName;
    }

    private _label: string | undefined;
    get label() {
        if (this._label === undefined) {
            this._label = StatusFileFormatter.fromTemplate(this.explorer.config.statusFileFormat, this.status, {
                relativePath: this.relativePath
            } as IStatusFormatOptions);
        }
        return this._label;
    }

    private _relativePath: string | undefined;
    get relativePath(): string | undefined {
        return this._relativePath;
    }
    set relativePath(value: string | undefined) {
        this._relativePath = value;
        this._label = undefined;
    }

    get priority(): boolean {
        return false;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Open Changes',
            command: Commands.DiffWith,
            arguments: [
                this.uri,
                {
                    lhs: {
                        sha: this.ref1,
                        uri: this.uri
                    },
                    rhs: {
                        sha: this.ref2,
                        uri: this.uri
                    },
                    repoPath: this.uri.repoPath!,

                    line: 0,
                    showOptions: {
                        preserveFocus: true,
                        preview: true
                    }
                } as DiffWithCommandArgs
            ]
        };
    }
}
