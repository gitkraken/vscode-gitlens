'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatusFilesNode } from './branchTrackingStatusFilesNode';
import { CommitNode } from './commitNode';
import { ShowMoreNode } from './common';
import { Container } from '../../container';
import { GitBranch, GitLog, GitRevision, GitTrackingState } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { insertDateMarkers } from './helpers';
import { RepositoriesView } from '../repositoriesView';
import { debug, gate, Iterables, memoize, Strings } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { ContextValues, PageableViewNode, ViewNode } from './viewNode';

export interface BranchTrackingStatus {
	ref: string;
	repoPath: string;
	state: GitTrackingState;
	upstream?: string;
}

export class BranchTrackingStatusNode extends ViewNode<ViewsWithFiles> implements PageableViewNode {
	static key = ':status-branch:upstream';
	static getId(repoPath: string, name: string, root: boolean, upstream: string, direction: string): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}(${upstream}|${direction})`;
	}

	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: BranchTrackingStatus,
		public readonly direction: 'ahead' | 'behind',
		// Specifies that the node is shown as a root under the repository node
		private readonly root: boolean = false,
	) {
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
	}

	get ahead(): boolean {
		return this.direction === 'ahead';
	}

	get behind(): boolean {
		return this.direction === 'behind';
	}

	get id(): string {
		return BranchTrackingStatusNode.getId(
			this.status.repoPath,
			this.status.ref,
			this.root,
			this.status.upstream!,
			this.direction,
		);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log === undefined) return [];

		let children;
		if (this.ahead) {
			// Since the last commit when we are looking 'ahead' can have no previous (because of the range given) -- look it up
			const commits = [...log.commits.values()];
			const commit = commits[commits.length - 1];
			if (commit.previousSha === undefined) {
				const previousLog = await Container.git.getLog(this.uri.repoPath!, { limit: 2, ref: commit.sha });
				if (previousLog !== undefined) {
					commits[commits.length - 1] = Iterables.first(previousLog.commits.values());
				}
			}

			children = [
				...insertDateMarkers(
					Iterables.map(commits, c => new CommitNode(this.view, this, c, this.branch)),
					this,
					1,
				),
			];
		} else {
			children = [
				...insertDateMarkers(
					Iterables.map(log.commits.values(), c => new CommitNode(this.view, this, c, this.branch)),
					this,
					1,
				),
			];
		}

		if (log.hasMore) {
			children.push(new ShowMoreNode(this.view, this, children[children.length - 1]));
		}

		if (!this.isReposView && this.status.upstream && this.ahead && this.status.state.ahead > 0) {
			children.push(
				new BranchTrackingStatusFilesNode(
					this.view,
					this,
					this.branch,
					this.status as Required<BranchTrackingStatus>,
					this.direction,
					this.root,
				),
			);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const ahead = this.ahead;
		let label = ahead
			? `${Strings.pluralize('commit', this.status.state.ahead)} ahead`
			: `${Strings.pluralize('commit', this.status.state.behind)} behind`;
		if (!this.isReposView) {
			label += `${ahead ? ' of ' : ' '}${this.status.upstream}`;
		}

		const item = new TreeItem(
			label,
			ahead && !this.isReposView ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		if (this.root) {
			item.contextValue = ahead ? ContextValues.StatusAheadOfUpstream : ContextValues.StatusBehindUpstream;
		} else {
			item.contextValue = ahead
				? ContextValues.BranchStatusAheadOfUpstream
				: ContextValues.BranchStatusBehindUpstream;
		}
		item.iconPath = new ThemeIcon(ahead ? 'cloud-upload' : 'cloud-download');
		item.tooltip = `${label}${ahead ? ' of ' : ' '}${this.status.upstream}`;
		return item;
	}

	@memoize()
	private get isReposView() {
		return this.view instanceof RepositoriesView;
	}

	@gate()
	@debug()
	refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log === undefined) {
			const range = this.ahead
				? GitRevision.createRange(this.status.upstream, this.status.ref)
				: GitRevision.createRange(this.status.ref, this.status.upstream);

			this._log = await Container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: range,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async showMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log === undefined || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;
		void this.triggerChange(false);
	}
}
