'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitTag, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { ExplorerNode, ExplorerRefNode, PageableExplorerNode, ResourceType } from './explorerNode';

export class TagNode extends ExplorerRefNode implements PageableExplorerNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(
        public readonly tag: GitTag,
        uri: GitUri,
        private readonly explorer: GitExplorer
    ) {
        super(uri);
    }

    get id(): string {
        return `gitlens:repository(${this.tag.repoPath}):tag(${this.tag.name})`;
    }

    get label(): string {
        return this.explorer.config.branches.layout === ExplorerBranchesLayout.Tree
            ? this.tag.getBasename()
            : this.tag.name;
    }

    get ref(): string {
        return this.tag.name;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount || this.explorer.config.defaultItemLimit,
            ref: this.tag.name
        });
        if (log === undefined) return [new MessageNode('No commits yet')];

        const children: (CommitNode | ShowMoreNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode('Commits', this, this.explorer));
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
