'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchHistoryNode } from './branchHistoryNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';

export class BranchesNode extends ExplorerNode {

        readonly resourceType: ResourceType = 'branches';

        constructor(uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
            super(uri);
        }

        async getChildren(): Promise<BranchHistoryNode[]> {
            const branches = await this.git.getBranches(this.uri.repoPath!);
            if (branches === undefined) return [];

            return [...Iterables.filterMap(branches.sort(_ => _.current ? 0 : 1), b => b.remote ? undefined : new BranchHistoryNode(b, this.uri, this.context, this.git))];
        }

        getTreeItem(): TreeItem {
            const item = new TreeItem(`Branches`, TreeItemCollapsibleState.Collapsed);
            item.contextValue = this.resourceType;
            return item;
        }
    }
