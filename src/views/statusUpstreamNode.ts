'use strict';
import { Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { Container } from '../container';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { GitStatus, GitUri } from '../gitService';

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
        return `gitlens:repository(${this.status.repoPath})${this.active ? ':active' : ''}:status:upstream`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const range = this.direction === 'ahead'
            ? `${this.status.upstream}..${this.status.branch}`
            : `${this.status.branch}..${this.status.upstream}`;

        let log = await Container.git.getLog(this.uri.repoPath!, { maxCount: 0, ref: range });
        if (log === undefined) return [];

        if (this.direction !== 'ahead') return [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))];

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
        const label = this.direction === 'ahead'
            ? `${this.status.state.ahead} commit${this.status.state.ahead > 1 ? 's' : ''} (ahead of ${this.status.upstream})`
            : `${this.status.state.behind} commit${this.status.state.behind > 1 ? 's' : ''} (behind ${this.status.upstream})`;

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.StatusUpstream;

        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-${this.direction === 'ahead' ? 'upload' : 'download'}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-${this.direction === 'ahead' ? 'upload' : 'download'}.svg`)
        };

        return item;
    }
}