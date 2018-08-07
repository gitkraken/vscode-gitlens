'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { CommitFormatter, GitStashCommit, ICommitFormatOptions } from '../../git/gitService';
import { Iterables } from '../../system';
import { Explorer } from '../explorer';
import { ExplorerNode, ExplorerRefNode, ResourceType } from './explorerNode';
import { StashFileNode } from './stashFileNode';

export class StashNode extends ExplorerRefNode {
    constructor(
        public readonly commit: GitStashCommit,
        private readonly explorer: Explorer
    ) {
        super(commit.toGitUri());
    }

    get id(): string {
        return `gitlens:repository(${this.commit.repoPath}):stash(${this.commit.sha})`;
    }

    get ref(): string {
        return this.commit.sha;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const statuses = (this.commit as GitStashCommit).fileStatuses;

        // Check for any untracked files -- since git doesn't return them via `git stash list` :(
        const log = await Container.git.getLog(this.commit.repoPath, {
            maxCount: 1,
            ref: `${(this.commit as GitStashCommit).stashName}^3`
        });
        if (log !== undefined) {
            const commit = Iterables.first(log.commits.values());
            if (commit !== undefined && commit.fileStatuses.length !== 0) {
                // Since these files are untracked -- make them look that way
                commit.fileStatuses.forEach(s => (s.status = '?'));
                statuses.splice(statuses.length, 0, ...commit.fileStatuses);
            }
        }

        const children = statuses.map(s => new StashFileNode(s, this.commit.toFileCommit(s), this.explorer));
        children.sort((a, b) => a.label!.localeCompare(b.label!));
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(
            CommitFormatter.fromTemplate(this.explorer.config.stashFormat, this.commit, {
                truncateMessageAtNewLine: true,
                dateFormat: Container.config.defaultDateFormat
            } as ICommitFormatOptions),
            TreeItemCollapsibleState.Collapsed
        );
        item.id = this.id;
        item.contextValue = ResourceType.Stash;
        item.tooltip = CommitFormatter.fromTemplate('${ago} (${date})\n\n${message}', this.commit, {
            dateFormat: Container.config.defaultDateFormat
        } as ICommitFormatOptions);

        return item;
    }
}
