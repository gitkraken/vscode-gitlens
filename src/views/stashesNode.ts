'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';
import { StashNode } from './stashNode';

export class StashesNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:stashes';

    constructor(uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(uri);
     }

    async getChildren(): Promise<ExplorerNode[]> {
        const stash = await this.git.getStashList(this.uri.repoPath!);
        if (stash === undefined) return [new MessageNode('No stashed changes')];

        return [...Iterables.map(stash.commits.values(), c => new StashNode(c, this.context, this.git))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Stashes`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;

        item.iconPath = {
            dark: this.context.asAbsolutePath('images/dark/icon-stash.svg'),
            light: this.context.asAbsolutePath('images/light/icon-stash.svg')
        };

        return item;
    }
}