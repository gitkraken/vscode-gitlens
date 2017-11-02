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

    readonly resourceType: ResourceType = 'gitlens:repository';

    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();
        this.updateSubscription();

        this.children = [
            new StatusNode(this.uri, this.repo, this, this.explorer),
            new BranchesNode(this.uri, this.repo, this.explorer),
            new RemotesNode(this.uri, this.repo, this.explorer),
            new StashesNode(this.uri, this.repo, this.explorer)
        ];
        return this.children;
    }

    getTreeItem(): TreeItem {
        this.updateSubscription();

        const item = new TreeItem(`Repository ${Strings.pad(GlyphChars.Dash, 1, 1)} ${this.repo.name || this.uri.repoPath}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
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

        let node: ExplorerNode | undefined;
        if (this.children !== undefined && e.changed(RepositoryChange.Stashes, true)) {
            node = this.children.find(c => c instanceof StashesNode);
        }

        this.explorer.refreshNode(node || this);
    }
}