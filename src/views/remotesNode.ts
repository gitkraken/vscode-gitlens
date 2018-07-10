'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../container';
import { ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository } from '../gitService';
import { RemoteNode } from './remoteNode';

export class RemotesNode extends ExplorerNode {
    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer,
        private readonly active: boolean = false
    ) {
        super(uri);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path})${this.active ? ':active' : ''}:remotes`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const remotes = await this.repo.getRemotes();
        if (remotes === undefined || remotes.length === 0) return [new MessageNode('No remotes configured')];

        remotes.sort((a, b) => a.name.localeCompare(b.name));
        return [...Iterables.map(remotes, r => new RemoteNode(r, this.uri, this.repo, this.explorer))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Remotes`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Remotes;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-remote.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-remote.svg')
        };

        return item;
    }
}
