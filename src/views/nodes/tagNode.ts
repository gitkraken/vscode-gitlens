'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitTag, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode, ViewRefNode } from './viewNode';

export class TagNode extends ViewRefNode implements PageableViewNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(
        public readonly tag: GitTag,
        uri: GitUri,
        parent: ViewNode,
        public readonly view: RepositoriesView
    ) {
        super(uri, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.tag.repoPath}):tag(${this.tag.name})`;
    }

    get label(): string {
        return this.view.config.branches.layout === ViewBranchesLayout.Tree ? this.tag.getBasename() : this.tag.name;
    }

    get ref(): string {
        return this.tag.name;
    }

    async getChildren(): Promise<ViewNode[]> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount || this.view.config.defaultItemLimit,
            ref: this.tag.name
        });
        if (log === undefined) return [new MessageNode(this, 'No commits yet')];

        const children = [
            ...insertDateMarkers(Iterables.map(log.commits.values(), c => new CommitNode(c, this, this.view)), this)
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode('Commits', this, this.view));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.Tag;
        item.tooltip = `${this.tag.name}${this.tag.annotation === undefined ? '' : `\n${this.tag.annotation}`}`;

        return item;
    }
}
