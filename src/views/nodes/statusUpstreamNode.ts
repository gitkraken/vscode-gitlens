'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitStatus, GitUri } from '../../git/gitService';
import { Iterables, Strings } from '../../system';
import { CommitNode } from './commitNode';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';

export class StatusUpstreamNode extends ExplorerNode {
    constructor(
        public readonly status: GitStatus,
        public readonly direction: 'ahead' | 'behind',
        private readonly explorer: Explorer,
        private readonly active: boolean = false
    ) {
        super(GitUri.fromRepoPath(status.repoPath));
    }

    get id(): string {
        return `gitlens:repository(${this.status.repoPath})${this.active ? ':active' : ''}:status:upstream:${
            this.direction
        }`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const range =
            this.direction === 'ahead'
                ? `${this.status.upstream}..${this.status.ref}`
                : `${this.status.ref}..${this.status.upstream}`;

        let log = await Container.git.getLog(this.uri.repoPath!, { maxCount: 0, ref: range });
        if (log === undefined) return [];

        if (this.direction !== 'ahead') {
            return [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))];
        }

        // Since the last commit when we are looking 'ahead' can have no previous (because of the range given) -- look it up
        const commits = Array.from(log.commits.values());
        const commit = commits[commits.length - 1];
        if (commit.previousSha === undefined) {
            log = await Container.git.getLog(this.uri.repoPath!, { maxCount: 2, ref: commit.sha });
            if (log !== undefined) {
                commits[commits.length - 1] = Iterables.first(log.commits.values());
            }
        }

        return [...Iterables.map(commits, c => new CommitNode(c, this.explorer))];
    }

    async getTreeItem(): Promise<TreeItem> {
        const ahead = this.direction === 'ahead';
        const label = ahead
            ? `${Strings.pluralize('commit', this.status.state.ahead)} ahead`
            : `${Strings.pluralize('commit', this.status.state.behind)} behind`;

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.StatusUpstream;
        item.tooltip = `${label}${ahead ? ' of ' : ''}${this.status.upstream}`;

        const iconSuffix = ahead ? 'upload' : 'download';
        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-${iconSuffix}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-${iconSuffix}.svg`)
        };

        return item;
    }
}
