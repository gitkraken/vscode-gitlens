'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { GlyphChars } from '../constants';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { GitRemote, GitRemoteType, GitUri, Repository } from '../gitService';

export class RemoteNode extends ExplorerNode {

        constructor(
            public readonly remote: GitRemote,
            uri: GitUri,
            private readonly repo: Repository,
            private readonly explorer: Explorer
        ) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const branches = await this.repo.getBranches();
            if (branches === undefined) return [];

            branches.sort((a, b) => a.name.localeCompare(b.name));
            return [...Iterables.filterMap(branches, b => !b.remote || !b.name.startsWith(this.remote.name) ? undefined : new BranchNode(b, this.uri, this.explorer))];
        }

        getTreeItem(): TreeItem {
            const fetch = this.remote.types.find(rt => rt.type === GitRemoteType.Fetch);
            const push = this.remote.types.find(rt => rt.type === GitRemoteType.Push);

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
            item.contextValue = ResourceType.Remote;

            // item.iconPath = {
            //     dark: this.context.asAbsolutePath('images/dark/icon-remote.svg'),
            //     light: this.context.asAbsolutePath('images/light/icon-remote.svg')
            // };

            return item;
        }
    }
