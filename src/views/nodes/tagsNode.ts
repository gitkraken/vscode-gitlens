'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays } from '../../system';
import { RepositoriesExplorer } from '../repositoriesExplorer';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType } from './explorerNode';
import { TagNode } from './tagNode';

export class TagsNode extends ExplorerNode {
    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        parent: ExplorerNode,
        public readonly explorer: RepositoriesExplorer
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):tags`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const tags = await this.repo.getTags();
        if (tags.length === 0) return [new MessageNode(this, 'No tags yet')];

        tags.sort((a, b) => a.name.localeCompare(b.name));
        const tagNodes = [...tags.map(t => new TagNode(t, this.uri, this, this.explorer))];
        if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return tagNodes;

        const hierarchy = Arrays.makeHierarchical(
            tagNodes,
            n => n.tag.name.split('/'),
            (...paths: string[]) => paths.join('/'),
            this.explorer.config.files.compact
        );

        const root = new BranchOrTagFolderNode('tag', this.repo.path, '', undefined, hierarchy, this, this.explorer);
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
