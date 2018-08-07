'use strict';
import * as path from 'path';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { Container } from '../../container';
import {
    getGitStatusIcon,
    GitLogCommit,
    GitUri,
    IGitStatusFile,
    IGitStatusFileWithCommit,
    IStatusFormatOptions,
    StatusFileFormatter
} from '../../git/gitService';
import { Strings } from '../../system';
import { Explorer } from '../explorer';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';

export class StatusFileCommitsNode extends ExplorerNode {
    constructor(
        public readonly repoPath: string,
        public readonly status: IGitStatusFile,
        public readonly commits: GitLogCommit[],
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromFileStatus(status, repoPath, 'HEAD'));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return this.commits.map(
            c =>
                new CommitFileNode(
                    this.status,
                    c,
                    this.explorer,
                    CommitFileNodeDisplayAs.CommitLabel |
                        (this.explorer.config.avatars
                            ? CommitFileNodeDisplayAs.Gravatar
                            : CommitFileNodeDisplayAs.CommitIcon)
                )
        );
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);

        if (this.commits.length === 1 && this.commit.isUncommitted) {
            item.collapsibleState = TreeItemCollapsibleState.None;
            item.contextValue = ResourceType.StatusFile;

            if (this.commit.isStagedUncommitted) {
                item.tooltip = StatusFileFormatter.fromTemplate(
                    '${status} in index\n\n${file}\n${directory}/',
                    this.status
                );
            }
            else {
                item.tooltip = StatusFileFormatter.fromTemplate(
                    '${status} in working tree\n\n${file}\n${directory}/',
                    this.status
                );
            }
            item.command = this.getCommand();
        }
        else {
            item.contextValue = ResourceType.StatusFileCommits;
            item.tooltip = StatusFileFormatter.fromTemplate(
                `\${status} in ${this.getChangedIn()}\n\n\${file}\n\${directory}/`,
                this.status
            );
        }

        const icon = getGitStatusIcon(this.status.status);
        item.iconPath = {
            dark: Container.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: Container.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        // Only cache the label for a single refresh
        this._label = undefined;

        // Capitalize the first letter of the tooltip
        item.tooltip = item.tooltip.charAt(0).toUpperCase() + item.tooltip.slice(1);

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
                    ...this.status,
                    commit: this.commit
                } as IGitStatusFileWithCommit,
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
                    changedIn.push('working tree');
                }
                else {
                    changedIn.push('index');
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
                GitUri.fromFileStatus(this.status, this.repoPath),
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
