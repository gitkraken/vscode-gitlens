'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { Container } from '../container';
import { Explorer, ExplorerNode, ExplorerRefNode, MessageNode, ResourceType, ShowAllNode } from './explorerNode';
import { GitTag, GitUri } from '../gitService';

export class TagNode extends ExplorerRefNode {

    readonly supportsPaging: boolean = true;

    constructor(
        public readonly tag: GitTag,
        uri: GitUri,
        private readonly explorer: Explorer
    ) {
        super(uri);
    }

    get ref(): string {
        return this.tag.name;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await Container.git.getLogForRepo(this.uri.repoPath!, { maxCount: this.maxCount, ref: this.tag.name });
        if (log === undefined) return [new MessageNode('No commits yet')];

        const children: (CommitNode | ShowAllNode)[] = [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))];
        if (log.truncated) {
            children.push(new ShowAllNode('Show All Commits', this, this.explorer));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.tag.name, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Tag;

        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-tag.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-tag.svg`)
        };

        return item;
    }
}
