import type { Uri } from 'vscode';
import { Disposable, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import type { ViewShowBranchComparison } from '../../config';
import { GlyphChars } from '../../constants';
import type { Colors } from '../../constants.colors';
import type { Container } from '../../container';
import type { GitUri } from '../../git/gitUri';
import { unknownGitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import { getTargetBranchName } from '../../git/models/branch.utils';
import { isStash } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import type { PullRequest, PullRequestState } from '../../git/models/pullRequest';
import type { GitBranchReference } from '../../git/models/reference';
import { getHighlanderProviders } from '../../git/models/remote';
import { Repository } from '../../git/models/repository';
import type { GitUser } from '../../git/models/user';
import type { GitWorktree } from '../../git/models/worktree';
import { getBranchIconPath, getRemoteIconPath, getWorktreeBranchIconPath } from '../../git/utils/icons';
import { fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { log } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { weakEvent } from '../../system/event';
import { disposableInterval } from '../../system/function';
import { map } from '../../system/iterable';
import type { Deferred } from '../../system/promise';
import { defer, getSettledValue } from '../../system/promise';
import { pad } from '../../system/string';
import { getContext } from '../../system/vscode/context';
import type { View, ViewsWithBranches } from '../viewBase';
import { disposeChildren } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ViewRefNode } from './abstract/viewRefNode';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { insertDateMarkers } from './helpers';
import { MergeStatusNode } from './mergeStatusNode';
import { PullRequestNode } from './pullRequestNode';
import { RebaseStatusNode } from './rebaseStatusNode';
import { StashNode } from './stashNode';

type State = {
	pullRequest: PullRequest | null | undefined;
	pendingPullRequest: Promise<PullRequest | undefined> | undefined;
};

type Options = {
	expand: boolean;
	limitCommits: boolean;
	showAsCommits: boolean;
	showComparison: false | ViewShowBranchComparison;
	showStatusDecorationOnly: boolean;
	showMergeCommits?: boolean;
	showStashes: boolean;
	showStatus: boolean;
	showTracking: boolean;
	authors?: GitUser[];
};

export class BranchNode
	extends ViewRefNode<'branch', ViewsWithBranches, GitBranchReference, State>
	implements PageableViewNode
{
	limit: number | undefined;

	private readonly options: Options;
	protected override splatted = true;

	constructor(
		uri: GitUri,
		view: ViewsWithBranches,
		public override parent: ViewNode,
		public readonly repo: Repository,
		public readonly branch: GitBranch,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
		options?: Partial<Options>,
	) {
		super('branch', uri, view, parent);

		this.updateContext({ repository: repo, branch: branch, root: root });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);

		this.options = {
			expand: false,
			limitCommits: false,
			showAsCommits: false,
			showComparison: false,
			showStashes: false,
			// Only show status decorations when the node is displayed as a root
			showStatusDecorationOnly: this.root,
			// Don't show merge/rebase status info the node is displayed as a root
			showStatus: true, //!this.root,
			// Don't show tracking info the node is displayed as a root
			showTracking: !this.root,
			...options,
		};
	}

	override dispose() {
		super.dispose();
		this.children = undefined;
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.branch.name;
	}

	private get avoidCompacting(): boolean {
		return this.root || this.current || this.worktree?.opened || this.branch.detached || this.branch.starred;
	}

	compacted: boolean = false;

	get current(): boolean {
		return this.branch.current;
	}

	get ref(): GitBranchReference {
		return this.branch;
	}

	get treeHierarchy(): string[] {
		return this.avoidCompacting ? [this.branch.name] : this.branch.getNameWithoutRemote().split('/');
	}

	@memoize()
	get worktree(): GitWorktree | undefined {
		const worktree = this.context.worktreesByBranch?.get(this.branch.id);
		return worktree?.isDefault ? undefined : worktree;
	}

	private _children: ViewNode[] | undefined;
	protected get children(): ViewNode[] | undefined {
		return this._children;
	}
	protected set children(value: ViewNode[] | undefined) {
		if (this._children === value) return;

		disposeChildren(this._children, value);
		this._children = value;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const branch = this.branch;

			let onCompleted: Deferred<void> | undefined;
			let pullRequest;
			let pullRequestInsertIndex = 0;

			let comparison: CompareBranchNode | undefined;
			let loadComparisonDefaultCompareWith = false;
			if (this.options.showComparison !== false && this.view.type !== 'remotes') {
				comparison = new CompareBranchNode(
					this.uri,
					this.view,
					this,
					branch,
					this.options.showComparison,
					this.splatted,
				);
				loadComparisonDefaultCompareWith = comparison.compareWith == null;
			}

			let prPromise: Promise<PullRequest | undefined> | undefined;
			if (
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForBranches &&
				(branch.upstream != null || branch.remote) &&
				getContext('gitlens:repos:withHostingIntegrationsConnected')?.includes(branch.repoPath)
			) {
				pullRequest = this.getState('pullRequest');
				if (pullRequest === undefined && this.getState('pendingPullRequest') === undefined) {
					onCompleted = defer<void>();
					prPromise = this.getAssociatedPullRequest(
						branch,
						this.root ? { include: ['opened', 'merged'] } : undefined,
					);

					queueMicrotask(async () => {
						await onCompleted?.promise;

						// If we are waiting too long, refresh this node to show a spinner while the pull request is loading
						let spinner = false;
						const timeout = setTimeout(() => {
							spinner = true;
							this.view.triggerNodeChange(this);
						}, 250);

						const pr = await prPromise;
						clearTimeout(timeout);

						// If we found a pull request, insert it into the children cache (if loaded) and refresh the node
						if (pr != null && this.children != null) {
							this.children.splice(
								pullRequestInsertIndex,
								0,
								new PullRequestNode(this.view, this, pr, branch),
							);
						}

						// Refresh this node to add the pull request node or remove the spinner
						if (spinner || pr != null) {
							this.view.triggerNodeChange(this.root ? this.parent ?? this : this);
						}
					});
				}
			}

			const [
				logResult,
				getBranchAndTagTipsResult,
				statusResult,
				mergeStatusResult,
				rebaseStatusResult,
				unpublishedCommitsResult,
				baseResult,
				targetResult,
			] = await Promise.allSettled([
				this.getLog(),
				this.view.container.git.getBranchesAndTagsTipsLookup(this.uri.repoPath, branch.name),
				this.options.showStatus && branch.current
					? this.view.container.git.getStatus(this.uri.repoPath)
					: undefined,
				this.options.showStatus && branch.current
					? this.view.container.git.getMergeStatus(this.uri.repoPath!)
					: undefined,
				this.options.showStatus ? this.view.container.git.getRebaseStatus(this.uri.repoPath!) : undefined,
				!branch.remote
					? this.view.container.git.getBranchAheadRange(branch).then(range =>
							range
								? this.view.container.git.getLogRefsOnly(this.uri.repoPath!, {
										limit: 0,
										ref: range,
										merges: this.options.showMergeCommits,
								  })
								: undefined,
					  )
					: undefined,
				loadComparisonDefaultCompareWith
					? this.view.container.git.getBaseBranchName(this.branch.repoPath, this.branch.name)
					: undefined,
				loadComparisonDefaultCompareWith
					? getTargetBranchName(this.view.container, this.branch, {
							associatedPullRequest: prPromise,
							timeout: 100,
					  })
					: undefined,
			]);
			const log = getSettledValue(logResult);
			if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

			const children = [];

			const status = getSettledValue(statusResult);
			const mergeStatus = getSettledValue(mergeStatusResult);
			const rebaseStatus = getSettledValue(rebaseStatusResult);
			const unpublishedCommits = getSettledValue(unpublishedCommitsResult);

			if (pullRequest != null) {
				children.push(new PullRequestNode(this.view, this, pullRequest, branch));
			}

			if (this.options.showStatus && mergeStatus != null) {
				children.push(
					new MergeStatusNode(
						this.view,
						this,
						branch,
						mergeStatus,
						status ?? (await this.view.container.git.getStatus(this.uri.repoPath)),
						this.root,
					),
				);
			} else if (
				this.options.showStatus &&
				rebaseStatus != null &&
				(branch.current || branch.name === rebaseStatus.incoming.name)
			) {
				children.push(
					new RebaseStatusNode(
						this.view,
						this,
						branch,
						rebaseStatus,
						status ?? (await this.view.container.git.getStatus(this.uri.repoPath)),
						this.root,
					),
				);
			} else if (this.options.showTracking) {
				const status = {
					ref: branch.ref,
					repoPath: branch.repoPath,
					state: branch.state,
					upstream: branch.upstream,
				};

				if (branch.upstream != null) {
					if (this.root && branch.upstream.missing) {
						children.push(
							new BranchTrackingStatusNode(this.view, this, branch, status, 'missing', this.root),
						);
					} else if (this.root && !status.state.behind && !status.state.ahead) {
						children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'same', this.root));
					} else {
						if (status.state.behind) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, branch, status, 'behind', this.root),
							);
						}

						if (status.state.ahead) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, branch, status, 'ahead', this.root, {
									unpublishedCommits: unpublishedCommits,
								}),
							);
						}
					}
				} else if (!branch.detached) {
					children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'none', this.root));
				}
			}

			pullRequestInsertIndex = 0;

			if (comparison != null) {
				children.push(comparison);

				if (loadComparisonDefaultCompareWith) {
					const baseBranchName = getSettledValue(baseResult);
					const targetMaybeResult = getSettledValue(targetResult);

					let baseOrTargetBranchName: string | undefined;
					if (targetMaybeResult?.paused) {
						baseOrTargetBranchName = baseBranchName;
					} else {
						baseOrTargetBranchName = targetMaybeResult?.value ?? baseBranchName;
					}

					if (baseOrTargetBranchName != null) {
						void comparison.setDefaultCompareWith({
							ref: baseOrTargetBranchName,
							label: baseOrTargetBranchName,
							notation: '...',
							type: 'branch',
							checkedFiles: [],
						});
					}

					if (targetMaybeResult?.paused) {
						void targetMaybeResult.value.then(target => {
							if (target == null) return;

							void comparison.setDefaultCompareWith({
								ref: target,
								label: target,
								notation: '...',
								type: 'branch',
								checkedFiles: [],
							});
						});
					}
				}
			}

			if (children.length !== 0) {
				if (this.view.type === 'commits') {
					children.push(new CommitsCurrentBranchNode(this.view, this, this.branch));
				} else {
					children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
				}
			}

			const getBranchAndTagTips = getSettledValue(getBranchAndTagTipsResult);

			children.push(
				...insertDateMarkers(
					map(log.commits.values(), c =>
						isStash(c)
							? new StashNode(this.view, this, c, { icon: true })
							: new CommitNode(
									this.view,
									this,
									c,
									unpublishedCommits?.has(c.ref),
									branch,
									getBranchAndTagTips,
							  ),
					),
					this,
				),
			);

			if (log.hasMore) {
				children.push(
					new LoadMoreNode(this.view, this, children[children.length - 1], {
						getCount: () => this.view.container.git.getCommitCount(branch.repoPath, branch.name),
					}),
				);
			}

			this.children = children;
			setTimeout(() => onCompleted?.fulfill(), 1);
		}

		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		this.splatted = false;

		const parts = await getBranchNodeParts(this.view.container, this.branch, this.current, {
			avatars: this.view.config.avatars,
			pendingPullRequest: this.getState('pendingPullRequest'),
			showAsCommits: this.options.showAsCommits,
			showingLocalAndRemoteBranches: this.view.type === 'branches' && this.view.config.showRemoteBranches,
			showStatusDecorationOnly: this.options.showStatusDecorationOnly,
			useBaseNameOnly: !(this.view.config.branches?.layout !== 'tree' || this.compacted || this.avoidCompacting),
			worktree: this.worktree,
			worktreesByBranch: this.context.worktreesByBranch,
		});

		// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
		if (this.repo.closed) {
			parts.contextValue += '+closed';
		}

		const item = new TreeItem(
			parts.label,
			this.options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = parts.contextValue;
		item.description = parts.description;
		item.iconPath = parts.iconPath;
		item.resourceUri = parts.resourceUri;
		item.tooltip = parts.tooltip;

		return item;
	}

	@log()
	async star() {
		await this.branch.star();
		void this.view.refresh(true);
	}

	@log()
	async unstar() {
		await this.branch.unstar();
		void this.view.refresh(true);
	}

	override refresh(reset?: boolean) {
		void super.refresh?.(reset);

		this.children = undefined;
		if (reset) {
			this._log = undefined;
			this.deleteState();
		}
	}

	private async getAssociatedPullRequest(
		branch: GitBranch,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest | undefined> {
		let pullRequest = this.getState('pullRequest');
		if (pullRequest !== undefined) return Promise.resolve(pullRequest ?? undefined);

		let pendingPullRequest = this.getState('pendingPullRequest');
		if (pendingPullRequest == null) {
			pendingPullRequest = branch.getAssociatedPullRequest(options);
			this.storeState('pendingPullRequest', pendingPullRequest);

			pullRequest = await pendingPullRequest;
			this.storeState('pullRequest', pullRequest ?? null);
			this.deleteState('pendingPullRequest');

			return pullRequest;
		}

		return pendingPullRequest;
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log == null) {
			let limit =
				this.limit ??
				(this.root && !this.options.limitCommits
					? this.view.config.pageItemLimit
					: this.view.config.defaultItemLimit);
			// Try to show more commits if they are unpublished
			if (limit !== 0 && this.branch.state.ahead > limit) {
				limit = Math.min(this.branch.state.ahead + 1, limit * 2);
			}

			this._log = await this.view.container.git.getLog(this.uri.repoPath!, {
				limit: limit,
				ref: this.ref.ref,
				authors: this.options?.authors,
				merges: this.options?.showMergeCommits,
				stashes: this.options?.showStashes,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }) {
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

		this.children = undefined;
		void this.triggerChange(false);
	}
}

export async function getBranchNodeParts(
	container: Container,
	branch: GitBranch,
	current: boolean,
	options?: {
		avatars?: boolean;
		pendingPullRequest?: Promise<PullRequest | undefined> | undefined;
		showAsCommits?: boolean;
		showingLocalAndRemoteBranches?: boolean;
		showStatusDecorationOnly?: boolean;
		useBaseNameOnly: boolean;
		worktree?: GitWorktree;
		worktreesByBranch?: Map<string, GitWorktree>;
	},
): Promise<{
	label: string;
	description: string | undefined;
	tooltip: MarkdownString;
	contextValue: string;
	iconPath: IconPath;
	resourceUri: Uri | undefined;
}> {
	const status = branch.status;

	const suffixes = [];
	if (current) {
		if (branch.rebasing) {
			suffixes.push('rebasing');
		}
		suffixes.push('current branch');
	}
	if (options?.worktree) {
		if (options.worktree.opened && !current) {
			suffixes.push('in an opened worktree');
		} else {
			suffixes.push('in a worktree');
		}
	}

	let tooltip: string | MarkdownString = `$(git-branch) \`${branch.getNameWithoutRemote()}\`${
		suffixes.length ? ` \u00a0(_${suffixes.join(', ')}_)` : ''
	}`;

	let contextValue: string = ContextValues.Branch;
	let checkedout = false;
	if (current) {
		contextValue += '+current';
		checkedout = true;
	}
	if (branch.remote) {
		contextValue += '+remote';
	}
	if (branch.starred) {
		contextValue += '+starred';
	}
	if (branch.upstream != null && !branch.upstream.missing) {
		contextValue += '+tracking';
	}
	if (options?.showAsCommits) {
		contextValue += '+commits';
	}
	if (options?.worktree != null) {
		contextValue += '+worktree';
		checkedout = true;

		if (options.worktree.opened) {
			contextValue += '+opened';
		}
	} else if (options?.worktreesByBranch?.get(branch.id)?.isDefault) {
		checkedout = true;
	}
	if (checkedout) {
		contextValue += '+checkedout';
	}

	let iconColor: ThemeColor | undefined;
	let description;
	if (!branch.remote) {
		if (branch.upstream != null) {
			let arrows = GlyphChars.Dash;

			const remote = await branch.getRemote();
			if (!branch.upstream.missing) {
				if (remote != null) {
					let left;
					let right;
					for (const { type } of remote.urls) {
						if (type === 'fetch') {
							left = true;

							if (right) break;
						} else if (type === 'push') {
							right = true;

							if (left) break;
						}
					}

					if (left && right) {
						arrows = GlyphChars.ArrowsRightLeft;
					} else if (right) {
						arrows = GlyphChars.ArrowRight;
					} else if (left) {
						arrows = GlyphChars.ArrowLeft;
					}
				}
			} else {
				arrows = GlyphChars.Warning;
			}

			description = options?.showAsCommits
				? `${branch.getTrackingStatus({
						suffix: pad(GlyphChars.Dot, 1, 1),
				  })}${branch.getNameWithoutRemote()}${branch.rebasing ? ' (Rebasing)' : ''}${pad(arrows, 2, 2)}${
						branch.upstream.name
				  }`
				: `${branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${GlyphChars.Space} ${
						branch.upstream.name
				  }`;

			tooltip += `\n\nBranch is ${branch.getTrackingStatus({
				empty: `${branch.upstream.missing ? 'missing upstream' : 'up to date with'} \\\n $(git-branch) \`${
					branch.upstream.name
				}\`${remote?.provider?.name ? ` on ${remote.provider.name}` : ''}`,
				expand: true,
				icons: true,
				separator: ', ',
				suffix: `\\\n$(git-branch) \`${branch.upstream.name}\`${
					remote?.provider?.name ? ` on ${remote.provider.name}` : ''
				}`,
			})}`;

			switch (status) {
				case 'ahead':
					contextValue += '+ahead';
					iconColor = new ThemeColor('gitlens.decorations.branchAheadForegroundColor' satisfies Colors);
					break;
				case 'behind':
					contextValue += '+behind';
					iconColor = new ThemeColor('gitlens.decorations.branchBehindForegroundColor' satisfies Colors);
					break;
				case 'diverged':
					contextValue += '+ahead+behind';
					iconColor = new ThemeColor('gitlens.decorations.branchDivergedForegroundColor' satisfies Colors);
					break;
				case 'upToDate':
					iconColor = new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor' satisfies Colors);
					break;
			}
		} else {
			const providers = getHighlanderProviders(await container.git.getRemotesWithProviders(branch.repoPath));
			const providerName = providers?.length ? providers[0].name : undefined;

			tooltip += `\n\nLocal branch, hasn't been published to ${providerName ?? 'a remote'}`;
		}
	}

	if (branch.date != null) {
		description = `${description ? `${description}${pad(GlyphChars.Dot, 2, 2)}` : ''}${branch.formattedDate}`;

		tooltip += `\n\nLast commit ${branch.formatDateFromNow()} (${branch.formatDate(
			container.BranchDateFormatting.dateFormat,
		)})`;
	}

	tooltip = new MarkdownString(tooltip, true);
	tooltip.supportHtml = true;
	tooltip.isTrusted = true;

	if (branch.starred) {
		tooltip.appendMarkdown('\\\n$(star-full) Favorited');
	}

	if (options?.pendingPullRequest != null) {
		tooltip.appendMarkdown(`\n\n$(loading~spin) Loading associated pull request${GlyphChars.Ellipsis}`);
	}

	let label;
	if (options?.showAsCommits) {
		label = 'Commits';
	} else {
		const branchName = branch.getNameWithoutRemote();
		label = `${!options?.useBaseNameOnly ? branchName : branch.getBasename()}${
			branch.rebasing ? ' (Rebasing)' : ''
		}`;
	}

	let localUnpublished = false;
	if (status === 'local') {
		// If there are any remotes then say this is unpublished, otherwise local
		const remotes = await container.git.getRemotes(branch.repoPath);
		if (remotes.length) {
			localUnpublished = true;
		}
	}

	let iconPath: IconPath;
	if (options?.pendingPullRequest != null) {
		iconPath = new ThemeIcon('loading~spin');
	} else if (options?.showAsCommits) {
		iconPath = new ThemeIcon('git-commit', iconColor);
	} else if (options?.worktree != null) {
		iconPath = getWorktreeBranchIconPath(container, branch);
	} else if (branch.remote && options?.showingLocalAndRemoteBranches) {
		const remote = await branch.getRemote();
		iconPath = getRemoteIconPath(container, remote, { avatars: options?.avatars });
	} else {
		iconPath = getBranchIconPath(container, branch);
	}

	return {
		label: label,
		description: description,
		tooltip: tooltip,
		contextValue: contextValue,
		iconPath: iconPath,
		resourceUri: createViewDecorationUri('branch', {
			status: localUnpublished ? 'unpublished' : status,
			current: current,
			worktree: options?.worktree != null ? { opened: options.worktree.opened } : undefined,
			starred: branch.starred,
			showStatusOnly: options?.showStatusDecorationOnly,
		}),
	};
}

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class CommitsCurrentBranchNode extends SubscribeableViewNode<'commits-current-branch'> {
	private repo: Repository | undefined;

	constructor(
		view: View,
		parent: ViewNode,
		readonly branch: GitBranch,
	) {
		super('commits-current-branch', unknownGitUri, view, parent);

		this.repo = view.container.git.getRepository(branch.repoPath);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		const lastFetched = (await this.getLastFetched()) ?? 0;
		const context = `${this.branch.name}${
			lastFetched ? ` \u00a0\u2022\u00a0 fetched ${fromNow(new Date(lastFetched))}` : ''
		}`;

		const item = new TreeItem('', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.CommitsCurrentBranch;
		item.description = `\u2014\u00a0\u00a0 on ${context}`;
		item.tooltip = context;
		return item;
	}

	protected override etag(): number {
		return this.repo?.etag ?? 0;
	}

	private async getLastFetched(): Promise<number | undefined> {
		return this.branch.upstream?.missing || this.branch.detached ? undefined : this.repo?.getLastFetched();
	}

	protected async subscribe() {
		const lastFetched = (await this.getLastFetched()) ?? 0;

		const interval = Repository.getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			return Disposable.from(
				this.repo != null
					? weakEvent(this.repo.onDidChange, () => this.view.triggerNodeChange(this), this)
					: emptyDisposable,
				disposableInterval(() => {
					// Check if the interval should change, and if so, reset it
					if (interval !== Repository.getLastFetchedUpdateInterval(lastFetched)) {
						void this.resetSubscription();
					}

					this.view.triggerNodeChange(this);
				}, interval),
			);
		}

		return undefined;
	}
}
