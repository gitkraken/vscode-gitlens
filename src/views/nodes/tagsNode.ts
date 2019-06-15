'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { TagNode } from './tagNode';
import { ResourceType, ViewNode } from './viewNode';

export class TagsNode extends ViewNode<RepositoriesView> {
    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
        super(uri, view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):tags`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const tags = await this.repo.getTags({ sort: true });
        if (tags.length === 0) return [new MessageNode(this.view, this, 'No tags could be found.')];

        const tagNodes = tags.map(t => new TagNode(this.uri, this.view, this, t));
        if (this.view.config.branches.layout === ViewBranchesLayout.List) return tagNodes;

        const hierarchy = Arrays.makeHierarchical(
            tagNodes,
            n => n.tag.name.split('/'),
            (...paths: string[]) => paths.join('/'),
            this.view.config.files.compact
        );

        const root = new BranchOrTagFolderNode(
            this.view,
            this,
            'tag',
            this.repo.path,
            '',
            undefined,
            hierarchy,
            'tags'
        );
        const children = (await root.getChildren()) as (BranchOrTagFolderNode | TagNode)[];
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Tags', TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Tags;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-tag.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-tag.svg')
        };

        return item;
    }
}
