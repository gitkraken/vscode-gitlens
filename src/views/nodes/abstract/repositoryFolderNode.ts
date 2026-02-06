import type { CancellationToken, Disposable } from 'vscode';
import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../../constants.js';
import type { GitUri } from '../../../git/gitUri.js';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository.js';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository.js';
import { getRepositoryIconPath } from '../../../git/utils/-webview/icons.js';
import { formatLastFetched } from '../../../git/utils/-webview/repository.utils.js';
import { getHighlanderProviders } from '../../../git/utils/remote.utils.js';
import { gate } from '../../../system/decorators/gate.js';
import { debug, log } from '../../../system/decorators/log.js';
import { weakEvent } from '../../../system/event.js';
import { basename } from '../../../system/path.js';
import { pad } from '../../../system/string.js';
import type { View } from '../../viewBase.js';
import { SubscribeableViewNode } from './subscribeableViewNode.js';
import type { ViewNode } from './viewNode.js';
import { ContextValues, getViewNodeId } from './viewNode.js';

export abstract class RepositoryFolderNode<
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
> extends SubscribeableViewNode<'repo-folder', TView> {
	private _cachedBranch: Awaited<ReturnType<typeof this.repo.git.branches.getBranch>> | undefined;
	private _cachedLastFetched: number | undefined;

	constructor(
		uri: GitUri,
		view: TView,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
		private readonly options?: { expand?: boolean; showBranchAndLastFetched?: boolean },
	) {
		super('repo-folder', uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	private _child: TChild | undefined;
	protected get child(): TChild | undefined {
		return this._child;
	}
	protected set child(value: TChild | undefined) {
		if (this._child === value) return;

		this._child?.dispose();
		this._child = value;
	}

	override dispose(): void {
		super.dispose();
		this.child = undefined;
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

	async getTreeItem(): Promise<TreeItem> {
		const branch = await this.repo.git.branches.getBranch();
		this._cachedBranch = branch;

		let label = this.repo.name ?? this.uri.repoPath ?? '';
		if (this.options?.showBranchAndLastFetched && branch != null) {
			const remove = `: ${basename(branch.name)}`;
			const suffix = `: ${branch.name}`;
			if (label.endsWith(remove)) {
				label = label.substring(0, label.length - remove.length) + suffix;
			} else if (!label.endsWith(suffix)) {
				label += suffix;
			}
		}

		const item = new TreeItem(
			label,
			this.options?.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = `${ContextValues.RepositoryFolder}${this.repo.starred ? '+starred' : ''}`;
		if (branch?.upstream?.state.ahead) {
			item.contextValue += '+ahead';
		}
		if (branch?.upstream?.state.behind) {
			item.contextValue += '+behind';
		}
		if (this.view.type === 'commits' && this.view.state.filterCommits.get(this.repo.id)?.length) {
			item.contextValue += '+filtered';
		}

		item.iconPath = getRepositoryIconPath(this.repo);

		if (branch != null && this.options?.showBranchAndLastFetched) {
			const lastFetched = (await this.repo.getLastFetched()) ?? 0;
			this._cachedLastFetched = lastFetched;

			const status = branch.getTrackingStatus();
			if (status) {
				item.description = status;
				if (lastFetched) {
					item.description += pad(GlyphChars.Dot, 1, 1);
				}
			}
			if (lastFetched) {
				item.description = `${item.description ?? ''}Last fetched ${formatLastFetched(lastFetched)}`;
			}
		} else {
			this._cachedLastFetched = undefined;
			item.tooltip = this.repo.name ? `${this.repo.name}\n${this.uri.repoPath}` : (this.uri.repoPath ?? '');
		}

		return item;
	}

	override async resolveTreeItem(item: TreeItem, _token: CancellationToken): Promise<TreeItem> {
		const branch = this._cachedBranch;
		if (branch == null) return item;

		const { isSubmodule, isWorktree } = this.repo;
		const lastFetched = this._cachedLastFetched ?? 0;

		let providerName;
		if (branch.upstream != null) {
			const providers = getHighlanderProviders(
				await this.view.container.git.getRepositoryService(branch.repoPath).remotes.getRemotesWithProviders(),
			);
			providerName = providers?.length ? providers[0].name : undefined;
		} else {
			const remote = await branch.getRemote();
			providerName = remote?.provider?.name;
		}

		item.tooltip = new MarkdownString(
			`${this.repo.name ?? this.uri.repoPath ?? ''}${
				lastFetched ? `${pad(GlyphChars.Dash, 2, 2)}Last fetched ${formatLastFetched(lastFetched, false)}` : ''
			}${this.repo.name ? `\\\n$(folder) ${isSubmodule ? '(submodule) ' : isWorktree ? '(worktree) ' : ''}${this.uri.repoPath}` : ''}\n\nCurrent branch $(git-branch) ${branch.name}${
				branch.upstream != null
					? ` is ${branch.getTrackingStatus({
							empty: branch.upstream.missing
								? `missing upstream $(git-branch) ${branch.upstream.name}`
								: `up to date with $(git-branch) ${branch.upstream.name}${
										providerName ? ` on ${providerName}` : ''
									}`,
							expand: true,
							icons: true,
							separator: ', ',
							suffix: ` $(git-branch) ${branch.upstream.name}${
								providerName ? ` on ${providerName}` : ''
							}`,
						})}`
					: `hasn't been published to ${providerName ?? 'a remote'}`
			}`,
			true,
		);

		return item;
	}

	override async getSplattedChild(): Promise<TChild | undefined> {
		if (this.child == null) {
			await this.getChildren();
		}

		return this.child;
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false): Promise<void> {
		await super.refresh(reset);
		await this.child?.triggerChange(reset, false, this);
		await this.ensureSubscription();
	}

	@log()
	async star(): Promise<void> {
		await this.repo.star();
		// void this.parent!.triggerChange();
	}

	@log()
	async unstar(): Promise<void> {
		await this.repo.unstar();
		// void this.parent!.triggerChange();
	}

	@debug()
	protected subscribe(): Disposable | Promise<Disposable> {
		return weakEvent(this.repo.onDidChange, this.onRepositoryChanged, this);
	}

	protected override etag(): number {
		return this.repo.etag;
	}

	protected abstract changed(e: RepositoryChangeEvent): boolean;

	@debug<RepositoryFolderNode['onRepositoryChanged']>({ args: { 0: e => e.toString() } })
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Closed, RepositoryChangeComparisonMode.Any)) {
			this.dispose();
			void this.parent?.triggerChange(true);

			return;
		}

		if (
			e.changed(RepositoryChange.Opened, RepositoryChangeComparisonMode.Any) ||
			e.changed(RepositoryChange.Starred, RepositoryChangeComparisonMode.Any)
		) {
			void this.parent?.triggerChange(true);

			return;
		}

		if (this.changed(e)) {
			// If we are sorting by last fetched, then we need to trigger the parent to resort
			const node = !this.loaded || this.repo.orderByLastFetched ? (this.parent ?? this) : this;
			void node.triggerChange(true);
		}
	}
}
