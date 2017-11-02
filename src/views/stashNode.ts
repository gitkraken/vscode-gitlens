'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { CommitFormatter, GitStashCommit, GitUri, ICommitFormatOptions } from '../gitService';
import { StashFileNode } from './stashFileNode';

export class StashNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:stash';

    constructor(
        public readonly commit: GitStashCommit,
        private readonly explorer: GitExplorer
    ) {
        super(new GitUri(commit.uri, commit));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const statuses = (this.commit as GitStashCommit).fileStatuses;

        // Check for any untracked files -- since git doesn't return them via `git stash list` :(
        const log = await this.explorer.git.getLogForRepo(this.commit.repoPath, `${(this.commit as GitStashCommit).stashName}^3`, 1);
        if (log !== undefined) {
            const commit = Iterables.first(log.commits.values());
            if (commit !== undefined && commit.fileStatuses.length !== 0) {
                // Since these files are untracked -- make them look that way
                commit.fileStatuses.forEach(s => s.status = '?');
                statuses.splice(statuses.length, 0, ...commit.fileStatuses);
            }
        }

        const children = statuses.map(s => new StashFileNode(s, this.commit.toFileCommit(s), this.explorer));
        children.sort((a, b) => a.label!.localeCompare(b.label!));
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(CommitFormatter.fromTemplate(this.explorer.config.stashFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dataFormat: this.explorer.git.config.defaultDateFormat
        } as ICommitFormatOptions), TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }
}