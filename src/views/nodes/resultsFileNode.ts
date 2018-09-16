'use strict';
import * as path from 'path';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithCommandArgs } from '../../commands';
import { Container } from '../../container';
import { GitFile, GitUri, IStatusFormatOptions, StatusFileFormatter } from '../../git/gitService';
import { Explorer } from '../explorer';
import { ExplorerNode, ResourceType } from './explorerNode';

export class ResultsFileNode extends ExplorerNode {
    constructor(
        public readonly repoPath: string,
        private readonly _file: GitFile,
        private readonly _ref1: string,
        private readonly _ref2: string,
        parent: ExplorerNode,
        public readonly explorer: Explorer
    ) {
        super(GitUri.fromFile(_file, repoPath, _ref1 ? _ref1 : _ref2 ? _ref2 : undefined), parent);
    }

    getChildren(): ExplorerNode[] {
        return [];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.ResultsFile;
        item.tooltip = StatusFileFormatter.fromTemplate('${file}\n${directory}/\n\n${status}', this._file);

        const statusIcon = GitFile.getStatusIcon(this._file.status);
        item.iconPath = {
            dark: Container.context.asAbsolutePath(path.join('images', 'dark', statusIcon)),
            light: Container.context.asAbsolutePath(path.join('images', 'light', statusIcon))
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
            this._label = StatusFileFormatter.fromTemplate('${filePath}', this._file, {
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
                        sha: this._ref1,
                        uri: this.uri
                    },
                    rhs: {
                        sha: this._ref2,
                        uri:
                            this._file.status === 'R'
                                ? GitUri.fromFile(this._file, this.uri.repoPath!, this._ref2, true)
                                : this.uri
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
