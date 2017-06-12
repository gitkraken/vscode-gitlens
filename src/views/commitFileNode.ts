'use strict';
import { Command, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitCommit, GitService, GitUri, IGitStatusFile } from '../gitService';

export class CommitFileNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'commit-file';
    command: Command;

    constructor(public status: IGitStatusFile, public commit: GitCommit, uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);

        this.command = {
            title: 'Compare File with Previous',
            command: Commands.DiffWithPrevious,
            arguments: [
                GitUri.fromFileStatus(this.status, this.commit.repoPath),
                {
                    commit: commit,
                    showOptions: {
                        preserveFocus: true,
                        preview: true
                    }
                } as DiffWithPreviousCommandArgs
            ]
        };
    }

    getChildren(): Promise<ExplorerNode[]> {
        return Promise.resolve([]);
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`${GitUri.getFormattedPath(this.status.fileName)}`, TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;
        item.command = this.command;
        return item;
    }
}