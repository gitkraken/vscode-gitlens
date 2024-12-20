import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import { isStash } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import type { PullRequest, PullRequestState } from '../../git/models/pullRequest';
import { getHighlanderProviderName } from '../../git/models/remote';
import { shortenRevision } from '../../git/models/revision.utils';
import type { GitStatus } from '../../git/models/status';
import type { GitWorktree } from '../../git/models/worktree';
import { getBranchIconPath } from '../../git/utils/icons';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { Deferred } from '../../system/promise';
import { defer, getSettledValue } from '../../system/promise';
import { pad } from '../../system/string';
import { getContext } from '../../system/vscode/context';
import type { ViewsWithWorktrees } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { insertDateMarkers } from './helpers';
import { PullRequestNode } from './pullRequestNode';
import { StashNode } from './stashNode';
import { UncommittedFilesNode } from './UncommittedFilesNode';

type State = {
	pullRequest: PullRequest | null | undefined;
	pendingPullRequest: Promise<PullRequest | undefined> | undefined;
};

export class WorktreeNode extends CacheableChildrenViewNode<'worktree', ViewsWithWorktrees, ViewNode, State> {
	limit: number | undefined;

	private _branch: GitBranch | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithWorktrees,
		protected override readonly parent: ViewNode,
		public readonly worktree: GitWorktree,
		private readonly worktreeStatus: { status: GitStatus | undefined; missing: boolean } | undefined,
	) {
		super('worktree', uri, view, parent);

		this.updateContext({ worktree: worktree });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.worktree.uri.fsPath;
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const branch = this._branch;

			let onCompleted: Deferred<void> | undefined;
			let pullRequest;
			const pullRequestInsertIndex = 0;

			if (
				branch != null &&
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForBranches &&
				(branch.upstream != null || branch.remote) &&
				getContext('gitlens:repos:withHostingIntegrationsConnected')?.includes(branch.repoPath)
			) {
				pullRequest = this.getState('pullRequest');
				if (pullRequest === undefined && this.getState('pendingPullRequest') === undefined) {
					onCompleted = defer<void>();
					const prPromise = this.getAssociatedPullRequest(branch, {
						include: ['opened', 'merged'],
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
						if (pr != null && this.children != null) {
							this.children.splice(
								pullRequestInsertIndex,
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

			const [logResult, getBranchAndTagTipsResult, unpublishedCommitsResult] = await Promise.allSettled([
				this.getLog(),
				this.view.container.git.getBranchesAndTagsTipsLookup(this.uri.repoPath),
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

			if (branch != null && pullRequest != null) {
				children.push(new PullRequestNode(this.view, this, pullRequest, branch));
			}

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

			const unpublishedCommits = getSettledValue(unpublishedCommitsResult);
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
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}

			if (this.worktreeStatus?.status?.hasChanges) {
				children.unshift(new UncommittedFilesNode(this.view, this, this.worktreeStatus.status, undefined));
			}

			this.children = children;
			onCompleted?.fulfill();
		}

		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		this.splatted = false;

		let description = '';
		let icon: IconPath | undefined;
		let hasChanges = false;

		const tooltip = new MarkdownString('', true);
		tooltip.isTrusted = true;

		const indicators =
			this.worktree.isDefault || this.worktree.opened
				? ` \u00a0(${
						this.worktree.isDefault
							? `_default${this.worktree.opened ? ', active_' : '_'}`
							: this.worktree.opened
							  ? '_active_'
							  : ''
				  })`
				: '';

		const status = this.worktreeStatus?.status;

		const folder = `\\\n$(folder) [\`${
			this.worktree.friendlyPath
		}\`](command:gitlens.views.revealWorktreeInExplorer?%22${this.worktree.uri.toString()}%22 "Reveal in Explorer")`;

		switch (this.worktree.type) {
			case 'bare':
				icon = new ThemeIcon('folder');
				tooltip.appendMarkdown(
					`${this.worktree.isDefault ? '$(pass) ' : ''}Bare Worktree${indicators}${folder}`,
				);
				break;

			case 'branch': {
				const { branch } = this.worktree;
				this._branch = branch;

				tooltip.appendMarkdown(
					`${this.worktree.isDefault ? '$(pass) ' : ''}Worktree for $(git-branch) \`${
						branch?.getNameWithoutRemote() ?? branch?.name
					}\`${indicators}${folder}`,
				);
				icon = getBranchIconPath(this.view.container, branch);

				if (branch != null) {
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

							description = `${branch.getTrackingStatus({
								empty: pad(arrows, 0, 2),
								suffix: pad(arrows, 2, 2),
							})}${branch.upstream.name}`;

							tooltip.appendMarkdown(
								`\n\nBranch is ${branch.getTrackingStatus({
									empty: `${
										branch.upstream.missing ? 'missing upstream' : 'up to date with'
									} \\\n $(git-branch) \`${branch.upstream.name}\`${
										remote?.provider?.name ? ` on ${remote.provider.name}` : ''
									}`,
									expand: true,
									icons: true,
									separator: ', ',
									suffix: `\\\n$(git-branch) \`${branch.upstream.name}\`${
										remote?.provider?.name ? ` on ${remote.provider.name}` : ''
									}`,
								})}`,
							);
						} else {
							const providerName = getHighlanderProviderName(
								await this.view.container.git.getRemotesWithProviders(branch.repoPath),
							);

							tooltip.appendMarkdown(
								`\n\nLocal branch, hasn't been published to ${providerName ?? 'a remote'}`,
							);
						}
					}
				}

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

				break;
			}
			case 'detached': {
				icon = new ThemeIcon('git-commit');
				tooltip.appendMarkdown(
					`${this.worktree.isDefault ? '$(pass) ' : ''}Detached Worktree at $(git-commit) ${shortenRevision(
						this.worktree.sha,
					)}${indicators}${folder}`,
				);

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

		const missing = this.worktreeStatus?.missing ?? false;
		if (missing) {
			tooltip.appendMarkdown(`\n\n${GlyphChars.Warning} Unable to locate worktree path`);
		}

		const item = new TreeItem(this.worktree.name, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.description = description;
		item.contextValue = `${ContextValues.Worktree}${this.worktree.isDefault ? '+default' : ''}${
			this.worktree.opened ? '+active' : ''
		}`;
		item.iconPath =
			pendingPullRequest != null
				? new ThemeIcon('loading~spin')
				: this.worktree.opened
				  ? new ThemeIcon('check')
				  : icon;
		item.tooltip = tooltip;
		item.resourceUri = createViewDecorationUri('worktree', { hasChanges: hasChanges, missing: missing });

		return item;
	}

	@debug()
	override refresh(reset?: boolean) {
		super.refresh(true);

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
				stashes: this.view.config.showStashes,
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
