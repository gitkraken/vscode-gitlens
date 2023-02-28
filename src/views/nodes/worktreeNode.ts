import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { ContextKeys, GlyphChars } from '../../constants';
import { getContext } from '../../context';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { PullRequest } from '../../git/models/pullRequest';
import { PullRequestState } from '../../git/models/pullRequest';
import { shortenRevision } from '../../git/models/reference';
import { GitRemote, GitRemoteType } from '../../git/models/remote';
import type { GitWorktree } from '../../git/models/worktree';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { Deferred } from '../../system/promise';
import { defer, getSettledValue } from '../../system/promise';
import { pad } from '../../system/string';
import type { RepositoriesView } from '../repositoriesView';
import type { WorktreesView } from '../worktreesView';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { insertDateMarkers } from './helpers';
import { PullRequestNode } from './pullRequestNode';
import { RepositoryNode } from './repositoryNode';
import { UncommittedFilesNode } from './UncommittedFilesNode';
import { ContextValues, ViewNode } from './viewNode';

type State = {
	pullRequest: PullRequest | null | undefined;
	pendingPullRequest: Promise<PullRequest | undefined> | undefined;
};

export class WorktreeNode extends ViewNode<WorktreesView | RepositoriesView, State> {
	static key = ':worktree';
	static getId(repoPath: string, uri: Uri): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${uri.path})`;
	}

	private _branch: GitBranch | undefined;

	constructor(
		uri: GitUri,
		view: WorktreesView | RepositoriesView,
		parent: ViewNode,
		public readonly worktree: GitWorktree,
	) {
		super(uri, view, parent);
	}

	override toClipboard(): string {
		return this.worktree.uri.fsPath;
	}

	override get id(): string {
		return WorktreeNode.getId(this.worktree.repoPath, this.worktree.uri);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const branch = this._branch;

			let onCompleted: Deferred<void> | undefined;
			let pullRequest;

			if (
				branch != null &&
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForBranches &&
				(branch.upstream != null || branch.remote) &&
				getContext(ContextKeys.HasConnectedRemotes)
			) {
				pullRequest = this.getState('pullRequest');
				if (pullRequest === undefined && this.getState('pendingPullRequest') === undefined) {
					onCompleted = defer<void>();
					const prPromise = this.getAssociatedPullRequest(branch, {
						include: [PullRequestState.Open, PullRequestState.Merged],
					});

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
							this.view.triggerNodeChange(this);
						}
					});
				}
			}

			const [logResult, getBranchAndTagTipsResult, statusResult, unpublishedCommitsResult] =
				await Promise.allSettled([
					this.getLog(),
					this.view.container.git.getBranchesAndTagsTipsFn(this.uri.repoPath),
					this.worktree.getStatus(),
					branch != null && !branch.remote
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

			if (branch != null && this.view.config.showBranchComparison !== false) {
				children.push(
					new CompareBranchNode(
						this.uri,
						this.view,
						this,
						branch,
						this.view.config.showBranchComparison,
						this.splatted,
					),
				);
			}

			if (branch != null && pullRequest != null) {
				children.push(new PullRequestNode(this.view, this, pullRequest, branch));
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
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}

			const status = getSettledValue(statusResult);

			if (status?.hasChanges) {
				children.splice(0, 0, new UncommittedFilesNode(this.view, this, status, undefined));
			}

			this._children = children;
			onCompleted?.fulfill();
		}

		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		this.splatted = false;

		let description = '';
		const tooltip = new MarkdownString('', true);
		let icon: ThemeIcon | undefined;
		let hasChanges = false;

		const indicators =
			this.worktree.main || this.worktree.opened
				? `${pad(GlyphChars.Dash, 2, 2)} ${
						this.worktree.main
							? `_Main${this.worktree.opened ? ', Active_' : '_'}`
							: this.worktree.opened
							? '_Active_'
							: ''
				  } `
				: '';

		switch (this.worktree.type) {
			case 'bare':
				icon = new ThemeIcon('folder');
				tooltip.appendMarkdown(
					`${this.worktree.main ? '$(pass) ' : ''}Bare Worktree${indicators}\\\n\`${
						this.worktree.friendlyPath
					}\``,
				);
				break;
			case 'branch': {
				const [branch, status] = await Promise.all([this.worktree.getBranch(), this.worktree.getStatus()]);
				this._branch = branch;

				tooltip.appendMarkdown(
					`${this.worktree.main ? '$(pass) ' : ''}Worktree for Branch $(git-branch) ${
						branch?.getNameWithoutRemote() ?? this.worktree.branch
					}${indicators}\\\n\`${this.worktree.friendlyPath}\``,
				);
				icon = new ThemeIcon('git-branch');

				if (status != null) {
					hasChanges = status.hasChanges;
					tooltip.appendMarkdown(
						`\n\n${status.getFormattedDiffStatus({
							prefix: 'Has Uncommitted Changes\\\n',
							empty: 'No Uncommitted Changes',
							expand: true,
						})}`,
					);
				}

				if (branch != null) {
					tooltip.appendMarkdown(`\n\nBranch $(git-branch) ${branch.getNameWithoutRemote()}`);

					if (!branch.remote) {
						if (branch.upstream != null) {
							let arrows = GlyphChars.Dash;

							const remote = await branch.getRemote();
							if (!branch.upstream.missing) {
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

							description = `${branch.getTrackingStatus({
								empty: pad(arrows, 0, 2),
								suffix: pad(arrows, 2, 2),
							})}${branch.upstream.name}`;

							tooltip.appendMarkdown(
								` is ${branch.getTrackingStatus({
									empty: branch.upstream.missing
										? `missing upstream $(git-branch) ${branch.upstream.name}`
										: `up to date with $(git-branch)  ${branch.upstream.name}${
												remote?.provider?.name ? ` on ${remote.provider.name}` : ''
										  }`,
									expand: true,
									icons: true,
									separator: ', ',
									suffix: ` $(git-branch) ${branch.upstream.name}${
										remote?.provider?.name ? ` on ${remote.provider.name}` : ''
									}`,
								})}`,
							);
						} else {
							const providerName = GitRemote.getHighlanderProviderName(
								await this.view.container.git.getRemotesWithProviders(branch.repoPath),
							);

							tooltip.appendMarkdown(` hasn't been published to ${providerName ?? 'a remote'}`);
						}
					}
				}

				break;
			}
			case 'detached': {
				icon = new ThemeIcon('git-commit');
				tooltip.appendMarkdown(
					`${this.worktree.main ? '$(pass) ' : ''}Detached Worktree at $(git-commit) ${shortenRevision(
						this.worktree.sha,
					)}${indicators}\\\n\`${this.worktree.friendlyPath}\``,
				);

				const status = await this.worktree.getStatus();
				if (status != null) {
					hasChanges = status.hasChanges;
					tooltip.appendMarkdown(
						`\n\n${status.getFormattedDiffStatus({
							prefix: 'Has Uncommitted Changes',
							empty: 'No Uncommitted Changes',
							expand: true,
						})}`,
					);
				}

				break;
			}
		}

		const pendingPullRequest = this.getState('pendingPullRequest');
		if (pendingPullRequest != null) {
			tooltip.appendMarkdown(`\n\n$(loading~spin) Loading associated pull request${GlyphChars.Ellipsis}`);
		}

		const item = new TreeItem(this.worktree.name, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.description = description;
		item.contextValue = `${ContextValues.Worktree}${this.worktree.main ? '+main' : ''}${
			this.worktree.opened ? '+active' : ''
		}`;
		item.iconPath =
			pendingPullRequest != null
				? new ThemeIcon('loading~spin')
				: this.worktree.opened
				? new ThemeIcon('check')
				: icon;
		item.tooltip = tooltip;
		item.resourceUri = hasChanges ? Uri.parse('gitlens-view://worktree/changes') : undefined;
		return item;
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
			this._log = await this.view.container.git.getLog(this.uri.repoPath!, {
				ref: this.worktree.sha,
				limit: this.limit ?? this.view.config.defaultItemLimit,
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
