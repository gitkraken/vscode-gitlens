'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ActiveRepositoryNode } from './activeRepositoryNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository } from '../gitService';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends ExplorerNode {

    constructor(
        private readonly repositories: Repository[],
        private readonly explorer: GitExplorer
    ) {
        super(undefined!);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        this.children = this.repositories
            .sort((a, b) => a.index - b.index)
            .map(repo => new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this.explorer));

        if (this.children.length > 1) {
            this.children.splice(0, 0, new ActiveRepositoryNode(this.explorer));
        }

        return this.children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repositories`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Repositories;
        return item;
    }
}