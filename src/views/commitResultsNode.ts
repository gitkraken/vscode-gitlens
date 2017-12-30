'use strict';
import { Strings } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../constants';
import { Explorer, ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitLogCommit } from '../gitService';

export class CommitResultsNode extends ExplorerNode {

    constructor(
        readonly commit: GitLogCommit,
        private readonly explorer: Explorer,
        private readonly contextValue: ResourceType = ResourceType.Results
    ) {
        super(commit.toGitUri());
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const children = await new CommitNode(this.commit, this.explorer).getChildren();
        // Since we can't control the tooltip separately from the message (see https://github.com/Microsoft/vscode/issues/32012), don't truncate it
        children.splice(0, 0, new MessageNode(CommitFormatter.fromTemplate('${message}', this.commit, { truncateMessageAtNewLine: false })));
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const label = CommitFormatter.fromTemplate(`Commit \${sha} ${Strings.pad(GlyphChars.Dash, 1, 1)} \${authorAgo}`, this.commit, this.explorer.git.config.defaultDateFormat);
        const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.contextValue;
        return item;
    }
}