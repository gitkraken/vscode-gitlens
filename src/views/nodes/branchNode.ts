'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { BranchDateFormatting, GitBranch, GitLog, GitRemoteType, GitUri } from '../../git/gitService';
import { debug, gate, Iterables, log, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode, ViewRefNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';

export class BranchNode extends ViewRefNode<RepositoriesView> implements PageableViewNode {
	static key = ':branch';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})${root ? ':root' : ''}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(
		uri: GitUri,
		view: RepositoriesView,
		parent: ViewNode,
		public readonly branch: GitBranch,
		// Specifies that the node is shown as a root under the repository node
		public readonly root: boolean = false
	) {
		super(uri, view, parent);
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
		const branchName = this.branch.getName();
		if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchName;

		return this.compacted || this.root || this.current || this.branch.detached || this.branch.starred
			? branchName
			: this.branch.getBasename();
	}

	get ref(): string {
		return this.branch.ref;
	}

	get treeHierarchy(): string[] {
		return this.root || this.current || this.branch.detached || this.branch.starred
			? [this.branch.name]
			: this.branch.getName().split('/');
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const children = [];
			if (!this.root && this.branch.tracking) {
				const status = {
					ref: this.branch.ref,
					repoPath: this.branch.repoPath,
					state: this.branch.state,
					upstream: this.branch.tracking
				};

				if (this.branch.state.behind) {
					children.push(new BranchTrackingStatusNode(this.view, this, this.branch, status, 'behind'));
				}

				if (this.branch.state.ahead) {
					children.push(new BranchTrackingStatusNode(this.view, this, this.branch, status, 'ahead'));
				}
			}

			const log = await this.getLog();
			if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

			const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(
				this.uri.repoPath,
				this.branch.name
			);
			children.push(
				...insertDateMarkers(
					Iterables.map(
						log.commits.values(),
						c => new CommitNode(this.view, this, c, this.branch, getBranchAndTagTips)
					),
					this
				)
			);

			if (log.hasMore) {
				children.push(new ShowMoreNode(this.view, this, 'Commits', children[children.length - 1]));
			}

			this._children = children;
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const name = this.label;
		let tooltip = `${this.branch.getName()}${this.current ? ' (current)' : ''}`;
		let iconSuffix = '';

		let contextValue: string = ResourceType.Branch;
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
		if (!this.branch.remote && this.branch.tracking !== undefined) {
			if (this.view.config.showTrackingBranch) {
				let arrows = GlyphChars.Dash;

				const remote = await this.branch.getRemote();
				if (remote !== undefined) {
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
			}
			tooltip += ` is tracking ${this.branch.tracking}\n${this.branch.getTrackingStatus({
				empty: 'up-to-date',
				expand: true,
				separator: '\n'
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
				BranchDateFormatting.dateFormat
			)})`;
		}

		const item = new TreeItem(
			// Hide the current branch checkmark when the node is displayed as a root under the repository node
			`${!this.root && this.current ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${name}`,
			TreeItemCollapsibleState.Collapsed
		);
		item.contextValue = contextValue;
		item.description = description;
		item.iconPath = {
			dark: Container.context.asAbsolutePath(`images/dark/icon-branch${iconSuffix}.svg`),
			light: Container.context.asAbsolutePath(`images/light/icon-branch${iconSuffix}.svg`)
		};
		item.id = this.id;
		item.tooltip = tooltip;

		return item;
	}

	@log()
	async star() {
		await this.branch.star();
		void this.parent!.triggerChange();
	}

	@log()
	async unstar() {
		await this.branch.unstar();
		void this.parent!.triggerChange();
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
		if (this._log === undefined) {
			this._log = await Container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.ref
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
		this.triggerChange(false);
	}
}
