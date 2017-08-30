'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchHistoryNode } from './branchHistoryNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitRemote, GitService, GitUri } from '../gitService';

export class RemoteNode extends ExplorerNode {

        readonly resourceType: ResourceType = 'gitlens:remote';

        constructor(public readonly remote: GitRemote, uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const branches = await this.git.getBranches(this.uri.repoPath!);
            if (branches === undefined) return [];

            branches.sort((a, b) => a.name.localeCompare(b.name));
            return [...Iterables.filterMap(branches, b => !b.remote || !b.name.startsWith(this.remote.name) ? undefined : new BranchHistoryNode(b, this.remote, this.uri, this.git.config.gitExplorer.commitFormat, this.context, this.git))];
        }

        getTreeItem(): TreeItem {
            const item = new TreeItem(this.remote.name, TreeItemCollapsibleState.Collapsed);
            item.contextValue = this.resourceType;

            // item.iconPath = {
            //     dark: this.context.asAbsolutePath('images/dark/icon-remote.svg'),
            //     light: this.context.asAbsolutePath('images/light/icon-remote.svg')
            // };

            return item;
        }
    }
