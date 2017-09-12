'use strict';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitService, GitStashCommit, GitUri, ICommitFormatOptions } from '../gitService';
import { StashFileNode } from './stashFileNode';

export class StashNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:stash';

    constructor(public readonly commit: GitStashCommit, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(new GitUri(commit.uri, commit));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return Promise.resolve((this.commit as GitStashCommit).fileStatuses.map(s => new StashFileNode(s, this.commit, this.context, this.git)));
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(CommitFormatter.fromTemplate(this.git.config.gitExplorer.stashFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dataFormat: this.git.config.defaultDateFormat
        } as ICommitFormatOptions), TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }
}