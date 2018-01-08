'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../container';
import { Explorer, ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { GitUri, Repository } from '../gitService';
import { TagNode } from './tagNode';

export class TagsNode extends ExplorerNode {

        constructor(
            uri: GitUri,
            private readonly repo: Repository,
            private readonly explorer: Explorer
        ) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const tags = await this.repo.getTags();
            if (tags.length === 0) return [new MessageNode('No tags yet')];

            tags.sort((a, b) => a.name.localeCompare(b.name));
            return [...tags.map(t => new TagNode(t, this.uri, this.explorer))];
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
