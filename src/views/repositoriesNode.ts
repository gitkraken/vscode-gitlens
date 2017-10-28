'use strict';
import { TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository } from '../gitService';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:repositories';

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
            .map(repo => new RepositoryNode(new GitUri(Uri.file(repo.path), { repoPath: repo.path, fileName: repo.path }), repo, this.explorer));
        return this.children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repositories`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
        return item;
    }
}