'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitBranch, GitTrackingState, GitUri } from '../../git/gitService';
import { Iterables, Strings } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitNode } from './commitNode';
import { ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';

export interface BranchTrackingStatus {
    ref: string;
    repoPath: string;
    state: GitTrackingState;
    upstream?: string;
}

export class BranchTrackingStatusNode extends ViewNode<ViewWithFiles> implements PageableViewNode {
    readonly supportsPaging = true;
    readonly rememberLastMaxCount = true;
    maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly branch: GitBranch,
        public readonly status: BranchTrackingStatus,
        public readonly direction: 'ahead' | 'behind',
        // Specifies that the node is shown as a root under the repository node
        private readonly _root: boolean = false
    ) {
        super(GitUri.fromRepoPath(status.repoPath), view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.status.repoPath}):${this._root ? 'root:' : ''}branch(${
            this.status.ref
        }):status:upstream:(${this.status.upstream}):${this.direction}`;
    }

    async getChildren(): Promise<ViewNode[]> {
        const ahead = this.direction === 'ahead';
        const range = ahead
            ? `${this.status.upstream}..${this.status.ref}`
            : `${this.status.ref}..${this.status.upstream}`;

        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit,
            ref: range
        });
        if (log === undefined) return [];

        let children;
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

            children = [...insertDateMarkers(Iterables.map(commits, c => new CommitNode(this.view, this, c, this.branch)), this, 1)];
        }
        else {
            children = [
                ...insertDateMarkers(
                    Iterables.map(log.commits.values(), c => new CommitNode(this.view, this, c, this.branch)),
                    this,
                    1
                )
            ];
        }

        if (log.truncated) {
            children.push(new ShowMoreNode(this.view, this, 'Commits', log.maxCount, children[children.length - 1]));
        }
        return children;
    }

    getTreeItem(): TreeItem {
        const ahead = this.direction === 'ahead';
        const label = ahead
            ? `${Strings.pluralize('commit', this.status.state.ahead)} ahead`
            : `${Strings.pluralize('commit', this.status.state.behind)} behind`;

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        if (this._root) {
            item.contextValue = ahead ? ResourceType.StatusAheadOfUpstream : ResourceType.StatusBehindUpstream;
        }
        else {
            item.contextValue = ahead
                ? ResourceType.BranchStatusAheadOfUpstream
                : ResourceType.BranchStatusBehindUpstream;
        }
        item.tooltip = `${label}${ahead ? ' of ' : ''}${this.status.upstream}`;

        const iconSuffix = ahead ? 'upload' : 'download';
        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-${iconSuffix}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-${iconSuffix}.svg`)
        };

        return item;
    }
}
