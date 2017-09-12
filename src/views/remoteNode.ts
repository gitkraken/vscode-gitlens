'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchHistoryNode } from './branchHistoryNode';
import { GlyphChars } from '../constants';
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
            return [...Iterables.filterMap(branches, b => !b.remote || !b.name.startsWith(this.remote.name) ? undefined : new BranchHistoryNode(b, this.uri, this.git.config.gitExplorer.commitFormat, this.context, this.git))];
        }

        getTreeItem(): TreeItem {
            const fetch = this.remote.types.includes('push');
            const push = this.remote.types.includes('push');

            let separator;
            if (fetch && push) {
                separator = GlyphChars.ArrowLeftRight;
            }
            else if (fetch) {
                separator = GlyphChars.ArrowLeft;
            }
            else if (push) {
                separator = GlyphChars.ArrowRight;
            }
            else {
                separator = GlyphChars.Dash;
            }

            const label = `${this.remote.name} ${GlyphChars.Space}${separator}${GlyphChars.Space} ${(this.remote.provider !== undefined) ? this.remote.provider.name : this.remote.domain} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ${this.remote.path}`;

            const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
            item.contextValue = this.resourceType;

            // item.iconPath = {
            //     dark: this.context.asAbsolutePath('images/dark/icon-remote.svg'),
            //     light: this.context.asAbsolutePath('images/light/icon-remote.svg')
            // };

            return item;
        }
    }
