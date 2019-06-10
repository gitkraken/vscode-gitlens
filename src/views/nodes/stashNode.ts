'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { CommitFormatter, GitStashCommit } from '../../git/gitService';
import { Iterables } from '../../system';
import { View } from '../viewBase';
import { StashFileNode } from './stashFileNode';
import { ResourceType, ViewNode, ViewRefNode } from './viewNode';

export class StashNode extends ViewRefNode {
    constructor(view: View, parent: ViewNode, public readonly commit: GitStashCommit) {
        super(commit.toGitUri(), view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.commit.repoPath}):stash(${this.commit.sha})`;
    }

    get ref(): string {
        return this.commit.sha;
    }

    async getChildren(): Promise<ViewNode[]> {
        const files = (this.commit as GitStashCommit).files;

        // Check for any untracked files -- since git doesn't return them via `git stash list` :(
        // See https://stackoverflow.com/questions/12681529/
        const log = await Container.git.getLog(this.commit.repoPath, {
            maxCount: 1,
            ref: `${(this.commit as GitStashCommit).stashName}^3`
        });
        if (log !== undefined) {
            const commit = Iterables.first(log.commits.values());
            if (commit !== undefined && commit.files.length !== 0) {
                // Since these files are untracked -- make them look that way
                commit.files.forEach(s => (s.status = '?'));
                files.splice(files.length, 0, ...commit.files);
            }
        }

        const children = files.map(s => new StashFileNode(this.view, this, s, this.commit.toFileCommit(s)));
        children.sort((a, b) => a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }));
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(
            CommitFormatter.fromTemplate(this.view.config.stashFormat, this.commit, {
                truncateMessageAtNewLine: true,
                dateFormat: Container.config.defaultDateFormat
            }),
            TreeItemCollapsibleState.Collapsed
        );
        item.id = this.id;
        item.description = CommitFormatter.fromTemplate(this.view.config.stashDescriptionFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dateFormat: Container.config.defaultDateFormat
        });
        item.contextValue = ResourceType.Stash;
        // eslint-disable-next-line no-template-curly-in-string
        item.tooltip = CommitFormatter.fromTemplate('${ago} (${date})\n\n${message}', this.commit, {
            dateFormat: Container.config.defaultDateFormat
        });

        return item;
    }
}
