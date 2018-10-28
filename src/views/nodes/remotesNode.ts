'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Iterables } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { RemoteNode } from './remoteNode';
import { ResourceType, ViewNode } from './viewNode';

export class RemotesNode extends ViewNode {
    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        parent: ViewNode,
        public readonly view: RepositoriesView
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path}):remotes`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const remotes = await this.repo.getRemotes();
        if (remotes === undefined || remotes.length === 0) return [new MessageNode(this, 'No remotes could be found')];

        remotes.sort((a, b) => a.name.localeCompare(b.name));
        return [...Iterables.map(remotes, r => new RemoteNode(r, this.uri, this.repo, this, this.view))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Remotes`, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Remotes;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-remote.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-remote.svg')
        };

        return item;
    }
}
