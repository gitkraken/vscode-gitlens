'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchesView } from '../branchesView';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { CommitsView } from '../commitsView';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { ViewBranchesLayout, ViewShowBranchComparison } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
	BranchDateFormatting,
	GitBranch,
	GitBranchReference,
	GitLog,
	GitRemoteType,
	GitRevision,
	PullRequestState,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { insertDateMarkers } from './helpers';
import { PullRequestNode } from './pullRequestNode';
import { RemotesView } from '../remotesView';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { debug, gate, Iterables, log, Strings } from '../../system';
import { ContextValues, PageableViewNode, ViewNode, ViewRefNode } from './viewNode';

export class BranchNode
	extends ViewRefNode<BranchesView | CommitsView | RemotesView | RepositoriesView, GitBranchReference>
	implements PageableViewNode {
	static key = ':branch';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})${root ? ':root' : ''}`;
	}

	private _children: ViewNode[] | undefined;
	private readonly options: {
		expanded: boolean;
		showComparison: false | ViewShowBranchComparison;
		showCurrent: boolean;
		showTracking: boolean;
		authors?: string[];
	};
	protected splatted = true;

	constructor(
		uri: GitUri,
		view: BranchesView | CommitsView | RemotesView | RepositoriesView,
		parent: ViewNode,
		public readonly branch: GitBranch,
		// Specifies that the node is shown as a root under the repository node
		private readonly root: boolean,

		options?: {
			expanded?: boolean;
			showComparison?: false | ViewShowBranchComparison;
			showCurrent?: boolean;
			showTracking?: boolean;
			authors?: string[];
		},
	) {
		super(uri, view, parent);

		this.options = {
			expanded: false,
			showComparison: false,
			// Hide the current branch checkmark when the node is displayed as a root under the repository node
			showCurrent: !this.root,
			// Don't show tracking info the node is displayed as a root under the repository node
			showTracking: !this.root,
			...options,
		};
	}

	toClipboard(): string {
		return this.branch.name;
	}

	get id(): string {
		return BranchNode.getId(this.branch.repoPath, this.branch.name, this.root);
	}

	compacted: boolean = false;

	get current(): boolean {
		return this.branch.current;
	}

	get label(): string {
		const branchName = this.branch.getNameWithoutRemote();
		return this.view.config.branches?.layout !== ViewBranchesLayout.Tree ||
			this.compacted ||
			this.root ||
			this.current ||
			this.branch.detached ||
			this.branch.starred
			? branchName
			: this.branch.getBasename();
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
			const children = [];

			const range = await Container.git.getBranchAheadRange(this.branch);
			const [log, getBranchAndTagTips, pr, unpublishedCommits] = await Promise.all([
				this.getLog(),
				Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath, this.branch.name),
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForBranches &&
				(this.branch.tracking || this.branch.remote)
					? this.branch.getAssociatedPullRequest(this.root ? { include: [PullRequestState.Open] } : undefined)
					: undefined,
				range
					? Container.git.getLogRefsOnly(this.uri.repoPath!, {
							limit: 0,
							ref: range,
					  })
					: undefined,
			]);
			if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

			if (
				this.options.showComparison !== false &&
				(this.view instanceof BranchesView || this.view instanceof CommitsView)
			) {
				children.push(new CompareBranchNode(this.uri, this.view, this, this.branch));
			}

			if (pr != null) {
				children.push(new PullRequestNode(this.view, this, pr, this.branch));
			}

			if (this.options.showTracking) {
				const status = {
					ref: this.branch.ref,
					repoPath: this.branch.repoPath,
					state: this.branch.state,
					upstream: this.branch.tracking,
				};

				if (this.branch.tracking) {
					if (this.root && !status.state.behind && !status.state.ahead) {
						children.push(
							new BranchTrackingStatusNode(this.view, this, this.branch, status, 'same', this.root),
						);
					} else {
						if (status.state.ahead) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, this.branch, status, 'ahead', this.root),
							);
						}

						if (status.state.behind) {
							children.push(
								new BranchTrackingStatusNode(this.view, this, this.branch, status, 'behind', this.root),
							);
						}
					}
				} else if (this.root) {
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
					Iterables.map(
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
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}

			this._children = children;
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		this.splatted = false;

		const name = this.label;
		let tooltip = `${this.branch.getNameWithoutRemote()}${this.current ? ' (current)' : ''}`;
		let iconSuffix = '';

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
		if (this.branch.tracking) {
			contextValue += '+tracking';
		}

		let description;
		if (!this.branch.remote && this.branch.tracking != null) {
			let arrows = GlyphChars.Dash;

			const remote = await this.branch.getRemote();
			if (remote != null) {
				let left;
				let right;
				for (const { type } of remote.types) {
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

			description = `${this.branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${
				GlyphChars.Space
			} ${this.branch.tracking}`;

			tooltip += ` is ${this.branch.getTrackingStatus({
				empty: `up to date with ${this.branch.tracking}`,
				expand: true,
				separator: ', ',
				suffix: ` ${this.branch.tracking}`,
			})}`;

			if (this.branch.state.ahead || this.branch.state.behind) {
				if (this.branch.state.behind) {
					contextValue += '+behind';
					iconSuffix = '-red';
				}
				if (this.branch.state.ahead) {
					contextValue += '+ahead';
					iconSuffix = this.branch.state.behind ? '-yellow' : '-green';
				}
			}
		}

		if (this.branch.date !== undefined) {
			description = `${description ? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}` : ''}${
				this.branch.formattedDate
			}`;

			tooltip += `\nLast commit ${this.branch.formatDateFromNow()} (${this.branch.formatDate(
				BranchDateFormatting.dateFormat,
			)})`;
		}

		const item = new TreeItem(
			`${this.options.showCurrent && this.current ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${name}`,
			this.options.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = contextValue;
		item.description = description;
		item.iconPath = {
			dark: Container.context.asAbsolutePath(`images/dark/icon-branch${iconSuffix}.svg`),
			light: Container.context.asAbsolutePath(`images/light/icon-branch${iconSuffix}.svg`),
		};
		item.id = this.id;
		item.tooltip = tooltip;

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
	refresh(reset?: boolean) {
		this._children = undefined;
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log == null) {
			// Ensure we always show all unpublished commits (and the upstream tip)
			let limit = this.limit ?? this.view.config.defaultItemLimit;
			if (limit !== 0 && this.branch.state.ahead > limit) {
				limit = this.branch.state.ahead + 1;
			}

			this._log = await Container.git.getLog(this.uri.repoPath!, {
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
	async loadMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		this._children = undefined;
		void this.triggerChange(false);
	}
}
