'use strict';
import { Iterables } from '../system';
import { Command, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitBranch, GitLogCommit, GitService, GitUri, ICommitFormatOptions } from '../gitService';

export class CommitNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:commit';

    constructor(
        public readonly commit: GitLogCommit,
        protected readonly context: ExtensionContext,
        protected readonly git: GitService,
        public readonly branch?: GitBranch
    ) {
        super(new GitUri(commit.uri, commit));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await this.git.getLogForRepo(this.commit.repoPath, this.commit.sha, 1);
        if (log === undefined) return [];

        const commit = Iterables.first(log.commits.values());
        if (commit === undefined) return [];

        const children = [...Iterables.map(commit.fileStatuses, s => new CommitFileNode(s, commit, this.context, this.git, CommitFileNodeDisplayAs.File, this.branch))];
        children.sort((a, b) => a.label!.localeCompare(b.label!));
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(CommitFormatter.fromTemplate(this.git.config.gitExplorer.commitFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dataFormat: this.git.config.defaultDateFormat
        } as ICommitFormatOptions), TreeItemCollapsibleState.Collapsed);

        item.contextValue = this.resourceType;
        item.iconPath = {
            dark: this.context.asAbsolutePath('images/dark/icon-commit.svg'),
            light: this.context.asAbsolutePath('images/light/icon-commit.svg')
        };

        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
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