'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitStatus, GitUri } from '../../git/gitService';
import { Iterables, Strings } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { CommitNode } from './commitNode';
import { ShowMoreNode } from './common';
import { ExplorerNode, PageableExplorerNode, ResourceType } from './explorerNode';

export class StatusUpstreamNode extends ExplorerNode implements PageableExplorerNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(
        public readonly status: GitStatus,
        public readonly direction: 'ahead' | 'behind',
        private readonly explorer: GitExplorer
    ) {
        super(GitUri.fromRepoPath(status.repoPath));
    }

    get id(): string {
        return `gitlens:repository(${this.status.repoPath}):status:upstream:${this.direction}`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const ahead = this.direction === 'ahead';
        const range = ahead
            ? `${this.status.upstream}..${this.status.ref}`
            : `${this.status.ref}..${this.status.upstream}`;

        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount || this.explorer.config.defaultItemLimit,
            ref: range
        });
        if (log === undefined) return [];

        let children: (CommitNode | ShowMoreNode)[];
        if (ahead) {
            // Since the last commit when we are looking 'ahead' can have no previous (because of the range given) -- look it up
            const commits = [...log.commits.values()];
            const commit = commits[commits.length - 1];
            if (commit.previousSha === undefined) {
                const previousLog = await Container.git.getLog(this.uri.repoPath!, { maxCount: 2, ref: commit.sha });
                if (previousLog !== undefined) {
                    commits[commits.length - 1] = Iterables.first(previousLog.commits.values());
                }
            }

            children = commits.map(c => new CommitNode(c, this.explorer));
        }
        else {
            children = [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))];
        }

        if (log.truncated) {
            children.push(new ShowMoreNode('Commits', this, this.explorer));
        }
        return children;
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
