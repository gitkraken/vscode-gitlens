import { l10n, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitBranch, GitTrackingUpstream } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { getHighlanderProviders } from '@gitlens/git/utils/remote.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { getUpstreamStatus } from '@gitlens/git/utils/status.utils.js';
import { fromNow } from '@gitlens/utils/date.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { getRemoteNameFromBranchName } from '@gitlens/utils/gitRefs.js';
import { first, last, map } from '@gitlens/utils/iterable.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Colors } from '../../constants.colors.js';
import type { FilesComparison } from '../../git/actions/commit.js';
import { GitUri } from '../../git/gitUri.js';
import { getBranchRemote } from '../../git/utils/-webview/branch.utils.js';
import { gate } from '../../system/decorators/gate.js';
import type { ViewsWithCommits } from '../viewBase.js';
import type { PageableViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import { BranchTrackingStatusFilesNode } from './branchTrackingStatusFilesNode.js';
import { CommitNode } from './commitNode.js';
import { LoadMoreNode } from './common.js';
import { insertDateMarkers } from './utils/-webview/node.utils.js';

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
				title: l10n.t('Changes to push to {0}', comparison.ref2),
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
			const commit = commits.at(-1)!;
			const previousSha = await GitCommit.getPreviousSha(commit);
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
				children.push(new LoadMoreNode(this.view, this, children.at(-1)!));
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
			const branch = `$(git-branch) \`${this.branch.name}\``;
			const upstream = `$(git-branch) \`${this.status.upstream!.name}\``;
			const provider = remote?.provider?.name;
			const status = getUpstreamStatus(this.status.upstream, {
				empty: this.status.upstream!.missing
					? provider
						? l10n.t('missing upstream {upstream} on {provider}', {
								upstream: upstream,
								provider: provider,
							})
						: l10n.t('missing upstream {upstream}', { upstream: upstream })
					: provider
						? l10n.t('up to date with {upstream} on {provider}', {
								upstream: upstream,
								provider: provider,
							})
						: l10n.t('up to date with {upstream}', { upstream: upstream }),
				expand: true,
				icons: true,
				provider: provider,
				separator: ', ',
				upstream: upstream,
			});
			return l10n.t('{branch} is {status}', { branch: branch, status: status });
		}

		let label;
		let description;
		let collapsibleState;
		let contextValue;
		let icon;
		let tooltip;
		switch (this.upstreamType) {
			case 'ahead': {
				const remote = await getBranchRemote(this.view.container, this.branch);
				const count = this.status.upstream!.state.ahead;
				const remoteName = remote?.name ?? getRemoteNameFromBranchName(this.status.upstream!.name);
				const providerName = remote?.provider?.name;
				const branchStatus = getBranchStatus.call(this, remote);

				label = l10n.t('Outgoing');
				description = formatPlural(
					l10n.t(
						'{count, plural, one{{count} commit to push to {remote}} other{{count} commits to push to {remote}}}',
					),
					{ count: count, remote: remoteName },
				);
				tooltip = providerName
					? formatPlural(
							l10n.t(
								'{count, plural, one{{count} commit to push to `{upstream}` on {provider}\\\n{status}} other{{count} commits to push to `{upstream}` on {provider}\\\n{status}}}',
							),
							{
								count: count,
								upstream: this.status.upstream!.name,
								provider: providerName,
								status: branchStatus,
							},
						)
					: formatPlural(
							l10n.t(
								'{count, plural, one{{count} commit to push to `{upstream}`\\\n{status}} other{{count} commits to push to `{upstream}`\\\n{status}}}',
							),
							{ count: count, upstream: this.status.upstream!.name, status: branchStatus },
						);

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
				const remote = await getBranchRemote(this.view.container, this.branch);
				const count = this.status.upstream!.state.behind;
				const remoteName = remote?.name ?? getRemoteNameFromBranchName(this.status.upstream!.name);
				const providerName = remote?.provider?.name;
				const branchStatus = getBranchStatus.call(this, remote);

				label = l10n.t('Incoming');
				description = formatPlural(
					l10n.t(
						'{count, plural, one{{count} commit to pull from {remote}} other{{count} commits to pull from {remote}}}',
					),
					{ count: count, remote: remoteName },
				);
				tooltip = providerName
					? formatPlural(
							l10n.t(
								'{count, plural, one{{count} commit to pull from `{upstream}` on {provider}\\\n{status}} other{{count} commits to pull from `{upstream}` on {provider}\\\n{status}}}',
							),
							{
								count: count,
								upstream: this.status.upstream!.name,
								provider: providerName,
								status: branchStatus,
							},
						)
					: formatPlural(
							l10n.t(
								'{count, plural, one{{count} commit to pull from `{upstream}`\\\n{status}} other{{count} commits to pull from `{upstream}`\\\n{status}}}',
							),
							{ count: count, upstream: this.status.upstream!.name, status: branchStatus },
						);

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
				const remote = await getBranchRemote(this.view.container, this.branch);

				const remoteName = remote?.name ?? getRemoteNameFromBranchName(this.status.upstream!.name);
				label = remote?.provider?.name
					? l10n.t('Up to date with {remote} on {provider}', {
							remote: remoteName,
							provider: remote.provider.name,
						})
					: l10n.t('Up to date with {remote}', { remote: remoteName });
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
				const remote = await getBranchRemote(this.view.container, this.branch);

				label = remote?.provider?.name
					? l10n.t('Missing upstream branch on {provider}', { provider: remote.provider.name })
					: l10n.t('Missing upstream branch');
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

				label = providerName
					? l10n.t('Publish {branch} to {provider}', { branch: this.branch.name, provider: providerName })
					: l10n.t('Publish {branch} to a remote', { branch: this.branch.name });
				tooltip = providerName
					? l10n.t("`{branch}` hasn't been published to {provider}", {
							branch: this.branch.name,
							provider: providerName,
						})
					: l10n.t("`{branch}` hasn't been published to a remote", { branch: this.branch.name });

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
			tooltip += `\n\n${l10n.t('Last fetched {0}', fromNow(lastFetched))}`;
		}
		item.iconPath = icon;

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

		return item;
	}

	@trace()
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
