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

export class TagsNode extends ViewNode {
    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        parent: ViewNode,
        public readonly view: RepositoriesView
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):tags`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const tags = await this.repo.getTags();
        if (tags.length === 0) return [new MessageNode(this, 'No tags could be found.')];

        tags.sort((a, b) => a.name.localeCompare(b.name));
        const tagNodes = [...tags.map(t => new TagNode(t, this.uri, this, this.view))];
        if (this.view.config.branches.layout === ViewBranchesLayout.List) return tagNodes;

        const hierarchy = Arrays.makeHierarchical(
            tagNodes,
            n => n.tag.name.split('/'),
            (...paths: string[]) => paths.join('/'),
            this.view.config.files.compact
        );

        const root = new BranchOrTagFolderNode('tag', this.repo.path, '', undefined, hierarchy, this, this.view);
        const children = (await root.getChildren()) as (BranchOrTagFolderNode | TagNode)[];
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(`Tags`, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Tags;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-tag.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-tag.svg')
        };

        return item;
    }
}
