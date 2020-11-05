'use strict';
import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatusFilesNode } from './branchTrackingStatusFilesNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode } from './common';
import { Container } from '../../container';
import { GitBranch, GitLog, GitRemote, GitRevision, GitTrackingState } from '../../git/git';
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
		return `${BranchNode.getId(repoPath, name, root)}${this.key}(${upstream ?? ''}):${upstreamType}`;
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

		const children = [];
		if (!this.isReposView && this.status.upstream && this.upstreamType === 'ahead' && this.status.state.ahead > 0) {
			// TODO@eamodio fix this
			children.push(
				...(await new BranchTrackingStatusFilesNode(
					this.view,
					this,
					this.branch,
					this.status as Required<BranchTrackingStatus>,
					this.upstreamType,
					this.root,
				).getChildren()),
			);
		} else {
			children.push(
				...insertDateMarkers(
					Iterables.map(
						commits,
						c => new CommitNode(this.view, this, c, this.upstreamType === 'ahead', this.branch),
					),
					this,
					1,
				),
			);

			if (log.hasMore) {
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}
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
		let description;
		let collapsibleState;
		let contextValue;
		let icon;
		let tooltip;
		switch (this.upstreamType) {
			case 'ahead': {
				const remote = await this.branch.getRemote();

				label = `Changes to push to ${remote?.name ?? GitBranch.getRemote(this.status.upstream!)}${
					remote?.provider?.name ? ` on ${remote?.provider.name}` : ''
				}`;
				description = Strings.pluralize('commit', this.status.state.ahead);
				tooltip = `Branch ${this.branch.name} is ${Strings.pluralize(
					'commit',
					this.status.state.ahead,
				)} ahead of ${this.status.upstream}${remote?.provider?.name ? ` on ${remote.provider.name}` : ''}`;

				// collapsibleState = !this.isReposView
				// 	? TreeItemCollapsibleState.Expanded
				// 	: TreeItemCollapsibleState.Collapsed;
				collapsibleState = TreeItemCollapsibleState.Collapsed;
				contextValue = this.root
					? ContextValues.StatusAheadOfUpstream
					: ContextValues.BranchStatusAheadOfUpstream;
				icon = new ThemeIcon('cloud-upload', new ThemeColor('gitlens.viewChangesToPushIconColor'));

				break;
			}
			case 'behind': {
				const remote = await this.branch.getRemote();

				label = `Changes to pull from ${remote?.name ?? GitBranch.getRemote(this.status.upstream!)}${
					remote?.provider?.name ? ` on ${remote.provider.name}` : ''
				}`;
				description = Strings.pluralize('commit', this.status.state.behind);
				tooltip = `Branch ${this.branch.name} is ${Strings.pluralize(
					'commit',
					this.status.state.behind,
				)} behind ${this.status.upstream}${remote?.provider?.name ? ` on ${remote.provider.name}` : ''}`;

				collapsibleState = TreeItemCollapsibleState.Collapsed;
				contextValue = this.root
					? ContextValues.StatusBehindUpstream
					: ContextValues.BranchStatusBehindUpstream;
				icon = new ThemeIcon('cloud-download', new ThemeColor('gitlens.viewChangesToPullIconColor'));

				break;
			}
			case 'same': {
				const remote = await this.branch.getRemote();

				label = `Up to date with ${remote?.name ?? GitBranch.getRemote(this.status.upstream!)}${
					remote?.provider?.name ? ` on ${remote.provider.name}` : ''
				}`;
				description = `Last fetched ${Dates.getFormatter(new Date(lastFetched)).fromNow()}`;
				tooltip = `Branch ${this.branch.name} is up to date with ${this.status.upstream}${
					remote?.provider?.name ? ` on ${remote.provider.name}` : ''
				}`;

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root ? ContextValues.StatusSameAsUpstream : undefined;
				icon = new ThemeIcon('cloud');

				break;
			}
			case 'none': {
				const providers = GitRemote.getHighlanderProviders(
					await Container.git.getRemotes(this.branch.repoPath),
				);
				const providerName = providers?.length ? providers[0].name : undefined;

				label = `Publish ${this.branch.name} to ${providerName ?? 'a remote'}`;
				tooltip = `Branch ${this.branch.name} hasn't been published to ${providerName ?? 'a remote'}`;

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root ? ContextValues.StatusNoUpstream : undefined;
				icon = new ThemeIcon('cloud-upload', new ThemeColor('gitlens.viewChangesToPushIconColor'));

				break;
			}
		}

		const item = new TreeItem(label, collapsibleState);
		item.id = this.id;
		item.contextValue = contextValue;
		item.description = description;
		if (lastFetched) {
			tooltip += `\nLast fetched ${Dates.getFormatter(new Date(lastFetched)).fromNow()}`;
		}
		item.iconPath = icon;
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
	@gate()
	async loadMore(limit?: number | { until?: any }) {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
