'use strict';
import * as paths from 'path';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithCommandArgs } from '../../commands';
import { Container } from '../../container';
import { GitFile, GitUri, StatusFileFormatter } from '../../git/gitService';
import { View } from '../viewBase';
import { ResourceType, ViewNode, ViewRefFileNode } from './viewNode';

export class ResultsFileNode extends ViewRefFileNode {
    constructor(
        view: View,
        parent: ViewNode,
        repoPath: string,
        public readonly file: GitFile,
        public readonly ref1: string,
        public readonly ref2: string
    ) {
        super(GitUri.fromFile(file, repoPath, ref1 || ref2), view, parent);
    }

    get fileName(): string {
        return this.file.fileName;
    }

    get ref() {
        return this.ref1 || this.ref2;
    }

    getChildren(): ViewNode[] {
        return [];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.ResultsFile;
        item.description = this.description;
        item.tooltip = StatusFileFormatter.fromTemplate(
            // eslint-disable-next-line no-template-curly-in-string
            '${file}\n${directory}/\n\n${status}${ (originalPath)}',
            this.file
        );

        const statusIcon = GitFile.getStatusIcon(this.file.status);
        item.iconPath = {
            dark: Container.context.asAbsolutePath(paths.join('images', 'dark', statusIcon)),
            light: Container.context.asAbsolutePath(paths.join('images', 'light', statusIcon))
        };

        item.command = this.getCommand();
        return item;
    }

    private _description: string | undefined;
    get description() {
        if (this._description === undefined) {
            this._description = StatusFileFormatter.fromTemplate(
                this.view.config.commitFileDescriptionFormat,
                this.file,
                {
                    relativePath: this.relativePath
                }
            );
        }
        return this._description;
    }

    private _folderName: string | undefined;
    get folderName() {
        if (this._folderName === undefined) {
            this._folderName = paths.dirname(this.uri.relativePath);
        }
        return this._folderName;
    }

    private _label: string | undefined;
    get label() {
        if (this._label === undefined) {
            // eslint-disable-next-line no-template-curly-in-string
            this._label = StatusFileFormatter.fromTemplate('${file}', this.file, {
                relativePath: this.relativePath
            });
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
        this._description = undefined;
    }

    get priority(): number {
        return 0;
    }

    getCommand(): Command | undefined {
        const commandArgs: DiffWithCommandArgs = {
            lhs: {
                sha: this.ref1,
                uri: this.uri
            },
            rhs: {
                sha: this.ref2,
                uri:
                    this.file.status === 'R'
                        ? GitUri.fromFile(this.file, this.uri.repoPath!, this.ref2, true)
                        : this.uri
            },
            repoPath: this.uri.repoPath!,

            line: 0,
            showOptions: {
                preserveFocus: true,
                preview: true
            }
        };
        return {
            title: 'Open Changes',
            command: Commands.DiffWith,
            arguments: [this.uri, commandArgs]
        };
    }
}
