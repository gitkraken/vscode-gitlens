'use strict';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri, Repository } from '../gitService';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:repositories';

    constructor(
        private readonly repositories: Repository[],
        protected readonly context: ExtensionContext,
        protected readonly git: GitService
    ) {
        super(undefined!);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return this.repositories
            .sort((a, b) => a.index - b.index)
            .map(repo => new RepositoryNode(new GitUri(Uri.file(repo.path), { repoPath: repo.path, fileName: repo.path }), repo, this.context, this.git));
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repositories`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
        return item;
    }
}