'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFileNode } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitCommit, GitService, GitUri } from '../gitService';

export class CommitNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'commit';

    constructor(public commit: GitCommit, uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await this.git.getLogForRepo(this.commit.repoPath, this.commit.sha, 1);
        if (log === undefined) return [];

        const commit = Iterables.first(log.commits.values());
        if (commit === undefined) return [];

        return [...Iterables.map(commit.fileStatuses, s => new CommitFileNode(s, commit, this.uri, this.context, this.git))];
    }

    getTreeItem(): TreeItem {
        const label = CommitFormatter.fromTemplate(this.git.config.explorer.commitFormat, this.commit, this.git.config.defaultDateFormat);

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        item.iconPath = {
            dark: this.context.asAbsolutePath('images/dark/icon-commit.svg'),
            light: this.context.asAbsolutePath('images/light/icon-commit.svg')
        };
        return item;
    }
}