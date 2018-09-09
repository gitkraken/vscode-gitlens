'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { TagNode } from './tagNode';

export class TagsNode extends ExplorerNode {
    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer,
        private readonly active: boolean = false
    ) {
        super(uri);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path})${this.active ? ':active' : ''}:tags`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const tags = await this.repo.getTags();
        if (tags.length === 0) return [new MessageNode('No tags yet')];

        tags.sort((a, b) => a.name.localeCompare(b.name));
        const tagNodes = [...tags.map(t => new TagNode(t, this.uri, this.explorer))];
        if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return tagNodes;

        const hierarchy = Arrays.makeHierarchical(
            tagNodes,
            n => n.tag.name.split('/'),
            (...paths: string[]) => paths.join('/'),
            this.explorer.config.files.compact
        );

        const root = new BranchOrTagFolderNode(this.repo.path, '', undefined, hierarchy, this.explorer);
        const children = (await root.getChildren()) as (BranchOrTagFolderNode | TagNode)[];
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(`Tags`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Tags;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-tag.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-tag.svg')
        };

        return item;
    }
}
