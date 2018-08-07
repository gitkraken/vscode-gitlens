'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays, Iterables } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ExplorerNode, ResourceType } from './explorerNode';

export class BranchesNode extends ExplorerNode {
    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer
    ) {
        super(uri);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):branches`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const branches = await this.repo.getBranches();
        if (branches === undefined) return [];

        branches.sort((a, b) => a.name.localeCompare(b.name));

        // filter local branches
        const branchNodes = [
            ...Iterables.filterMap(branches, b => (b.remote ? undefined : new BranchNode(b, this.uri, this.explorer)))
        ];
        if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return branchNodes;

        const hierarchy = Arrays.makeHierarchical(
            branchNodes,
            n => (n.branch.detached ? [n.branch.name] : n.branch.getName().split('/')),
            (...paths: string[]) => paths.join('/'),
            this.explorer.config.files.compact
        );

        const root = new BranchOrTagFolderNode('branch', this.repo.path, '', undefined, hierarchy, this.explorer);
        return root.getChildren();
    }

    async getTreeItem(): Promise<TreeItem> {
        const remotes = await this.repo.getRemotes();

        const item = new TreeItem(`Branches`, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue =
            remotes !== undefined && remotes.length > 0 ? ResourceType.BranchesWithRemotes : ResourceType.Branches;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-branch.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-branch.svg')
        };

        return item;
    }
}
