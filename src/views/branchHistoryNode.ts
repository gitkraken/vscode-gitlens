'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType, ShowAllNode } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitBranch, GitUri } from '../gitService';

export class BranchHistoryNode extends ExplorerNode {

        maxCount: number | undefined = undefined;

        constructor(
            public readonly branch: GitBranch,
            uri: GitUri,
            private readonly explorer: GitExplorer
        ) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const log = await this.explorer.git.getLogForRepo(this.uri.repoPath!, this.branch.name, this.maxCount);
            if (log === undefined) return [];

            const children: (CommitNode | ShowAllNode)[] = [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer, this.branch))];
            if (log.truncated) {
                children.push(new ShowAllNode('Show All Commits', this, this.explorer.context));
            }
            return children;
        }

        async getTreeItem(): Promise<TreeItem> {
            let name = this.branch.getName();
            if (!this.branch.remote && this.branch.tracking !== undefined && this.explorer.config.showTrackingBranch) {
                name += ` ${GlyphChars.Space}${GlyphChars.ArrowLeftRight}${GlyphChars.Space} ${this.branch.tracking}`;
            }
            const item = new TreeItem(`${this.branch!.current ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${name}`, TreeItemCollapsibleState.Collapsed);

            if (this.branch.remote) {
                item.contextValue = ResourceType.RemoteBranchHistory;
            }
            else if (this.branch.current) {
                item.contextValue = !!this.branch.tracking
                    ? ResourceType.CurrentBranchHistoryWithTracking
                    : ResourceType.CurrentBranchHistory;
            }
            else {
                item.contextValue = !!this.branch.tracking
                    ? ResourceType.BranchHistoryWithTracking
                    : ResourceType.BranchHistory;
            }

            item.iconPath = {
                dark: this.explorer.context.asAbsolutePath('images/dark/icon-branch.svg'),
                light: this.explorer.context.asAbsolutePath('images/light/icon-branch.svg')
            };

            return item;
        }
    }
