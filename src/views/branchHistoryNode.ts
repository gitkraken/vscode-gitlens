'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitBranch, GitService, GitUri } from '../gitService';

export class BranchHistoryNode extends ExplorerNode {

        readonly resourceType: ResourceType = 'branch-history';

        constructor(public readonly branch: GitBranch, uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
            super(uri);
        }

        async getChildren(): Promise<CommitNode[]> {
            const log = await this.git.getLogForRepo(this.uri.repoPath!, this.branch.name);
            if (log === undefined) return [];

            return [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.git.config.gitExplorer.commitFormat, this.context, this.git))];
        }

        getTreeItem(): TreeItem {
            const item = new TreeItem(`${this.branch.name}${this.branch.current ? ` ${GlyphChars.Dash} current` : ''}`, TreeItemCollapsibleState.Collapsed);
            item.contextValue = this.resourceType;
            return item;
        }
    }
