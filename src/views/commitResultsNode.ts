'use strict';
import { Strings } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Explorer, ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitLogCommit } from '../gitService';

export class CommitResultsNode extends ExplorerNode {

    constructor(
        public readonly commit: GitLogCommit,
        private readonly explorer: Explorer,
        private readonly contextValue: ResourceType = ResourceType.Results
    ) {
        super(commit.toGitUri());
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const children = await new CommitNode(this.commit, this.explorer).getChildren();
        children.splice(0, 0, new MessageNode(CommitFormatter.fromTemplate('${message}', this.commit, { truncateMessageAtNewLine: true }), CommitFormatter.fromTemplate('${message}', this.commit)));
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const label = CommitFormatter.fromTemplate(`Commit \${sha} ${Strings.pad(GlyphChars.Dash, 1, 1)} \${authorAgo}`, this.commit, Container.config.defaultDateFormat);
        const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.contextValue;
        return item;
    }
}