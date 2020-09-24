'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatusFilesNode } from './branchTrackingStatusFilesNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode } from './common';
import { Container } from '../../container';
import { GitBranch, GitLog, GitRevision, GitTrackingState } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { insertDateMarkers } from './helpers';
import { RepositoriesView } from '../repositoriesView';
import { Dates, debug, gate, Iterables, memoize, Strings } from '../../system';
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
	static getId(
		repoPath: string,
		name: string,
		root: boolean,
		upstream: string | undefined,
		upstreamType: string,
	): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}(${upstream ?? ''}|${upstreamType})`;
	}

	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: BranchTrackingStatus,
		public readonly upstreamType: 'ahead' | 'behind' | 'same' | 'none',
		// Specifies that the node is shown as a root under the repository node
		private readonly root: boolean = false,
	) {
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
	}

	get id(): string {
		return BranchTrackingStatusNode.getId(
			this.status.repoPath,
			this.status.ref,
			this.root,
			this.status.upstream,
			this.upstreamType,
		);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.upstreamType === 'same' || this.upstreamType === 'none') return [];

		const log = await this.getLog();
		if (log == null) return [];

		let commits;
		if (this.upstreamType === 'ahead') {
			// Since the last commit when we are looking 'ahead' can have no previous (because of the range given) -- look it up
			commits = [...log.commits.values()];
			const commit = commits[commits.length - 1];
			if (commit.previousSha == null) {
				const previousLog = await Container.git.getLog(this.uri.repoPath!, { limit: 2, ref: commit.sha });
				if (previousLog != null) {
					commits[commits.length - 1] = Iterables.first(previousLog.commits.values());
				}
			}
		} else {
			commits = log.commits.values();
		}

		const children = [
			...insertDateMarkers(
				Iterables.map(commits, c => new CommitNode(this.view, this, c, this.branch)),
				this,
				1,
			),
		];

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
		}

		if (!this.isReposView && this.status.upstream && this.upstreamType === 'ahead' && this.status.state.ahead > 0) {
			children.push(
				new BranchTrackingStatusFilesNode(
					this.view,
					this,
					this.branch,
					this.status as Required<BranchTrackingStatus>,
					this.upstreamType,
					this.root,
				),
			);
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let lastFetched = 0;

		if (this.root && !this.isReposView && this.upstreamType !== 'none') {
			const repo = await Container.git.getRepository(this.repoPath);
			lastFetched = (await repo?.getLastFetched()) ?? 0;
		}

		let label;
		let collapsibleState;
		let contextValue;
		let icon;
		let tooltip;
		switch (this.upstreamType) {
			case 'ahead':
				label = `${Strings.pluralize('commit', this.status.state.ahead)} ahead`;
				tooltip = `${this.branch.name} is ${label} of ${this.status.upstream}`;
				if (!this.isReposView) {
					label = `${this.root ? `${this.branch.name} is ` : ''}${label} of ${this.status.upstream}`;
				}

				collapsibleState = !this.isReposView
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed;
				contextValue = this.root
					? ContextValues.StatusAheadOfUpstream
					: ContextValues.BranchStatusAheadOfUpstream;
				icon = 'cloud-upload';

				break;

			case 'behind':
				label = `${Strings.pluralize('commit', this.status.state.behind)} behind`;
				tooltip = `${this.branch.name} is ${label} ${this.status.upstream}`;
				if (!this.isReposView) {
					label = `${this.root ? `${this.branch.name} is ` : ''}${label} ${this.status.upstream}`;
				}

				collapsibleState = TreeItemCollapsibleState.Collapsed;
				contextValue = this.root
					? ContextValues.StatusBehindUpstream
					: ContextValues.BranchStatusBehindUpstream;
				icon = 'cloud-download';

				break;

			case 'same':
				label = `${this.branch.name} is up to date`;
				tooltip = `${label} with ${this.status.upstream}`;
				if (!this.isReposView) {
					label += ` with ${this.status.upstream}`;
				}

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root ? ContextValues.StatusSameAsUpstream : undefined;
				icon = 'cloud';

				break;
			case 'none':
				label = `${this.branch.name} hasn't yet been published`;
				tooltip = label;

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root ? ContextValues.StatusNoUpstream : undefined;
				icon = 'cloud-upload';

				break;
		}

		const item = new TreeItem(label, collapsibleState);
		item.id = this.id;
		item.contextValue = contextValue;
		if (lastFetched) {
			item.description = `Last fetched ${Dates.getFormatter(new Date(lastFetched)).fromNow()}`;
			tooltip += `\n${item.description}`;
		}
		item.iconPath = new ThemeIcon(icon);
		item.tooltip = tooltip;

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
		if (this.upstreamType === 'same' || this.upstreamType === 'none') return undefined;

		if (this._log == null) {
			const range =
				this.upstreamType === 'ahead'
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
	async loadMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
