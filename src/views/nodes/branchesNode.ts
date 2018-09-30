'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays, Iterables } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ResourceType, ViewNode } from './viewNode';

export class BranchesNode extends ViewNode {
    private _children: ViewNode[] | undefined;

    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        parent: ViewNode,
        public readonly view: RepositoriesView
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):branches`;
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this._children === undefined) {
            const branches = await this.repo.getBranches();
            if (branches === undefined) return [];

            branches.sort((a, b) => a.name.localeCompare(b.name));

            // filter local branches
            const branchNodes = [
                ...Iterables.filterMap(
                    branches,
                    b => (b.remote ? undefined : new BranchNode(b, this.uri, this, this.view))
                )
            ];
            if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchNodes;

            const hierarchy = Arrays.makeHierarchical(
                branchNodes,
                n => (n.branch.detached ? [n.branch.name] : n.branch.getName().split('/')),
                (...paths: string[]) => paths.join('/'),
                this.view.config.files.compact
            );

            const root = new BranchOrTagFolderNode('branch', this.repo.path, '', undefined, hierarchy, this, this.view);
            this._children = await root.getChildren();
        }
        return this._children;
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

    refresh() {
        this._children = undefined;
    }
}
