'use strict';
import { Arrays, Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, MessageNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';
import { RemoteNode } from './remoteNode';

export class RemotesNode extends ExplorerNode {

        readonly resourceType: ResourceType = 'gitlens:remotes';

        constructor(uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(this.uri.repoPath!), r => r.url, r => !!r.provider);
            if (remotes === undefined || remotes.length === 0) return [new MessageNode('No remotes configured')];

            remotes.sort((a, b) => a.name.localeCompare(b.name));
            return [...Iterables.map(remotes, r => new RemoteNode(r, this.uri, this.context, this.git))];
        }

        getTreeItem(): TreeItem {
            const item = new TreeItem(`Remotes`, TreeItemCollapsibleState.Collapsed);
            item.contextValue = this.resourceType;

            item.iconPath = {
                dark: this.context.asAbsolutePath('images/dark/icon-remote.svg'),
                light: this.context.asAbsolutePath('images/light/icon-remote.svg')
            };

            return item;
        }
    }
