import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import type { ViewShowBranchComparison } from '../../config';
import type { Colors } from '../../constants';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { PullRequest, PullRequestState } from '../../git/models/pullRequest';
import type { GitBranchReference } from '../../git/models/reference';
import { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import type { GitUser } from '../../git/models/user';
import { getContext } from '../../system/context';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { Deferred } from '../../system/promise';
import { defer, getSettledValue } from '../../system/promise';
import { pad } from '../../system/string';
import { RemotesView } from '../remotesView';
import type { ViewsWithBranches } from '../viewBase';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { insertDateMarkers } from './helpers';
import { MergeStatusNode } from './mergeStatusNode';
import { PullRequestNode } from './pullRequestNode';
import { RebaseStatusNode } from './rebaseStatusNode';
import type { PageableViewNode, ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, ViewRefNode } from './viewNode';

type State = {
	pullRequest: PullRequest | null | undefined;
	pendingPullRequest: Promise<PullRequest | undefined> | undefined;
};

export class BranchNode extends ViewRefNode<ViewsWithBranches, GitBranchReference, State> implements PageableViewNode {
	limit: number | undefined;

	private readonly options: {
		expanded: boolean;
		limitCommits: boolean;
		showAsCommits: boolean;
		showComparison: false | ViewShowBranchComparison;
		showCurrent: boolean;
		showStatus: boolean;
		showTracking: boolean;
		authors?: GitUser[];
	};
	protected override splatted = true;

	constructor(
		uri: GitUri,
		view: ViewsWithBranches,
		public override parent: ViewNode,
		public readonly repo: Repository,
		public readonly branch: GitBranch,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
		options?: {
			expanded?: boolean;
			limitCommits?: boolean;
			showAsCommits?: boolean;
			showComparison?: false | ViewShowBranchComparison;
			showCurrent?: boolean;
			showStatus?: boolean;
			showTracking?: boolean;
			authors?: GitUser[];
		},
	) {
		super(uri, view, parent);

		this.updateContext({ repository: repo, branch: branch, root: root });
		this._uniqueId = getViewNodeId('branch', this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);

		this.options = {
			expanded: false,
			limitCommits: false,
			showAsCommits: false,
			showComparison: false,
			// Hide the current branch checkmark when the node is displayed as a root
			showCurrent: !this.root,
			// Don't show merge/rebase status info the node is displayed as a root
			showStatus: true, //!this.root,
			// Don't show tracking info the node is displayed as a root
			showTracking: !this.root,
			...options,
		};
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.branch.name;
	}

	compacted: boolean = false;

	get current(): boolean {
		return this.branch.current;
	}

	get label(): string {
		if (this.options.showAsCommits) return 'Commits';

		const branchName = this.branch.getNameWithoutRemote();
		return `${
			this.view.config.branches?.layout !== 'tree' ||
			this.compacted ||
			this.root ||
			this.current ||
			this.branch.detached ||
			this.branch.starred
				? branchName
				: this.branch.getBasename()
		}${this.branch.rebasing ? ' (Rebasing)' : ''}`;
	}

	get ref(): GitBranchReference {
		return this.branch;
	}

	get treeHierarchy(): string[] {
		return this.root || this.current || this.branch.detached || this.branch.starred
			? [this.branch.name]
			: this.branch.getNameWithoutRemote().split('/');
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const branch = this.branch;

			let onCompleted: Deferred<void> | undefined;
			let pullRequest;

			if (
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForBranches &&
				(branch.upstream != null || branch.remote) &&
				getContext('gitlens:hasConnectedRemotes')
			) {
				pullRequest = this.getState('pullRequest');
				if (pullRequest === undefined && this.getState('pendingPullRequest') === undefined) {
					onCompleted = defer<void>();
					const prPromise = this.getAssociatedPullRequest(
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
						if (pr != null && this._children != null) {
							this._children.splice(
								this._children[0] instanceof CompareBranchNode ? 1 : 0,
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
			] = await Promise.allSettled([
				this.getLog(),
				this.view.container.git.getBranchesAndTagsTipsFn(this.uri.repoPath, branch.name),
				this.options.showStatus && branch.current
					? this.view.container.git.getStatusForRepo(this.uri.repoPath)
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
								  })
								: undefined,
					  )
					: undefined,
			]);
			const log = getSettledValue(logResult);
			if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

			const children = [];

			if (this.options.showComparison !== false && !(this.view instanceof RemotesView)) {
				children.push(
					new CompareBranchNode(
						this.uri,
						this.view,
						this,
						branch,
						this.options.showComparison,
						this.splatted,
					),
				);
			}

			if (pullRequest != null) {
				children.push(new PullRequestNode(this.view, this, pullRequest, branch));
			}

			const status = getSettledValue(statusResult);
			const mergeStatus = getSettledValue(mergeStatusResult);
			const rebaseStatus = getSettledValue(rebaseStatusResult);

			if (this.options.showStatus && mergeStatus != null) {
				children.push(
					new MergeStatusNode(
						this.view,
						this,
						branch,
						mergeStatus,
						status ?? (await this.view.container.git.getStatusForRepo(this.uri.repoPath)),
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
						status ?? (await this.view.container.git.getStatusForRepo(this.uri.repoPath)),
						this.root,
					),
				);
			} else if (this.options.showTracking) {
				const status = {
					ref: branch.ref,
					repoPath: branch.repoPath,
					state: branch.state,
					upstream: branch.upstream?.name,
				};

				if (branch.upstream != null) {
					if (this.root && !status.state.behind && !status.state.ahead) {
						children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'same', this.root));
					} else {
						if (status.state.behind) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, branch, status, 'behind', this.root),
							);
						}

						if (status.state.ahead) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, branch, status, 'ahead', this.root),
							);
						}
					}
				} else {
					children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'none', this.root));
				}
			}

			if (children.length !== 0) {
				children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
			}

			const unpublishedCommits = getSettledValue(unpublishedCommitsResult);
			const getBranchAndTagTips = getSettledValue(getBranchAndTagTipsResult);

			children.push(
				...insertDateMarkers(
					map(
						log.commits.values(),
						c =>
							new CommitNode(
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

			this._children = children;
			setTimeout(() => onCompleted?.fulfill(), 1);
		}

		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		this.splatted = false;

		let tooltip: string | MarkdownString = `${
			this.current ? 'Current branch' : 'Branch'
		} $(git-branch) ${this.branch.getNameWithoutRemote()}${this.branch.rebasing ? ' (Rebasing)' : ''}`;

		let contextValue: string = ContextValues.Branch;
		if (this.current) {
			contextValue += '+current';
		}
		if (this.branch.remote) {
			contextValue += '+remote';
		}
		if (this.branch.starred) {
			contextValue += '+starred';
		}
		if (this.branch.upstream != null && !this.branch.upstream.missing) {
			contextValue += '+tracking';
		}
		if (this.options.showAsCommits) {
			contextValue += '+commits';
		}
		// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
		if (this.repo.closed) {
			contextValue += '+closed';
		}

		let color: ThemeColor | undefined;
		let description;
		let iconSuffix = '';
		if (!this.branch.remote) {
			if (this.branch.upstream != null) {
				let arrows = GlyphChars.Dash;

				const remote = await this.branch.getRemote();
				if (!this.branch.upstream.missing) {
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

				description = this.options.showAsCommits
					? `${this.branch.getTrackingStatus({
							suffix: pad(GlyphChars.Dot, 1, 1),
					  })}${this.branch.getNameWithoutRemote()}${this.branch.rebasing ? ' (Rebasing)' : ''}${pad(
							arrows,
							2,
							2,
					  )}${this.branch.upstream.name}`
					: `${this.branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${
							GlyphChars.Space
					  } ${this.branch.upstream.name}`;

				tooltip += ` is ${this.branch.getTrackingStatus({
					empty: this.branch.upstream.missing
						? `missing upstream $(git-branch) ${this.branch.upstream.name}`
						: `up to date with $(git-branch)  ${this.branch.upstream.name}${
								remote?.provider?.name ? ` on ${remote.provider.name}` : ''
						  }`,
					expand: true,
					icons: true,
					separator: ', ',
					suffix: ` $(git-branch) ${this.branch.upstream.name}${
						remote?.provider?.name ? ` on ${remote.provider.name}` : ''
					}`,
				})}`;

				if (this.branch.state.ahead || this.branch.state.behind) {
					if (this.branch.state.ahead) {
						contextValue += '+ahead';
						color = new ThemeColor('gitlens.unpublishedChangesIconColor' satisfies Colors);
						iconSuffix = '-green';
					}
					if (this.branch.state.behind) {
						contextValue += '+behind';
						color = new ThemeColor('gitlens.unpulledChangesIconColor' satisfies Colors);
						iconSuffix = this.branch.state.ahead ? '-yellow' : '-red';
					}
				}
			} else {
				const providers = GitRemote.getHighlanderProviders(
					await this.view.container.git.getRemotesWithProviders(this.branch.repoPath),
				);
				const providerName = providers?.length ? providers[0].name : undefined;

				tooltip += ` hasn't been published to ${providerName ?? 'a remote'}`;
			}
		}

		if (this.branch.date != null) {
			description = `${description ? `${description}${pad(GlyphChars.Dot, 2, 2)}` : ''}${
				this.branch.formattedDate
			}`;

			tooltip += `\n\nLast commit ${this.branch.formatDateFromNow()} (${this.branch.formatDate(
				this.view.container.BranchDateFormatting.dateFormat,
			)})`;
		}

		tooltip = new MarkdownString(tooltip, true);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		if (this.branch.starred) {
			tooltip.appendMarkdown('\\\n$(star-full) Favorited');
		}

		const pendingPullRequest = this.getState('pendingPullRequest');
		if (pendingPullRequest != null) {
			tooltip.appendMarkdown(`\n\n$(loading~spin) Loading associated pull request${GlyphChars.Ellipsis}`);
		}

		const item = new TreeItem(
			this.label,
			this.options.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = contextValue;
		item.description = description;
		item.iconPath =
			pendingPullRequest != null
				? new ThemeIcon('loading~spin')
				: this.options.showAsCommits
				? new ThemeIcon('git-commit', color)
				: {
						dark: this.view.container.context.asAbsolutePath(`images/dark/icon-branch${iconSuffix}.svg`),
						light: this.view.container.context.asAbsolutePath(`images/light/icon-branch${iconSuffix}.svg`),
				  };
		item.tooltip = tooltip;
		item.resourceUri = Uri.parse(
			`gitlens-view://branch/status/${await this.branch.getStatus()}${
				this.options.showCurrent && this.current ? '/current' : ''
			}`,
		);

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

	@gate()
	@debug()
	override refresh(reset?: boolean) {
		this._children = undefined;
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
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		this._children = undefined;
		void this.triggerChange(false);
	}
}
