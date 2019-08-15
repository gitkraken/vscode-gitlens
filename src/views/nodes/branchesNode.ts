'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays, debug, gate } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ResourceType, ViewNode } from './viewNode';

export class BranchesNode extends ViewNode<RepositoriesView> {
    private _children: ViewNode[] | undefined;

    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
        super(uri, view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):branches`;
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this._children === undefined) {
            const branches = await this.repo.getBranches({
                // only show local branches
                filter: b => !b.remote,
                sort: true
            });
            if (branches === undefined) return [];

            const branchNodes = branches.map(b => new BranchNode(this.uri, this.view, this, b));
            if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchNodes;

            const hierarchy = Arrays.makeHierarchical(
                branchNodes,
                n => n.treeHierarchy,
                (...paths: string[]) => paths.join('/'),
                this.view.config.files.compact
            );

            const root = new BranchOrTagFolderNode(
                this.view,
                this,
                'branch',
                this.repo.path,
                '',
                undefined,
                hierarchy,
                'branches'
            );
            this._children = root.getChildren();
        }
        return this._children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem('Branches', TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Branches;
        if (await this.repo.hasRemotes()) {
            item.contextValue += '+remotes';
        }
        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-branch.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-branch.svg')
        };
        item.id = this.id;

        return item;
    }

    @gate()
    @debug()
    refresh() {
        this._children = undefined;
    }
}
