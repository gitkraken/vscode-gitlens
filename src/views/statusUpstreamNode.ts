'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { CommitNode } from './commitNode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitStatus, GitUri } from '../gitService';

export class StatusUpstreamNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:status-upstream';

    constructor(
        public readonly status: GitStatus,
        public readonly direction: 'ahead' | 'behind',
        protected readonly context: ExtensionContext,
        protected readonly git: GitService
    ) {
        super(new GitUri(Uri.file(status.repoPath), { repoPath: status.repoPath, fileName: status.repoPath }));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const range = this.direction === 'ahead'
            ? `${this.status.upstream}..${this.status.branch}`
            : `${this.status.branch}..${this.status.upstream}`;

        let log = await this.git.getLogForRepo(this.uri.repoPath!, range, 0);
        if (log === undefined) return [];

        if (this.direction !== 'ahead') return [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.context, this.git))];

        // Since the last commit when we are looking 'ahead' can have no previous (because of the range given) -- look it up
        const commits = Array.from(log.commits.values());
        const commit = commits[commits.length - 1];
        if (commit.previousSha === undefined) {
            log = await this.git.getLogForRepo(this.uri.repoPath!, commit.sha, 2);
            if (log !== undefined) {
                commits[commits.length - 1] = Iterables.first(log.commits.values());
            }
        }

        return [...Iterables.map(commits, c => new CommitNode(c, this.context, this.git))];
    }

    async getTreeItem(): Promise<TreeItem> {
        const label = this.direction === 'ahead'
            ? `${this.status.state.ahead} commit${this.status.state.ahead > 1 ? 's' : ''} (ahead of ${this.status.upstream})`
            : `${this.status.state.behind} commit${this.status.state.behind > 1 ? 's' : ''} (behind ${this.status.upstream})`;

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;

        item.iconPath = {
            dark: this.context.asAbsolutePath(`images/dark/icon-${this.direction === 'ahead' ? 'upload' : 'download'}.svg`),
            light: this.context.asAbsolutePath(`images/light/icon-${this.direction === 'ahead' ? 'upload' : 'download'}.svg`)
        };

        return item;
    }
}