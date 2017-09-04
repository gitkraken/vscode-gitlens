'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchHistoryNode } from './branchHistoryNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';

export class BranchesNode extends ExplorerNode {

        readonly resourceType: ResourceType = 'gitlens:branches';

        constructor(uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const branches = await this.git.getBranches(this.uri.repoPath!);
            if (branches === undefined) return [];

            branches.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1) || a.name.localeCompare(b.name));
            return [...Iterables.filterMap(branches, b => b.remote ? undefined : new BranchHistoryNode(b, this.uri, this.git.config.gitExplorer.commitFormat, this.context, this.git))];
        }

        getTreeItem(): TreeItem {
            const item = new TreeItem(`Branches`, TreeItemCollapsibleState.Expanded);
            item.contextValue = this.resourceType;

            item.iconPath = {
                dark: this.context.asAbsolutePath('images/dark/icon-branch.svg'),
                light: this.context.asAbsolutePath('images/light/icon-branch.svg')
            };

            return item;
        }
    }
