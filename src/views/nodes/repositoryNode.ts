import { Disposable, MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants.js';
import type { GitUri } from '../../git/gitUri.js';
import { GitBranch } from '../../git/models/branch.js';
import type {
	Repository,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../git/models/repository.js';
import type { GitStatus } from '../../git/models/status.js';
import { getRepositoryStatusIconPath } from '../../git/utils/-webview/icons.js';
import { formatLastFetched } from '../../git/utils/-webview/repository.utils.js';
import { getLastFetchedUpdateInterval } from '../../git/utils/fetch.utils.js';
import { getHighlanderProviders } from '../../git/utils/remote.utils.js';
import type {
	CloudWorkspace,
	CloudWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models/cloudWorkspace.js';
import type {
	LocalWorkspace,
	LocalWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models/localWorkspace.js';
import { findLastIndex } from '../../system/array.js';
import { gate } from '../../system/decorators/gate.js';
import { debug, trace } from '../../system/decorators/log.js';
import { weakEvent } from '../../system/event.js';
import { disposableInterval } from '../../system/function.js';
import { join, map, slice } from '../../system/iterable.js';
import { pad } from '../../system/string.js';
import type { ViewsWithRepositories } from '../viewBase.js';
import { createViewDecorationUri } from '../viewDecorationProvider.js';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode.js';
import type { AmbientContext, ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { BranchesNode } from './branchesNode.js';
import { BranchNode } from './branchNode.js';
import { BranchTrackingStatusNode } from './branchTrackingStatusNode.js';
import { MessageNode } from './common.js';
import { CompareBranchNode } from './compareBranchNode.js';
import { ContributorsNode } from './contributorsNode.js';
import { PausedOperationStatusNode } from './pausedOperationStatusNode.js';
import { ReflogNode } from './reflogNode.js';
import { RemotesNode } from './remotesNode.js';
import { StashesNode } from './stashesNode.js';
import { StatusFilesNode } from './statusFilesNode.js';
import { TagsNode } from './tagsNode.js';
import { WorktreesNode } from './worktreesNode.js';

export class RepositoryNode extends SubscribeableViewNode<'repository', ViewsWithRepositories> {
	private _status: Promise<GitStatus | undefined>;

	constructor(
		uri: GitUri,
		view: ViewsWithRepositories,
		parent: ViewNode,
		public readonly repo: Repository,
		context?: AmbientContext,
	) {
		super('repository', uri, view, parent);

		this.updateContext({ ...context, repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);

		this._status = this.repo.git.status.getStatus();
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.repo.path;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	get workspace(): CloudWorkspace | LocalWorkspace | undefined {
		return this.context.workspace;
	}

	get wsRepositoryDescriptor(): CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor | undefined {
		return this.context.wsRepositoryDescriptor;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children === undefined) {
			const children = [];

			const status = await this._status;
			if (status != null) {
				const defaultWorktreePath = await this.repo.git.config.getDefaultWorktreePath?.();

				const branch = new GitBranch(
					this.view.container,
					status.repoPath,
					`refs/heads/${status.branch}`,
					true,
					undefined,
					undefined,
					undefined,
					status.sha,
					status.upstream,
					{ path: status.repoPath, isDefault: status.repoPath === defaultWorktreePath },
					status.detached,
					status.rebasing,
				);

				const pausedOpStatus = await this.repo.git.pausedOps?.getPausedOperationStatus?.();
				if (pausedOpStatus != null) {
					children.push(new PausedOperationStatusNode(this.view, this, branch, pausedOpStatus, true, status));
				} else if (this.view.config.showUpstreamStatus) {
					if (status.upstream) {
						if (!status.upstream.state.behind && !status.upstream.state.ahead) {
							children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'same', true));
						} else {
							if (status.upstream.state.behind) {
								children.push(
									new BranchTrackingStatusNode(this.view, this, branch, status, 'behind', true),
								);
							}

							if (status.upstream.state.ahead) {
								children.push(
									new BranchTrackingStatusNode(this.view, this, branch, status, 'ahead', true, {
										showAheadCommits: true,
									}),
								);
							}
						}
					} else if (!status.detached) {
						children.push(new BranchTrackingStatusNode(this.view, this, branch, status, 'none', true));
					}
				}

				if (this.view.config.includeWorkingTree && status.files.length !== 0) {
					const range = undefined; //status.upstream ? createRange(status.upstream, branch.ref) : undefined;
					children.push(new StatusFilesNode(this.view, this, status, range));
				}

				if (this.view.config.showBranchComparison !== false) {
					children.push(
						new CompareBranchNode(
							this.uri,
							this.view,
							this,
							branch,
							this.view.config.showBranchComparison,
							true,
						),
					);
				}

				if (children.length !== 0 && !this.view.config.compact) {
					children.push(new MessageNode(this.view, this, '', GlyphChars.Dash.repeat(2), ''));
				}

				if (this.view.config.showCommits) {
					children.push(
						new BranchNode(this.uri, this.view, this, this.repo, branch, true, {
							showAsCommits: true,
							showComparison: false,
							showStashes: this.view.config.branches.showStashes,
							showStatusDecorationOnly: true,
							showStatus: false,
							showTracking: false,
						}),
					);
				}
			}

			if (this.view.config.showBranches) {
				children.push(new BranchesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showRemotes) {
				children.push(new RemotesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showStashes && (await this.repo.git.supports('stashes'))) {
				children.push(new StashesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showTags) {
				children.push(new TagsNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showWorktrees && (await this.repo.git.supports('git:worktrees'))) {
				children.push(new WorktreesNode(this.uri, this.view, this, this.repo));
			}

			if (this.view.config.showContributors) {
				children.push(
					new ContributorsNode(this.uri, this.view, this, this.repo, {
						stats: this.view.config.showContributorsStatistics,
					}),
				);
			}

			if (this.view.config.showIncomingActivity && !this.repo.provider.virtual) {
				children.push(new ReflogNode(this.uri, this.view, this, this.repo));
			}

			this.children = children;
		}
		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const label = this.repo.name ?? this.uri.repoPath ?? '';

		const lastFetched = (await this.repo?.getLastFetched()) ?? 0;

		let description;
		let tooltip = `${this.repo.name ?? this.uri.repoPath ?? ''}${
			lastFetched ? `${pad(GlyphChars.Dash, 2, 2)}Last fetched ${formatLastFetched(lastFetched, false)}` : ''
		}${this.repo.name ? `\\\n${this.uri.repoPath}` : ''}`;
		let workingStatus = '';

		const { workspace } = this.context;

		let contextValue: string = ContextValues.Repository;
		if (this.repo.starred) {
			contextValue += '+starred';
		}
		if (workspace != null) {
			contextValue += '+workspace';
			if (workspace.type === 'cloud') {
				contextValue += '+cloud';
			} else if (workspace.type === 'local') {
				contextValue += '+local';
			}
		}

		if (this.repo.virtual) {
			contextValue += '+virtual';
		} else if (this.repo.closed) {
			// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
			contextValue += '+closed';
		}

		const status = await this._status;
		if (status != null) {
			tooltip += `\n\nCurrent branch $(git-branch) ${status.branch}${status.rebasing ? ' (Rebasing)' : ''}`;

			if (this.view.config.includeWorkingTree && status.files.length !== 0) {
				workingStatus = status.getFormattedDiffStatus({
					compact: true,
					prefix: pad(GlyphChars.Dot, 1, 1),
				});
			}

			const upstreamStatus = status.getUpstreamStatus({
				suffix: pad(GlyphChars.Dot, 1, 1),
			});

			description = `${upstreamStatus}${status.branch}${status.rebasing ? ' (Rebasing)' : ''}${workingStatus}`;

			let providerName;
			if (status.upstream != null) {
				const providers = getHighlanderProviders(await this.repo.git.remotes.getRemotesWithProviders());
				providerName = providers?.length ? providers[0].name : undefined;
			} else {
				const remote = await status.getRemote();
				providerName = remote?.provider?.name;
			}

			if (status.upstream != null) {
				tooltip += ` is ${status.getUpstreamStatus({
					empty: `up to date with $(git-branch) ${status.upstream.name}${
						providerName ? ` on ${providerName}` : ''
					}`,
					expand: true,
					icons: true,
					separator: ', ',
					suffix: ` $(git-branch) ${status.upstream.name}${providerName ? ` on ${providerName}` : ''}`,
				})}`;

				if (status.upstream.state.behind) {
					contextValue += '+behind';
				}
				if (status.upstream.state.ahead) {
					contextValue += '+ahead';
				}
			}

			if (workingStatus) {
				tooltip += `\n\nWorking tree has uncommitted changes${status.getFormattedDiffStatus({
					expand: true,
					prefix: '\n',
					separator: '\n',
				})}`;
			}
		}

		if (workspace != null) {
			tooltip += `\n\nRepository is ${this.repo.closed ? 'not ' : ''}open in the current window`;
		}

		const item = new TreeItem(
			label,
			workspace != null || this.view.type === 'workspaces'
				? TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = contextValue;
		item.description = `${description ?? ''}${
			lastFetched ? `${pad(GlyphChars.Dot, 1, 1)}Last fetched ${formatLastFetched(lastFetched)}` : ''
		}`;
		item.iconPath = getRepositoryStatusIconPath(this.view.container, this.repo, status);

		if (workspace != null && !this.repo.closed) {
			item.resourceUri = createViewDecorationUri('repository', { state: 'open', workspace: true });
		}

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

		return item;
	}

	@debug()
	fetch(options: { all?: boolean; progress?: boolean; prune?: boolean; remote?: string }): Promise<void> {
		return this.repo.fetch(options);
	}

	@debug()
	pull(options: { progress?: boolean; rebase?: boolean }): Promise<void> {
		return this.repo.pull(options);
	}

	@debug()
	push(options: { force?: boolean; progress?: boolean }): Promise<void> {
		return this.repo.push(options);
	}

	@gate()
	@trace()
	override async refresh(reset?: boolean): Promise<void | { cancel: boolean }> {
		await super.refresh(reset);

		if (reset) {
			this._status = this.repo.git.status.getStatus();
		}

		await this.ensureSubscription();
	}

	@debug()
	async star(): Promise<void> {
		await this.repo.star();
		void this.parent!.triggerChange();
	}

	@debug()
	async unstar(): Promise<void> {
		await this.repo.unstar();
		void this.parent!.triggerChange();
	}

	@trace()
	protected async subscribe(): Promise<Disposable> {
		const lastFetched = (await this.repo?.getLastFetched()) ?? 0;

		const disposables = [weakEvent(this.repo.onDidChange, this.onRepositoryChanged, this)];

		const interval = getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			disposables.push(
				disposableInterval(() => {
					// Skip update if view is not visible to reduce unnecessary work
					if (!this.view.visible) return;

					// Check if the interval should change, and if so, reset it
					if (interval !== getLastFetchedUpdateInterval(lastFetched)) {
						void this.resetSubscription();
						return;
					}

					if (this.splatted) {
						this.view.triggerNodeChange(this.parent ?? this);
					} else {
						this.view.triggerNodeChange(this);
					}
				}, interval),
			);
		}

		if (this.view.config.includeWorkingTree) {
			disposables.push(
				weakEvent(this.repo.onDidChangeFileSystem, this.onFileSystemChanged, this, [
					this.repo.watchFileSystem(),
				]),
			);
		}

		return Disposable.from(...disposables);
	}

	protected override etag(): number {
		return this.repo.etag;
	}

	@trace({
		args: e => ({
			e: `{ repository: ${e.repository.name ?? ''}, uris(${e.uris.size}): [${join(
				map(slice(e.uris, 0, 1), u => u.fsPath),
				', ',
			)}${e.uris.size > 1 ? ', ...' : ''}] }`,
		}),
	})
	private async onFileSystemChanged(_e: RepositoryFileSystemChangeEvent) {
		this._status = this.repo.git.status.getStatus();

		if (this.children !== undefined) {
			const status = await this._status;

			let index = this.children.findIndex(c => c.type === 'status-files');
			if (status !== undefined && (status.upstream?.state.ahead || status.files.length !== 0)) {
				let deleteCount = 1;
				if (index === -1) {
					index = findLastIndex(this.children, c => c.type === 'tracking-status' || c.type === 'branch');
					deleteCount = 0;
					index++;
				}

				const range = undefined; //status.upstream ? createRange(status.upstream, status.sha) : undefined;
				this.children.splice(index, deleteCount, new StatusFilesNode(this.view, this, status, range));
			} else if (index !== -1) {
				this.children.splice(index, 1);
			}
		}

		void this.triggerChange(false);
	}

	@trace()
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed('closed')) {
			this.dispose();

			return;
		}

		if (
			this.children == null ||
			e.changed('config', 'index', 'heads', 'opened', 'pausedOp', 'starred', 'worktrees', 'unknown')
		) {
			void this.triggerChange(true);

			return;
		}

		if (e.changed('remotes', 'remoteProviders')) {
			const node = this.children.find(c => c.type === 'remotes');
			if (node != null) {
				this.view.triggerNodeChange(node);
			}
		}

		if (e.changed('stash')) {
			const node = this.children.find(c => c.type === 'stashes');
			if (node != null) {
				this.view.triggerNodeChange(node);
			}
		}

		if (e.changed('tags')) {
			const node = this.children.find(c => c.type === 'tags');
			if (node != null) {
				this.view.triggerNodeChange(node);
			}
		}
	}
}
