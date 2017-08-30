'use strict';
import { Event, EventEmitter, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitService, GitStashCommit, GitUri } from '../gitService';
import { StashFileNode } from './stashFileNode';

export class StashNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:stash';

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor(public readonly commit: GitStashCommit, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(new GitUri(commit.uri, commit));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return Promise.resolve((this.commit as GitStashCommit).fileStatuses.map(s => new StashFileNode(s, this.commit, this.context, this.git)));
    }

    getTreeItem(): TreeItem {
        const label = CommitFormatter.fromTemplate(this.git.config.gitExplorer.stashFormat, this.commit, this.git.config.defaultDateFormat);

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}