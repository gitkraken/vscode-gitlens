'use strict';
import * as path from 'path';
import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import {
    GitFile,
    GitFileWithCommit,
    GitLogCommit,
    GitUri,
    IStatusFormatOptions,
    StatusFileFormatter
} from '../../git/gitService';
import { Strings } from '../../system';
import { Explorer } from '../explorer';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';

export class StatusFileNode extends ExplorerNode {
    constructor(
        public readonly repoPath: string,
        public readonly file: GitFile,
        public readonly commits: GitLogCommit[],
        parent: ExplorerNode,
        public readonly explorer: Explorer
    ) {
        super(GitUri.fromFile(file, repoPath, 'HEAD'), parent);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return this.commits.map(
            c =>
                new CommitFileNode(
                    this.file,
                    c,
                    this,
                    this.explorer,
                    CommitFileNodeDisplayAs.CommitLabel |
                        (this.explorer.config.avatars
                            ? CommitFileNodeDisplayAs.Gravatar
                            : CommitFileNodeDisplayAs.CommitIcon)
                )
        );
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);

        if (this.commits.length === 1 && this.commit.isUncommitted) {
            item.contextValue = ResourceType.StatusFile;

            if (this.commit.isStagedUncommitted) {
                item.tooltip = StatusFileFormatter.fromTemplate(
                    '${file}\n${directory}/\n\n${status} in Index (staged)',
                    this.file
                );
            }
            else {
                item.tooltip = StatusFileFormatter.fromTemplate(
                    '${file}\n${directory}/\n\n${status} in Working Tree',
                    this.file
                );
            }
            item.command = this.getCommand();
        }
        else {
            item.collapsibleState = TreeItemCollapsibleState.Collapsed;
            item.contextValue = ResourceType.StatusFileCommits;
            item.tooltip = StatusFileFormatter.fromTemplate(
                `\${file}\n\${directory}/\n\n\${status} in ${this.getChangedIn()}`,
                this.file
            );
        }

        // Use the file icon and decorations
        item.resourceUri = Uri.file(path.resolve(this.repoPath, this.file.fileName));
        item.iconPath = ThemeIcon.File;

        // Only cache the label for a single refresh
        this._label = undefined;

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
            this._label = StatusFileFormatter.fromTemplate(
                this.explorer.config.statusFileFormat,
                {
                    ...this.file,
                    commit: this.commit
                } as GitFileWithCommit,
                {
                    relativePath: this.relativePath
                } as IStatusFormatOptions
            );
        }
        return this._label;
    }

    get commit() {
        return this.commits[0];
    }

    get priority(): boolean {
        return this.commit.isUncommitted;
    }

    private _relativePath: string | undefined;
    get relativePath(): string | undefined {
        return this._relativePath;
    }
    set relativePath(value: string | undefined) {
        this._relativePath = value;
        this._label = undefined;
    }

    private getChangedIn(): string {
        const changedIn = [];
        let commits = 0;
        for (const c of this.commits) {
            if (c.isUncommitted) {
                if (c.isStagedUncommitted) {
                    changedIn.push('Index (staged)');
                }
                else {
                    changedIn.push('Working Tree');
                }

                continue;
            }

            commits++;
        }

        if (commits > 0) {
            changedIn.push(Strings.pluralize('commit', commits));
        }

        if (changedIn.length > 2) {
            changedIn[changedIn.length - 1] = `and ${changedIn[changedIn.length - 1]}`;
        }
        return changedIn.join(changedIn.length > 2 ? ', ' : ' and ');
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [
                GitUri.fromFile(this.file, this.repoPath),
                {
                    commit: this.commit,
                    line: 0,
                    showOptions: {
                        preserveFocus: true,
                        preview: true
                    }
                } as DiffWithPreviousCommandArgs
            ]
        };
    }
}
