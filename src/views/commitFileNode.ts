'use strict';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { GravatarDefault } from '../configuration';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, getGitStatusIcon, GitBranch, GitLogCommit, GitUri, ICommitFormatOptions, IGitStatusFile, IStatusFormatOptions, StatusFileFormatter } from '../gitService';
import * as path from 'path';

export enum CommitFileNodeDisplayAs {
    CommitLabel = 1 << 0,
    FileLabel = 1 << 1,

    CommitIcon = 1 << 2,
    StatusIcon = 1 << 3,
    Gravatar = 1 << 4,

    File = FileLabel | StatusIcon
}

export class CommitFileNode extends ExplorerNode {

    readonly priority: boolean = false;
    readonly repoPath: string;

    constructor(
        public readonly status: IGitStatusFile,
        public commit: GitLogCommit,
        protected readonly explorer: Explorer,
        private displayAs: CommitFileNodeDisplayAs,
        public readonly branch?: GitBranch
    ) {
        super(GitUri.fromFileStatus(status, commit.repoPath, commit.sha));
        this.repoPath = commit.repoPath;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return [];
    }

    async getTreeItem(): Promise<TreeItem> {
        if (!this.commit.isFile) {
            // See if we can get the commit directly from the multi-file commit
            const commit = this.commit.toFileCommit(this.status);
            if (commit === undefined) {
                const log = await this.explorer.git.getLogForFile(this.repoPath, this.status.fileName, { maxCount: 2, ref: this.commit.sha });
                if (log !== undefined) {
                    this.commit = log.commits.get(this.commit.sha) || this.commit;
                }
            }
            else {
                this.commit = commit;
            }
        }

        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;

        if ((this.displayAs & CommitFileNodeDisplayAs.CommitIcon) === CommitFileNodeDisplayAs.CommitIcon) {
            item.iconPath = {
                dark: this.explorer.context.asAbsolutePath(path.join('images', 'dark', 'icon-commit.svg')),
                light: this.explorer.context.asAbsolutePath(path.join('images', 'light', 'icon-commit.svg'))
            };
        }
        else if ((this.displayAs & CommitFileNodeDisplayAs.StatusIcon) === CommitFileNodeDisplayAs.StatusIcon) {
            const icon = getGitStatusIcon(this.status.status);
            item.iconPath = {
                dark: this.explorer.context.asAbsolutePath(path.join('images', 'dark', icon)),
                light: this.explorer.context.asAbsolutePath(path.join('images', 'light', icon))
            };
        }
        else if ((this.displayAs & CommitFileNodeDisplayAs.Gravatar) === CommitFileNodeDisplayAs.Gravatar) {
            item.iconPath = this.commit.getGravatarUri(this.explorer.config.gravatarsDefault || GravatarDefault.Robot);
        }

        item.command = this.getCommand();

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
            this._label = (this.displayAs & CommitFileNodeDisplayAs.CommitLabel)
                ? CommitFormatter.fromTemplate(
                    this.getCommitTemplate(),
                    this.commit,
                    {
                        truncateMessageAtNewLine: true,
                        dataFormat: this.explorer.git.config.defaultDateFormat
                    } as ICommitFormatOptions
                )
                : StatusFileFormatter.fromTemplate(
                    this.getCommitFileTemplate(),
                    this.status,
                    {
                        relativePath: this.relativePath
                    } as IStatusFormatOptions
                );
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

    protected get resourceType(): ResourceType {
        return ResourceType.CommitFile;
    }

    protected getCommitTemplate() {
        return this.explorer.config.commitFormat;
    }

    protected getCommitFileTemplate() {
        return this.explorer.config.commitFileFormat;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [
                GitUri.fromFileStatus(this.status, this.commit.repoPath),
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