'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri, Repository } from '../../git/gitService';
import { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { ContributorNode } from './contributorNode';
import { ResourceType, ViewNode } from './viewNode';
import { Container } from '../../container';

export class ContributorsNode extends ViewNode<RepositoriesView> {
    constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
        super(uri, view, parent);
    }

    get id(): string {
        return `${this._instanceId}:gitlens:repository(${this.repo.path}):contributors`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const contributors = await this.repo.getContributors();
        if (contributors.length === 0) return [new MessageNode(this.view, this, 'No contributors could be found.')];

        contributors.sort((a, b) => b.count - a.count);

        const children = contributors.map(c => new ContributorNode(this.uri, this.view, this, c));
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Contributors', TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Contributors;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-people.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-people.svg')
        };

        return item;
    }
}
