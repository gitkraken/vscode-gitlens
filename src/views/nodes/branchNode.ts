import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { ViewBranchesLayout, ViewShowBranchComparison } from '../../configuration';
import { Colors, GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitUri } from '../../git/gitUri';
import {
	GitBranch,
	GitBranchReference,
	GitLog,
	GitRemote,
	GitRemoteType,
	GitUser,
	PullRequestState,
} from '../../git/models';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import { pad } from '../../system/string';
import { BranchesView } from '../branchesView';
import { CommitsView } from '../commitsView';
import { RemotesView } from '../remotesView';
import { RepositoriesView } from '../repositoriesView';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { insertDateMarkers } from './helpers';
import { MergeStatusNode } from './mergeStatusNode';
import { PullRequestNode } from './pullRequestNode';
import { RebaseStatusNode } from './rebaseStatusNode';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, PageableViewNode, ViewNode, ViewRefNode } from './viewNode';

export class BranchNode
	extends ViewRefNode<BranchesView | CommitsView | RemotesView | RepositoriesView, GitBranchReference>
	implements PageableViewNode
{
	static key = ':branch';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})${root ? ':root' : ''}`;
	}

	private _children: ViewNode[] | undefined;
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
		view: BranchesView | CommitsView | RemotesView | RepositoriesView,
		parent: ViewNode,
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

	override toClipboard(): string {
		return this.branch.name;
	}

	override get id(): string {
		return BranchNode.getId(this.branch.repoPath, this.branch.name, this.root);
	}

	compacted: boolean = false;

	get current(): boolean {
		return this.branch.current;
	}

	get label(): string {
		if (this.options.showAsCommits) return 'Commits';

		const branchName = this.branch.getNameWithoutRemote();
		return `${
			this.view.config.branches?.layout !== ViewBranchesLayout.Tree ||
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

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			let prPromise;
			if (
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForBranches &&
				(this.branch.upstream != null || this.branch.remote)
			) {
				prPromise = this.branch.getAssociatedPullRequest(
					this.root ? { include: [PullRequestState.Open, PullRequestState.Merged] } : undefined,
				);
			}

			const range = !this.branch.remote
				? await this.view.container.git.getBranchAheadRange(this.branch)
				: undefined;
			const [log, getBranchAndTagTips, status, mergeStatus, rebaseStatus, unpublishedCommits] = await Promise.all(
				[
					this.getLog(),
					this.view.container.git.getBranchesAndTagsTipsFn(this.uri.repoPath, this.branch.name),
					this.options.showStatus && this.branch.current
						? this.view.container.git.getStatusForRepo(this.uri.repoPath)
						: undefined,
					this.options.showStatus && this.branch.current
						? this.view.container.git.getMergeStatus(this.uri.repoPath!)
						: undefined,
					this.options.showStatus ? this.view.container.git.getRebaseStatus(this.uri.repoPath!) : undefined,
					range
						? this.view.container.git.getLogRefsOnly(this.uri.repoPath!, {
								limit: 0,
								ref: range,
						  })
						: undefined,
				],
			);
			if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

			const children = [];

			let prInsertIndex = 0;

			if (this.options.showComparison !== false && !(this.view instanceof RemotesView)) {
				prInsertIndex++;
				children.push(
					new CompareBranchNode(
						this.uri,
						this.view,
						this,
						this.branch,
						this.options.showComparison,
						this.splatted,
					),
				);
			}

			if (this.options.showStatus && mergeStatus != null) {
				children.push(
					new MergeStatusNode(
						this.view,
						this,
						this.branch,
						mergeStatus,
						status ?? (await this.view.container.git.getStatusForRepo(this.uri.repoPath)),
						this.root,
					),
				);
			} else if (
				this.options.showStatus &&
				rebaseStatus != null &&
				(this.branch.current || this.branch.name === rebaseStatus.incoming.name)
			) {
				children.push(
					new RebaseStatusNode(
						this.view,
						this,
						this.branch,
						rebaseStatus,
						status ?? (await this.view.container.git.getStatusForRepo(this.uri.repoPath)),
						this.root,
					),
				);
			} else if (this.options.showTracking) {
				const status = {
					ref: this.branch.ref,
					repoPath: this.branch.repoPath,
					state: this.branch.state,
					upstream: this.branch.upstream?.name,
				};

				if (this.branch.upstream != null) {
					if (this.root && !status.state.behind && !status.state.ahead) {
						children.push(
							new BranchTrackingStatusNode(this.view, this, this.branch, status, 'same', this.root),
						);
					} else {
						if (status.state.behind) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, this.branch, status, 'behind', this.root),
							);
						}

						if (status.state.ahead) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, this.branch, status, 'ahead', this.root),
							);
						}
					}
				} else {
					children.push(
						new BranchTrackingStatusNode(this.view, this, this.branch, status, 'none', this.root),
					);
				}
			}

			if (children.length !== 0) {
				children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
			}

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
								this.branch,
								getBranchAndTagTips,
							),
					),
					this,
				),
			);

			if (log.hasMore) {
				children.push(
					new LoadMoreNode(this.view, this, children[children.length - 1], {
						getCount: () => this.view.container.git.getCommitCount(this.branch.repoPath, this.branch.name),
					}),
				);
			}

			if (prPromise != null) {
				const pr = await prPromise;
				if (pr != null) {
					children.splice(prInsertIndex, 0, new PullRequestNode(this.view, this, pr, this.branch));
				}

				// const pr = await Promise.race([
				// 	prPromise,
				// 	new Promise<null>(resolve => setTimeout(() => resolve(null), 100)),
				// ]);
				// if (pr != null) {
				// 	children.splice(prInsertIndex, 0, new PullRequestNode(this.view, this, pr, this.branch));
				// } else if (pr === null) {
				// 	void prPromise.then(pr => {
				// 		if (pr == null) return;

				// 		void this.triggerChange();
				// 	});
				// }
			}

			this._children = children;
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
							if (type === GitRemoteType.Fetch) {
								left = true;

								if (right) break;
							} else if (type === GitRemoteType.Push) {
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
						color = new ThemeColor(Colors.UnpublishedChangesIconColor);
						iconSuffix = '-green';
					}
					if (this.branch.state.behind) {
						contextValue += '+behind';
						color = new ThemeColor(Colors.UnpulledChangesIconColor);
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
				Container.instance.BranchDateFormatting.dateFormat,
			)})`;
		}

		tooltip = new MarkdownString(tooltip, true);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		if (this.branch.starred) {
			tooltip.appendMarkdown('\\\n$(star-full) Favorited');
		}

		const item = new TreeItem(
			this.label,
			this.options.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = contextValue;
		item.description = description;
		item.iconPath = this.options.showAsCommits
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
		}
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

		this._children = undefined;
		void this.triggerChange(false);
	}
}
