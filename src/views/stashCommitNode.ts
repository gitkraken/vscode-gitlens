'use strict';
import { Event, EventEmitter, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFileNode } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitService, GitStashCommit, GitUri } from '../gitService';

export class StashCommitNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'stash-commit';

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    public refreshNode() {
        this._onDidChangeTreeData.fire();
    }

    constructor(public readonly commit: GitStashCommit, context: ExtensionContext, git: GitService) {
        super(new GitUri(commit.uri, commit), context, git);
    }

    async getChildren(): Promise<CommitFileNode[]> {
        return Promise.resolve((this.commit as GitStashCommit).fileStatuses.map(_ => new CommitFileNode(_, this.commit, this.git.config.stashExplorer.stashFileFormat, this.context, this.git)));
    }

    getTreeItem(): TreeItem {
        const label = CommitFormatter.fromTemplate(this.git.config.stashExplorer.stashFormat, this.commit, this.git.config.defaultDateFormat);

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        // item.command = {
        //     title: 'Show Stash Details',
        //     command: Commands.ShowQuickCommitDetails,
        //     arguments: [
        //         new GitUri(commit.uri, commit),
        //         {
        //             commit: this.commit,
        //             sha: this.commit.sha
        //         } as ShowQuickCommitDetailsCommandArgs
        //     ]
        // };
        return item;
    }
}