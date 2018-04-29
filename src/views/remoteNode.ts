'use strict';
import { Arrays, Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { BranchNode } from './branchNode';
import { ExplorerBranchesLayout } from '../configuration';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitRemote, GitRemoteType, GitUri, Repository } from '../gitService';
import { Container } from '../container';

export class RemoteNode extends ExplorerNode {

        constructor(
            public readonly remote: GitRemote,
            uri: GitUri,
            private readonly repo: Repository,
            private readonly explorer: GitExplorer
        ) {
            super(uri);
        }

        async getChildren(): Promise<ExplorerNode[]> {
            const branches = await this.repo.getBranches();
            if (branches === undefined) return [];

            branches.sort((a, b) => a.name.localeCompare(b.name));

            // filter remote branches
            const branchNodes = [...Iterables.filterMap(branches, b => !b.remote || !b.name.startsWith(this.remote.name) ? undefined : new BranchNode(b, this.uri, this.explorer))];
            if (this.explorer.config.branches.layout === ExplorerBranchesLayout.List) return branchNodes;

            const hierarchy = Arrays.makeHierarchical(
                branchNodes,
                n => n.branch.isValid() ? n.branch.getName().split('/') : [n.branch.name],
                (...paths: string[]) => paths.join('/'),
                this.explorer.config.files.compact
            );

            const root = new BranchOrTagFolderNode(this.repo.path, '', undefined, hierarchy, this.explorer);
            const children = await root.getChildren() as (BranchOrTagFolderNode | BranchNode)[];

            return children;
        }

        getTreeItem(): TreeItem {
            const fetch = this.remote.types.find(rt => rt.type === GitRemoteType.Fetch);
            const push = this.remote.types.find(rt => rt.type === GitRemoteType.Push);

            let separator;
            if (fetch && push) {
                separator = GlyphChars.ArrowLeftRightLong;
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
            item.tooltip = `${this.remote.name}\n${this.remote.path} (${(this.remote.provider !== undefined) ? this.remote.provider.name : this.remote.domain})`;

            if (this.remote.provider !== undefined) {
                item.iconPath = {
                    dark: Container.context.asAbsolutePath(`images/dark/icon-${this.remote.provider.icon}.svg`),
                    light: Container.context.asAbsolutePath(`images/light/icon-${this.remote.provider.icon}.svg`)
                };
            }
            else {
                item.iconPath = {
                    dark: Container.context.asAbsolutePath('images/dark/icon-remote.svg'),
                    light: Container.context.asAbsolutePath('images/light/icon-remote.svg')
                };
            }

            return item;
        }
    }
