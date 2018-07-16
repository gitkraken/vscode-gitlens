'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter, GitLogCommit } from '../../gitService';
import { Strings } from '../../system';
import { CommitNode } from './commitNode';
import { Explorer, ExplorerNode, MessageNode, ResourceType } from './explorerNode';

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
        children.splice(
            0,
            0,
            new MessageNode(
                CommitFormatter.fromTemplate('${message}', this.commit, { truncateMessageAtNewLine: true }),
                CommitFormatter.fromTemplate('${message}', this.commit)
            )
        );
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const label = CommitFormatter.fromTemplate(
            `Commit \${sha} ${Strings.pad(GlyphChars.Dash, 1, 1)} \${authorAgoOrDate}`,
            this.commit,
            Container.config.defaultDateFormat
        );
        const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.contextValue;
        return item;
    }
}
