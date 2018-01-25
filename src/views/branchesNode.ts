'use strict';
import { Arrays, Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { Container } from '../container';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository } from '../gitService';
import { BranchFolderNode } from './branchFolderNode';
import { ExplorerBranchesLayout } from '../configuration';

export class BranchesNode extends ExplorerNode {

        constructor(
            uri: GitUri,
            private readonly repo: Repository,
            private readonly explorer: GitExplorer,
            private readonly active: boolean = false
        ) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const branches = await this.repo.getBranches();
            if (branches === undefined) return [];

            branches.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1) || a.name.localeCompare(b.name));

            let children = [];
            // filter local branches
            const branchNodes = [...Iterables.filterMap(branches, b => b.remote ? undefined : new BranchNode(b, this.uri, this.explorer))];

            if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) {
                return branchNodes;
            }

            const hierarchy = Arrays.makeHierarchical(branchNodes,
                n => !!n.branch.name.match(/\s/) ? [n.branch.name] : n.branch.name.split('/'),
                (...paths: string[]) => paths.join('/'), this.explorer.config.files.compact);

            const root = new BranchFolderNode(this.repo.path, '', undefined, hierarchy, this.explorer);
            children = await root.getChildren() as (BranchFolderNode | BranchNode)[];

            return children;
        }

        async getTreeItem(): Promise<TreeItem> {
            // HACK: Until https://github.com/Microsoft/vscode/issues/30918 is fixed
            const item = new TreeItem(`Branches`, this.active ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed);

            const remotes = await this.repo.getRemotes();
            item.contextValue = (remotes !== undefined && remotes.length > 0)
                ? ResourceType.BranchesWithRemotes
                : ResourceType.Branches;

            item.iconPath = {
                dark: Container.context.asAbsolutePath('images/dark/icon-branch.svg'),
                light: Container.context.asAbsolutePath('images/light/icon-branch.svg')
            };

            return item;
        }
    }
