'use strict';
import { Arrays, Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchFolderNode } from './branchFolderNode';
import { BranchNode } from './branchNode';
import { ExplorerBranchesLayout } from '../configuration';
import { Container } from '../container';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository } from '../gitService';

export class BranchesNode extends ExplorerNode {

        constructor(
            uri: GitUri,
            private readonly repo: Repository,
            private readonly explorer: GitExplorer,
            private readonly active: boolean = false
        ) {
            super(uri);
        }

        get id(): string {
            return `gitlens:repository(${this.repo.path})${this.active ? ':active' : ''}:branches`;
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const branches = await this.repo.getBranches();
            if (branches === undefined) return [];

            branches.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1) || a.name.localeCompare(b.name));

            // filter local branches
            const branchNodes = [...Iterables.filterMap(branches, b => b.remote ? undefined : new BranchNode(b, this.uri, this.explorer))];
            if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return branchNodes;

            // Take out the current branch, since that should always be first and un-nested
            const current = (branchNodes.length > 0 && branchNodes[0].current)
                ? branchNodes.splice(0, 1)[0]
                : undefined;

            const hierarchy = Arrays.makeHierarchical(branchNodes,
                n => n.branch.isValid() ? n.branch.getName().split('/') : [n.branch.name],
                (...paths: string[]) => paths.join('/'),
                this.explorer.config.files.compact);

            const root = new BranchFolderNode(this.repo.path, '', undefined, hierarchy, this.explorer);
            const children = await root.getChildren() as (BranchFolderNode | BranchNode)[];

            // If we found a current branch, insert it at the start
            if (current !== undefined) {
                children.splice(0, 0, current);
            }

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
