'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri, Repository } from '../../git/gitService';
import { GitExplorer } from '../gitExplorer';
import { ActiveRepositoryNode } from './activeRepositoryNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends ExplorerNode {
    constructor(
        private readonly repositories: Repository[],
        private readonly explorer: GitExplorer
    ) {
        super(undefined!);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this.children === undefined) {
            this.children = this.repositories
                .sort((a, b) => a.index - b.index)
                .filter(repo => !repo.closed)
                .map(repo => new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this.explorer));

            if (this.children.length > 1) {
                this.children.splice(0, 0, new ActiveRepositoryNode(this.explorer));
            }
        }

        return this.children;
    }

    refresh() {
        this.resetChildren();
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repositories`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Repositories;
        return item;
    }
}
