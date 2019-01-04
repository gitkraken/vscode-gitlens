'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Iterables } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { RemoteNode } from './remoteNode';
import { ResourceType, ViewNode } from './viewNode';

export class RemotesNode extends ViewNode<RepositoriesView> {
    constructor(
        uri: GitUri,
        view: RepositoriesView,
        parent: ViewNode,
        public readonly repo: Repository
    ) {
        super(uri, view, parent);
    }

    get id(): string {
        return `${this._instanceId}:gitlens:repository(${this.repo.path}):remotes`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const remotes = await this.repo.getRemotes();
        if (remotes === undefined || remotes.length === 0) {
            return [new MessageNode(this.view, this, 'No remotes could be found')];
        }

        remotes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        return [...Iterables.map(remotes, r => new RemoteNode(this.uri, this.view, this, r, this.repo))];
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
