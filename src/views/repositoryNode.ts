'use strict';
import { Iterables, Strings } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitBranch, GitService, GitUri } from '../gitService';
import { StashNode } from './stashNode';

export class RepositoryNode extends ExplorerNode {

    static readonly rootType: ResourceType = 'repository';
    readonly resourceType: ResourceType = 'repository';

    constructor(uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
     }

    async getChildren(): Promise<ExplorerNode[]> {
        return [
            new StatusNode(this.uri, this.context, this.git),
            new StashNode(this.uri, this.context, this.git),
            new BranchesNode(this.uri, this.context, this.git)
        ];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repository ${GlyphChars.Dash} ${this.uri.repoPath}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
        return item;
    }
}

export class BranchesNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'branches';

    constructor(uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
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

export class BranchHistoryNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'branch-history';

    constructor(public branch: GitBranch, uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
     }

    async getChildren(): Promise<CommitNode[]> {
        const log = await this.git.getLogForRepo(this.uri.repoPath!, this.branch.name);
        if (log === undefined) return [];

        return [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.uri, this.context, this.git))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`${this.branch.name}${this.branch.current ? ` ${GlyphChars.Dash} current` : ''}`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }
}

export class StatusNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'status';

    constructor(uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
     }

    async getChildren(): Promise<ExplorerNode[]> {
        return [];
        // const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        // if (status === undefined) return [];

        // return [...Iterables.map(status.files, b => new CommitFile(b, this.uri, this.context, this.git))];
    }

    async getTreeItem(): Promise<TreeItem> {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        let suffix = '';
        if (status !== undefined) {
            suffix = ` ${GlyphChars.Dash} ${GlyphChars.ArrowUp} ${status.state.ahead} ${GlyphChars.ArrowDown} ${status.state.behind} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${status.branch} ${GlyphChars.ArrowLeftRight} ${status.upstream}`;
        }

        const item = new TreeItem(`Status${suffix}`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }
}
