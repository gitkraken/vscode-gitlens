'use strict';
import { Strings } from '../system';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchesNode } from './branchesNode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository, RepositoryChange, RepositoryChangeEvent } from '../gitService';
import { RemotesNode } from './remotesNode';
import { StatusNode } from './statusNode';
import { StashesNode } from './stashesNode';
import { Logger } from '../logger';

export class RepositoryNode extends ExplorerNode {

    constructor(
        uri: GitUri,
        readonly repo: Repository,
        private readonly explorer: GitExplorer,
        private readonly active: boolean = false
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();
        this.updateSubscription();

        this.children = [
            new StatusNode(this.uri, this.repo, this, this.explorer, this.active),
            new BranchesNode(this.uri, this.repo, this.explorer, this.active),
            new RemotesNode(this.uri, this.repo, this.explorer),
            new StashesNode(this.uri, this.repo, this.explorer)
        ];
        return this.children;
    }

    getTreeItem(): TreeItem {
        this.updateSubscription();

        const label = this.active
            ? `Active Repository ${Strings.pad(GlyphChars.Dash, 1, 1)} ${this.repo.formattedName || this.uri.repoPath}`
            : `${this.repo.formattedName || this.uri.repoPath}`;

        const item = new TreeItem(label, this.active ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Repository;
        return item;
    }

    private updateSubscription() {
        // We only need to subscribe if auto-refresh is enabled, because if it becomes enabled we will be refreshed
        if (this.explorer.autoRefresh) {
            this.disposable = this.disposable || Disposable.from(
                this.explorer.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this),
                this.repo.onDidChange(this.onRepoChanged, this)
            );
        }
        else if (this.disposable !== undefined) {
            this.disposable.dispose();
            this.disposable = undefined;
        }
    }

    private onAutoRefreshChanged() {
        this.updateSubscription();
    }

    private onRepoChanged(e: RepositoryChangeEvent) {
        Logger.log(`RepositoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

        if (this.children === undefined || e.changed(RepositoryChange.Repository) || e.changed(RepositoryChange.Config)) {
            this.explorer.refreshNode(this);

            return;
        }

        if (e.changed(RepositoryChange.Stashes)) {
            const node = this.children.find(c => c instanceof StashesNode);
            if (node !== undefined) {
                this.explorer.refreshNode(node);
            }
        }

        if (e.changed(RepositoryChange.Remotes)) {
            const node = this.children.find(c => c instanceof RemotesNode);
            if (node !== undefined) {
                this.explorer.refreshNode(node);
            }
        }
    }
}