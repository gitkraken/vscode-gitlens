'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitRemote, GitRemoteType, GitUri, Repository } from '../../git/gitService';
import { Arrays, Iterables, log } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ResourceType, ViewNode } from './viewNode';

export class RemoteNode extends ViewNode<RepositoriesView> {
    constructor(
        uri: GitUri,
        view: RepositoriesView,
        parent: ViewNode,
        public readonly remote: GitRemote,
        public readonly repo: Repository
    ) {
        super(uri, view, parent);
    }

    get id(): string {
        return `${this._instanceId}:gitlens:repository(${this.remote.repoPath}):remote(${this.remote.name})`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const branches = await this.repo.getBranches();
        if (branches === undefined) return [];

        branches.sort(
            (a, b) =>
                (a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
                a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        // filter remote branches
        const branchNodes = [
            ...Iterables.filterMap(branches, b =>
                !b.remote || !b.name.startsWith(this.remote.name)
                    ? undefined
                    : new BranchNode(this.uri, this.view, this, b)
            )
        ];
        if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchNodes;

        const hierarchy = Arrays.makeHierarchical(
            branchNodes,
            n => n.treeHierarchy,
            (...paths: string[]) => paths.join('/'),
            this.view.config.files.compact
        );

        const root = new BranchOrTagFolderNode(
            this.view,
            this,
            'remote-branch',
            this.repo.path,
            '',
            undefined,
            hierarchy
        );
        const children = (await root.getChildren()) as (BranchOrTagFolderNode | BranchNode)[];

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

        const item = new TreeItem(
            `${this.remote.default ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${this.remote.name}`,
            TreeItemCollapsibleState.Collapsed
        );
        item.description = `${separator}${GlyphChars.Space} ${
            this.remote.provider !== undefined ? this.remote.provider.name : this.remote.domain
        } ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ${
            this.remote.provider !== undefined ? this.remote.provider.displayPath : this.remote.path
        }`;
        item.contextValue = ResourceType.Remote;
        if (this.remote.default) {
            item.contextValue += '+default';
        }

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

        item.id = this.id;
        item.tooltip = `${this.remote.name} (${
            this.remote.provider !== undefined ? this.remote.provider.name : this.remote.domain
        })\n${this.remote.provider !== undefined ? this.remote.provider.displayPath : this.remote.path}\n`;

        for (const type of this.remote.types) {
            item.tooltip += `\n${type.url} (${type.type})`;
        }

        return item;
    }

    @log()
    fetch(options: { progress?: boolean } = {}) {
        return this.repo.fetch({ ...options, remote: this.remote.name });
    }

    @log()
    async setAsDefault(state: boolean = true) {
        void (await this.remote.setAsDefault(state));
        void this.parent!.triggerChange();
    }
}
