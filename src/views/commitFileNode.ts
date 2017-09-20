'use strict';
import { Command, ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, getGitStatusIcon, GitBranch, GitCommit, GitService, GitUri, ICommitFormatOptions, IGitStatusFile, StatusFileFormatter } from '../gitService';
import * as path from 'path';

export enum CommitFileNodeDisplayAs {
    CommitLabel = 1 << 0,
    CommitIcon = 1 << 1,
    FileLabel = 1 << 2,
    StatusIcon = 1 << 3,

    Commit = CommitLabel | CommitIcon,
    File = FileLabel | StatusIcon
}

export class CommitFileNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:commit-file';

    constructor(
        public readonly status: IGitStatusFile,
        public commit: GitCommit,
        protected readonly context: ExtensionContext,
        protected readonly git: GitService,
        private displayAs: CommitFileNodeDisplayAs = CommitFileNodeDisplayAs.Commit,
        public readonly branch?: GitBranch
    ) {
        super(new GitUri(Uri.file(path.resolve(commit.repoPath, status.fileName)), { repoPath: commit.repoPath, fileName: status.fileName, sha: commit.sha }));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return [];
    }

    async getTreeItem(): Promise<TreeItem> {
        if (this.commit.type !== 'file') {
            const log = await this.git.getLogForFile(this.commit.repoPath, this.status.fileName, this.commit.sha, { maxCount: 2 });
            if (log !== undefined) {
                this.commit = log.commits.get(this.commit.sha) || this.commit;
            }
        }

        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;

        const icon = (this.displayAs & CommitFileNodeDisplayAs.CommitIcon)
            ? 'icon-commit.svg'
            : getGitStatusIcon(this.status.status);

        item.iconPath = {
            dark: this.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: this.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        item.command = this.getCommand();

        // Only cache the label for a single refresh
        this._label = undefined;

        return item;
    }

    private _label: string | undefined;
    get label() {
        if (this._label === undefined) {
            this._label = (this.displayAs & CommitFileNodeDisplayAs.CommitLabel)
                ? CommitFormatter.fromTemplate(this.getCommitTemplate(), this.commit, {
                    truncateMessageAtNewLine: true,
                    dataFormat: this.git.config.defaultDateFormat
                } as ICommitFormatOptions)
                : StatusFileFormatter.fromTemplate(this.getCommitFileTemplate(), this.status);
        }
        return this._label;
    }

    protected getCommitTemplate() {
        return this.git.config.gitExplorer.commitFormat;
    }

    protected getCommitFileTemplate() {
        return this.git.config.gitExplorer.commitFileFormat;
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