'use strict';
import { Iterables } from '../system';
import { Command, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { CommitFileNode } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitCommit, GitService, GitUri } from '../gitService';

export class CommitNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'commit';

    constructor(public readonly commit: GitCommit, private template: string, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(new GitUri(commit.uri, commit));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this.commit.type === 'file') Promise.resolve([]);

        const log = await this.git.getLogForRepo(this.commit.repoPath, this.commit.sha, 1);
        if (log === undefined) return [];

        const commit = Iterables.first(log.commits.values());
        if (commit === undefined) return [];

        return [...Iterables.map(commit.fileStatuses, s => new CommitFileNode(s, commit, this.git.config.gitExplorer.commitFileFormat, this.context, this.git))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(CommitFormatter.fromTemplate(this.template, this.commit, this.git.config.defaultDateFormat));
        if (this.commit.type === 'file') {
            item.collapsibleState = TreeItemCollapsibleState.None;
            item.command = this.getCommand();
            item.contextValue = 'commit-file';
        }
        else {
            item.collapsibleState = TreeItemCollapsibleState.Collapsed;
            item.contextValue = this.resourceType;
        }

        item.iconPath = {
            dark: this.context.asAbsolutePath('images/dark/icon-commit.svg'),
            light: this.context.asAbsolutePath('images/light/icon-commit.svg')
        };

        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous',
            command: Commands.DiffWithPrevious,
            arguments: [
                new GitUri(this.uri, this.commit),
                {
                    commit: this.commit,
                    line: 0,
                    showOptions: {
                        preserveFocus: true,
                        preview: true
                    }
                } as DiffWithPreviousCommandArgs
            ]
        };
    }
}