import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { Colors } from '../../constants.colors';
import type { FilesComparison } from '../../git/actions/commit';
import { GitUri } from '../../git/gitUri';
import type { GitBranch, GitTrackingUpstream } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { GitRemote } from '../../git/models/remote';
import { getRemoteNameFromBranchName } from '../../git/utils/branch.utils';
import { getHighlanderProviders } from '../../git/utils/remote.utils';
import { createRevisionRange } from '../../git/utils/revision.utils';
import { getUpstreamStatus } from '../../git/utils/status.utils';
import { fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { first, last, map } from '../../system/iterable';
import { pluralize } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { BranchTrackingStatusFilesNode } from './branchTrackingStatusFilesNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode } from './common';
import { insertDateMarkers } from './utils/-webview/node.utils';

export interface BranchTrackingStatus {
	ref: string;
	repoPath: string;
	upstream?: GitTrackingUpstream;
}

export class BranchTrackingStatusNode
	extends ViewNode<'tracking-status', ViewsWithCommits>
	implements PageableViewNode
{
	limit: number | undefined;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: BranchTrackingStatus,
		public readonly upstreamType: 'ahead' | 'behind' | 'same' | 'missing' | 'none',
		// Specifies that the node is shown as a root
		public readonly root: boolean = false,
		private readonly options?: {
			showAheadCommits?: boolean;
			unpublishedCommits?: Set<string>;
		},
	) {
		super('tracking-status', GitUri.fromRepoPath(status.repoPath), view, parent);

		this.updateContext({
			branch: branch,
			branchStatus: status,
			branchStatusUpstreamType: upstreamType,
			root: root,
		});
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getFilesComparison(): Promise<FilesComparison | undefined> {
		// if we are ahead we don't actually add the files node, just each of its children individually
		if (this.upstreamType === 'ahead') {
			const node = new BranchTrackingStatusFilesNode(
				this.view,
				this,
				this.branch,
				this.status as Required<BranchTrackingStatus>,
				this.upstreamType,
			);

			const comparison = await node?.getFilesComparison();
			if (comparison == null) return undefined;

			// Get the oldest unpublished (unpushed) commit
			const ref = this.options?.unpublishedCommits != null ? last(this.options.unpublishedCommits) : undefined;
			if (ref == null) return undefined;

			const resolved = await this.view.container.git
				.getRepositoryService(this.repoPath)
				.revision.resolveRevision(`${ref}^`);
			return {
				...comparison,
				ref1: resolved.sha,
				ref2: comparison.ref1,
				title: `Changes to push to ${comparison.ref2}`,
			};
		}

		const children = await this.getChildren();
		const node = children.find(c => c.is('tracking-status-files'));
		return node?.getFilesComparison();
	}

	async getChildren(): Promise<ViewNode[]> {
		if (
			this.status.upstream == null ||
			this.upstreamType === 'same' ||
			this.upstreamType === 'missing' ||
			this.upstreamType === 'none'
		) {
			return [];
		}

		const log = await this.getLog();
		if (log == null) return [];

		let commits;
		if (this.upstreamType === 'ahead') {
			// Since the last commit when we are looking 'ahead' can have no previous (because of the range given) -- look it up
			commits = [...log.commits.values()];
			const commit = commits[commits.length - 1];
			const previousSha = await commit.getPreviousSha();
			if (previousSha == null) {
				const previousLog = await this.view.container.git
					.getRepositoryService(this.uri.repoPath!)
					.commits.getLog(commit.sha, { limit: 1 });
				if (previousLog != null) {
					commits[commits.length - 1] = first(previousLog.commits.values())!;
				}
			}
		} else {
			commits = log.commits.values();
		}

		const children = [];

		let showFiles = true;
		if (!this.options?.showAheadCommits && this.upstreamType === 'ahead' && this.status.upstream.state.ahead) {
			showFiles = false;
			// TODO@eamodio fix this
			children.push(
				...(await new BranchTrackingStatusFilesNode(
					this.view,
					this,
					this.branch,
					this.status as Required<BranchTrackingStatus>,
					this.upstreamType,
				).getChildren()),
			);
		} else {
			children.push(
				...insertDateMarkers(
					map(commits, c => new CommitNode(this.view, this, c, this.upstreamType === 'ahead', this.branch)),
					this,
					1,
				),
			);

			if (log.hasMore) {
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}
		}

		if (showFiles) {
			children.unshift(
				new BranchTrackingStatusFilesNode(
					this.view,
					this,
					this.branch,
					this.status as Required<BranchTrackingStatus>,
					this.upstreamType,
				),
			);
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let lastFetched = 0;

		if (this.upstreamType !== 'missing' && this.upstreamType !== 'none') {
			const repo = this.view.container.git.getRepository(this.repoPath);
			lastFetched = (await repo?.getLastFetched()) ?? 0;
		}

		function getBranchStatus(this: BranchTrackingStatusNode, remote: GitRemote | undefined) {
			return `$(git-branch) \`${this.branch.name}\` is ${getUpstreamStatus(this.status.upstream, {
				empty: this.status.upstream!.missing
					? `missing upstream $(git-branch) \`${this.status.upstream!.name}\``
					: `up to date with $(git-branch) \`${this.status.upstream!.name}\`${
							remote?.provider?.name ? ` on ${remote.provider.name}` : ''
						}`,
				expand: true,
				icons: true,
				separator: ', ',
				suffix: ` $(git-branch) \`${this.status.upstream!.name}\`${
					remote?.provider?.name ? ` on ${remote.provider.name}` : ''
				}`,
			})}`;
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

				label = 'Outgoing';
				description = `${pluralize('commit', this.status.upstream!.state.ahead)} to push to ${
					remote?.name ?? getRemoteNameFromBranchName(this.status.upstream!.name)
				}`;
				tooltip = `${pluralize('commit', this.status.upstream!.state.ahead)} to push to \`${
					this.status.upstream!.name
				}\`${remote?.provider?.name ? ` on ${remote?.provider.name}` : ''}\\\n${getBranchStatus.call(
					this,
					remote,
				)}`;

				collapsibleState = TreeItemCollapsibleState.Collapsed;
				contextValue = this.root
					? ContextValues.StatusAheadOfUpstream
					: ContextValues.BranchStatusAheadOfUpstream;
				icon = new ThemeIcon(
					'cloud-upload',
					new ThemeColor('gitlens.unpublishedChangesIconColor' satisfies Colors),
				);

				break;
			}
			case 'behind': {
				const remote = await this.branch.getRemote();

				label = 'Incoming';
				description = `${pluralize('commit', this.status.upstream!.state.behind)} to pull from ${
					remote?.name ?? getRemoteNameFromBranchName(this.status.upstream!.name)
				}`;
				tooltip = `${pluralize('commit', this.status.upstream!.state.behind)} to pull from \`${
					this.status.upstream!.name
				}\`${remote?.provider?.name ? ` on ${remote.provider.name}` : ''}\\\n${getBranchStatus.call(
					this,
					remote,
				)}`;

				collapsibleState = TreeItemCollapsibleState.Collapsed;
				contextValue = this.root
					? ContextValues.StatusBehindUpstream
					: ContextValues.BranchStatusBehindUpstream;
				icon = new ThemeIcon(
					'cloud-download',
					new ThemeColor('gitlens.unpulledChangesIconColor' satisfies Colors),
				);

				break;
			}
			case 'same': {
				const remote = await this.branch.getRemote();

				label = `Up to date with ${remote?.name ?? getRemoteNameFromBranchName(this.status.upstream!.name)}${
					remote?.provider?.name ? ` on ${remote.provider.name}` : ''
				}`;
				description = lastFetched ? fromNow(lastFetched) : '';
				tooltip = getBranchStatus.call(this, remote);

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root
					? ContextValues.StatusSameAsUpstream
					: ContextValues.BranchStatusSameAsUpstream;
				icon = new ThemeIcon('cloud');

				break;
			}
			case 'missing': {
				const remote = await this.branch.getRemote();

				label = `Missing upstream branch${remote?.provider?.name ? ` on ${remote.provider.name}` : ''}`;
				description = this.status.upstream!.name;
				tooltip = getBranchStatus.call(this, remote);

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root
					? ContextValues.StatusMissingUpstream
					: ContextValues.BranchStatusSameAsUpstream;
				icon = new ThemeIcon(
					'warning',
					new ThemeColor('gitlens.decorations.branchMissingUpstreamForegroundColor' satisfies Colors),
				);

				break;
			}
			case 'none': {
				const remotes = await this.view.container.git
					.getRepositoryService(this.branch.repoPath)
					.remotes.getRemotesWithProviders();
				const providers = getHighlanderProviders(remotes);
				const providerName = providers?.length ? providers[0].name : undefined;

				label = `Publish ${this.branch.name} to ${providerName ?? 'a remote'}`;
				tooltip = `\`${this.branch.name}\` hasn't been published to ${providerName ?? 'a remote'}`;

				collapsibleState = TreeItemCollapsibleState.None;
				contextValue = this.root ? ContextValues.StatusNoUpstream : ContextValues.BranchStatusNoUpstream;
				icon = new ThemeIcon(
					'cloud-upload',
					remotes.length ? new ThemeColor('gitlens.unpublishedChangesIconColor' satisfies Colors) : undefined,
				);

				break;
			}
		}

		const item = new TreeItem(label, collapsibleState);
		item.id = this.id;
		item.contextValue = contextValue;
		item.description = description;
		if (lastFetched) {
			tooltip += `\n\nLast fetched ${fromNow(lastFetched)}`;
		}
		item.iconPath = icon;

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

		return item;
	}

	@debug()
	override refresh(reset?: boolean): void {
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
					? createRevisionRange(this.status.upstream?.name, this.status.ref, '..')
					: createRevisionRange(this.status.ref, this.status.upstream?.name, '..');

			this._log = await this.view.container.git
				.getRepositoryService(this.uri.repoPath!)
				.commits.getLog(range, { limit: this.limit ?? this.view.config.defaultItemLimit });
		}

		return this._log;
	}

	get hasMore(): boolean {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }): Promise<void> {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (!log?.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
