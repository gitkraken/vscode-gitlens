'use strict';
import { Command, ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { getGitStatusIcon, GitBranch, GitLogCommit, GitService, GitUri, IGitStatusFile, IGitStatusFileWithCommit, StatusFileFormatter } from '../gitService';
import * as path from 'path';

export class StatusFileCommitsNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:status-file-commits';

    constructor(
        repoPath: string,
        public readonly status: IGitStatusFile,
        public commits: GitLogCommit[],
        protected readonly context: ExtensionContext,
        protected readonly git: GitService,
        public readonly branch?: GitBranch
    ) {
        super(new GitUri(Uri.file(path.resolve(repoPath, status.fileName)), { repoPath: repoPath, fileName: status.fileName, sha: 'HEAD' }));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return this.commits.map(c => new CommitFileNode(this.status, c, this.context, this.git, CommitFileNodeDisplayAs.Commit, this.branch));
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;

        const icon = getGitStatusIcon(this.status.status);
        item.iconPath = {
            dark: this.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: this.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        if (this.commits.length === 1 && this.commits[0].isUncommitted) {
            item.collapsibleState = TreeItemCollapsibleState.None;
            item.contextValue = 'gitlens:status-file' as ResourceType;
            item.command = this.getCommand();
        }

        // Only cache the label for a single refresh
        this._label = undefined;

        return item;
    }

    private _label: string | undefined;
    get label() {
        if (this._label === undefined) {
            this._label = StatusFileFormatter.fromTemplate(this.git.config.gitExplorer.statusFileFormat, { ...this.status, commit: this.commit } as IGitStatusFileWithCommit);
        }
        return this._label;
    }

    get commit() {
        return this.commits[0];
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [
                GitUri.fromFileStatus(this.status, this.uri.repoPath!),
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