'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Iterables } from '../../system';
import { View } from '../viewBase';
import { MessageNode } from './common';
import { StashNode } from './stashNode';
import { ResourceType, ViewNode } from './viewNode';

export class StashesNode extends ViewNode {
    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        parent: ViewNode,
        public readonly view: View
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):stashes`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const stash = await this.repo.getStashList();
        if (stash === undefined) return [new MessageNode(this, 'No stashed changes.')];

        return [...Iterables.map(stash.commits.values(), c => new StashNode(c, this, this.view))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Stashes`, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Stashes;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-stash.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-stash.svg')
        };

        return item;
    }
}
