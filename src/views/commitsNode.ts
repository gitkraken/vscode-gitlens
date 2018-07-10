'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { Explorer, ExplorerNode, ResourceType, ShowAllNode } from './explorerNode';
import { GitLog, GitUri } from '../gitService';

export class CommitsNode extends ExplorerNode {
    readonly supportsPaging: boolean = true;

    constructor(
        public readonly repoPath: string,
        private readonly logFn: (maxCount: number | undefined) => Promise<GitLog | undefined>,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await this.logFn(this.maxCount);
        if (log === undefined) return [];

        const children: (CommitNode | ShowAllNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))
        ];

        if (log.truncated) {
            children.push(new ShowAllNode('Show All Commits', this, this.explorer));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem('Commits', TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Commits;
        return item;
    }
}
