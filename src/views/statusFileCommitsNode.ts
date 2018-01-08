'use strict';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { Container } from '../container';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { getGitStatusIcon, GitLogCommit, GitUri, IGitStatusFile, IGitStatusFileWithCommit, IStatusFormatOptions, StatusFileFormatter } from '../gitService';
import * as path from 'path';

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
        return this.commits.map(c => new CommitFileNode(this.status, c, this.explorer, CommitFileNodeDisplayAs.CommitLabel | (this.explorer.config.gravatars ? CommitFileNodeDisplayAs.Gravatar : CommitFileNodeDisplayAs.CommitIcon)));
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.StatusFileCommits;

        const icon = getGitStatusIcon(this.status.status);
        item.iconPath = {
            dark: Container.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: Container.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        if (this.commits.length === 1 && this.commits[0].isUncommitted) {
            item.collapsibleState = TreeItemCollapsibleState.None;
            item.contextValue = ResourceType.StatusFile;
            item.command = this.getCommand();
        }

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