import type { CancellationToken } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import { isStash } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import type { PullRequest, PullRequestState } from '../../git/models/pullRequest';
import type { GitStatus } from '../../git/models/status';
import type { GitWorktree } from '../../git/models/worktree';
import { getBranchAheadRange } from '../../git/utils/-webview/branch.utils';
import { getBranchIconPath } from '../../git/utils/-webview/icons';
import { getHighlanderProviderName } from '../../git/utils/remote.utils';
import { shortenRevision } from '../../git/utils/revision.utils';
import { getContext } from '../../system/-webview/context';
import { getBestPath } from '../../system/-webview/path';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { Lazy } from '../../system/lazy';
import { lazy } from '../../system/lazy';
import { Logger } from '../../system/logger';
import type { Deferred } from '../../system/promise';
import { defer, getSettledValue, pauseOnCancelOrTimeout } from '../../system/promise';
import { pad } from '../../system/string';
import type { ViewsWithWorktrees } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { CompareBranchNode } from './compareBranchNode';
import { PullRequestNode } from './pullRequestNode';
import { StashNode } from './stashNode';
import { UncommittedFilesNode } from './UncommittedFilesNode';
import { insertDateMarkers } from './utils/-webview/node.utils';

type State = {
	pullRequest: PullRequest | null | undefined;
	pendingPullRequest: Promise<PullRequest | undefined> | undefined;
};

export class WorktreeNode extends CacheableChildrenViewNode<'worktree', ViewsWithWorktrees, ViewNode, State> {
	limit: number | undefined;

	private _branch: GitBranch | undefined;
	private _lazyStatus: Lazy<Promise<GitStatus | undefined>> | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithWorktrees,
		public override parent: ViewNode,
		public readonly worktree: GitWorktree,
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

	compacted: boolean = false;

	private get avoidCompacting(): boolean {
		return this.worktree.isDefault || this.worktree.opened;
	}

	get treeHierarchy(): string[] {
		// If this is a branch worktree, use the branch name for the hierarchy
		if (this.worktree.type === 'branch' && !this.avoidCompacting) {
			return this.worktree.branch?.getNameWithoutRemote().split('/') || [this.worktree.name];
		}
		// For other types of worktrees or those that shouldn't be compacted, use the worktree name
		return [this.worktree.name];
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

			const svc = this.view.container.git.getRepositoryService(this.uri.repoPath!);

			const [logResult, getBranchAndTagTipsResult, unpublishedCommitsResult] = await Promise.allSettled([
				this.getLog(),
				svc.getBranchesAndTagsTipsLookup(),
				branch != null && !branch.remote
					? getBranchAheadRange(svc, branch).then(range =>
							range ? svc.commits.getLogShas(range, { limit: 0 }) : undefined,
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

			const unpublishedCommits = new Set(getSettledValue(unpublishedCommitsResult));
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

			const { hasChanges } = await this.hasWorkingChanges();
			if (hasChanges) {
				this._lazyStatus ??= lazy(() => this.worktree.getStatus());
				children.unshift(
					new UncommittedFilesNode(this.view, this, this.worktree.uri.fsPath, this._lazyStatus, undefined),
				);
			}

			this.children = children;
			onCompleted?.fulfill();
		}

		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let description = '';
		let icon: IconPath | undefined;

		let hasChanges: boolean | undefined;
		let missing = false;

		const result = await pauseOnCancelOrTimeout(this.hasWorkingChanges(), undefined, 1);
		if (!result.paused) {
			({ hasChanges, missing } = result.value);
		} else {
			queueMicrotask(() => {
				void result.value.then(() => {
					this.view.triggerNodeChange(this);
				});
			});
		}

		const { viewAs } = this.view.config.worktrees;

		switch (this.worktree.type) {
			case 'bare':
				icon = new ThemeIcon('folder');
				break;

			case 'branch': {
				const { branch } = this.worktree;
				this._branch = branch;

				icon = getBranchIconPath(this.view.container, branch);

				if (branch != null && !branch.remote && branch.upstream != null) {
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
						empty: `${viewAs !== 'name' ? ` ${branch.getNameWithoutRemote()}` : ''}${pad(
							arrows,
							viewAs !== 'name' ? 2 : 0,
							2,
						)}`,
						suffix: `${viewAs !== 'name' ? ` ${branch.getNameWithoutRemote()}` : ''}${pad(arrows, 2, 2)}`,
					})}${branch.upstream.name}`;
				}

				break;
			}
			case 'detached': {
				icon = new ThemeIcon('git-commit');
				break;
			}
		}

		const pendingPullRequest = this.getState('pendingPullRequest');

		let label: string;
		switch (viewAs) {
			case 'path':
				label = getBestPath(this.worktree.uri);
				break;
			case 'relativePath':
				label = this.worktree.friendlyPath;
				break;
			case 'name':
			default:
				// Use basename for display if we're using tree layout and the node is compacted
				label =
					this.view.config.files.layout === 'tree' && this.compacted && !this.avoidCompacting
						? this.worktree.type === 'branch' && this.worktree.branch
							? this.worktree.branch.getBasename()
							: this.worktree.name
						: this.worktree.name;
				break;
		}

		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.description = description;
		item.contextValue = `${ContextValues.Worktree}${this.worktree.isDefault ? '+default' : ''}${
			this.worktree.opened ? '+active' : ''
		}${hasChanges ? '+working' : ''}${this.worktree.branch?.starred ? '+starred' : ''}`;
		item.iconPath =
			pendingPullRequest != null
				? new ThemeIcon('loading~spin')
				: this.worktree.opened
					? new ThemeIcon('check')
					: icon;
		// Tooltip will be set lazily in resolveTreeItem
		item.resourceUri = createViewDecorationUri('worktree', {
			hasChanges: hasChanges,
			missing: missing,
			starred: this.worktree.branch?.starred,
		});

		return item;
	}

	override async resolveTreeItem(item: TreeItem, _token: CancellationToken): Promise<TreeItem> {
		if (item.tooltip != null) return item;

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

		const folder = `\\\n$(folder) [\`${
			this.worktree.friendlyPath
		}\`](command:gitlens.views.revealWorktreeInExplorer?%22${this.worktree.uri.toString()}%22 "Reveal in Explorer")`;

		switch (this.worktree.type) {
			case 'bare':
				tooltip.appendMarkdown(
					`${this.worktree.isDefault ? '$(pass) ' : ''}Bare Worktree${indicators}${folder}`,
				);
				break;

			case 'branch': {
				const { branch } = this.worktree;
				tooltip.appendMarkdown(
					`${this.worktree.isDefault ? '$(pass) ' : ''}Worktree for $(git-branch) \`${
						branch?.getNameWithoutRemote() ?? branch?.name
					}\`${indicators}${folder}`,
				);

				if (branch != null && !branch.remote) {
					if (branch.upstream != null) {
						const remote = await branch.getRemote();
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
							await this.view.container.git
								.getRepositoryService(branch.repoPath)
								.remotes.getRemotesWithProviders(),
						);
						tooltip.appendMarkdown(
							`\n\nLocal branch, hasn't been published to ${providerName ?? 'a remote'}`,
						);
					}
				}

				break;
			}

			case 'detached':
				tooltip.appendMarkdown(
					`${this.worktree.isDefault ? '$(pass) ' : ''}Detached Worktree at $(git-commit) ${shortenRevision(
						this.worktree.sha,
					)}${indicators}${folder}`,
				);

				break;
		}

		switch (this.worktree.type) {
			case 'branch':
			case 'detached': {
				this._lazyStatus ??= lazy(() => this.worktree.getStatus());
				const status = await this._lazyStatus.value;
				const stats = status?.getFormattedDiffStatus({
					prefix: 'Has Uncommitted Changes\\\n',
					empty: 'No Uncommitted Changes',
					expand: true,
				});
				if (stats != null) {
					tooltip.appendMarkdown(`\n\n${stats}`);
				}

				break;
			}
		}

		// Add pending pull request indicator
		const pendingPullRequest = this.getState('pendingPullRequest');
		if (pendingPullRequest != null) {
			tooltip.appendMarkdown(`\n\n$(loading~spin) Loading associated pull request${GlyphChars.Ellipsis}`);
		}

		// Add missing worktree warning
		const { missing } = await this.hasWorkingChanges();
		if (missing) {
			tooltip.appendMarkdown(`\n\n${GlyphChars.Warning} Unable to locate worktree path`);
		}

		// Add favorited indicator
		if (this.worktree.branch?.starred) {
			tooltip.appendMarkdown('\n\n$(star-full) Favorited');
		}

		item.tooltip = tooltip;
		return item;
	}

	@debug()
	override refresh(reset?: boolean): void | { cancel: boolean } | Promise<void | { cancel: boolean }> {
		if (reset) {
			this._log = undefined;
			this.deleteState();
		}
		return super.refresh(reset);
	}

	@log()
	async star(): Promise<void> {
		if (this.worktree.branch == null) return;

		await this.worktree.branch.star();
		void this.view.refresh(true);
	}

	@log()
	async unstar(): Promise<void> {
		if (this.worktree.branch == null) return;

		await this.worktree.branch.unstar();
		void this.view.refresh(true);
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
			this._log = await this.view.container.git
				.getRepositoryService(this.uri.repoPath!)
				.commits.getLog(this.worktree.sha, {
					limit: this.limit ?? this.view.config.defaultItemLimit,
					stashes: this.view.config.showStashes,
				});
		}

		return this._log;
	}

	private _hasWorkingChanges: { hasChanges: boolean | undefined; missing: boolean } | undefined;
	private async hasWorkingChanges() {
		if (this._hasWorkingChanges == null) {
			try {
				const hasChanges = await this.worktree.hasWorkingChanges();
				this._hasWorkingChanges = { hasChanges: hasChanges, missing: false };
			} catch (ex) {
				Logger.error(ex, `Worktree hasWorkingChanges failed: ${this.worktree.uri.toString(true)}`);
				this._hasWorkingChanges = { hasChanges: undefined, missing: true };
			}
		}

		return this._hasWorkingChanges;
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

		this.children = undefined;
		void this.triggerChange(false);
	}
}
