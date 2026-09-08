import type { CancellationToken, Disposable } from 'vscode';
import { l10n, MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitBranch } from '@gitlens/git/models/branch.js';
import { getHighlanderProviders } from '@gitlens/git/utils/remote.utils.js';
import { getUpstreamStatus } from '@gitlens/git/utils/status.utils.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { weakEvent } from '@gitlens/utils/event.js';
import { basename } from '@gitlens/utils/path.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../../constants.js';
import type { GitUri } from '../../../git/gitUri.js';
import type { RepositoryChangeEvent } from '../../../git/models/repository.js';
import { GlRepository } from '../../../git/models/repository.js';
import { getBranchRemote } from '../../../git/utils/-webview/branch.utils.js';
import { getRepositoryIconPath } from '../../../git/utils/-webview/icons.js';
import { formatLastFetched } from '../../../git/utils/-webview/repository.utils.js';
import { gate } from '../../../system/decorators/gate.js';
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
		public readonly repo: GlRepository,
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

			const status = GitBranch.getTrackingStatus(branch);
			if (status) {
				item.description = status;
				if (lastFetched) {
					item.description += pad(GlyphChars.Dot, 1, 1);
				}
			}
			if (lastFetched) {
				item.description = `${item.description ?? ''}${l10n.t(
					'Last fetched {0}',
					formatLastFetched(lastFetched),
				)}`;
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
			const remote = await getBranchRemote(this.view.container, branch);
			providerName = remote?.provider?.name;
		}

		let tooltip = this.repo.name ?? this.uri.repoPath ?? '';
		if (lastFetched) {
			tooltip += `${pad(GlyphChars.Dash, 2, 2)}${l10n.t(
				'Last fetched {0}',
				formatLastFetched(lastFetched, false),
			)}`;
		}
		if (this.repo.name) {
			const repoPath = this.uri.repoPath ?? '';
			const path = isSubmodule
				? l10n.t('$(folder) (submodule) {0}', repoPath)
				: isWorktree
					? l10n.t('$(folder) (worktree) {0}', repoPath)
					: `$(folder) ${repoPath}`;
			tooltip += `\\\n${path}`;
		}

		const branchLabel = `$(git-branch) ${branch.name}`;
		let branchStatus;
		if (branch.upstream != null) {
			const upstreamLabel = `$(git-branch) ${branch.upstream.name}`;
			const status = getUpstreamStatus(branch.upstream, {
				empty: branch.upstream.missing
					? providerName
						? l10n.t('missing upstream {upstream} on {provider}', {
								upstream: upstreamLabel,
								provider: providerName,
							})
						: l10n.t('missing upstream {upstream}', { upstream: upstreamLabel })
					: providerName
						? l10n.t('up to date with {upstream} on {provider}', {
								upstream: upstreamLabel,
								provider: providerName,
							})
						: l10n.t('up to date with {upstream}', { upstream: upstreamLabel }),
				expand: true,
				icons: true,
				provider: providerName,
				separator: ', ',
				upstream: upstreamLabel,
			});
			branchStatus = l10n.t('Current branch {branch} is {status}', {
				branch: branchLabel,
				status: status,
			});
		} else {
			branchStatus = providerName
				? l10n.t("Current branch {branch} hasn't been published to {provider}", {
						branch: branchLabel,
						provider: providerName,
					})
				: l10n.t("Current branch {branch} hasn't been published to a remote", { branch: branchLabel });
		}
		tooltip += `\n\n${branchStatus}`;
		item.tooltip = new MarkdownString(tooltip, true);

		return item;
	}

	override async getSplattedChild(): Promise<TChild | undefined> {
		if (this.child == null) {
			await this.getChildren();
		}

		return this.child;
	}

	@gate()
	@trace()
	override async refresh(reset: boolean = false): Promise<void> {
		await super.refresh(reset);
		await this.child?.triggerChange(reset, false, this);
		await this.ensureSubscription();
	}

	@debug()
	async star(): Promise<void> {
		await GlRepository.starRepository(this.view.container, this.repo);
		// void this.parent!.triggerChange();
	}

	@debug()
	async unstar(): Promise<void> {
		await GlRepository.unstarRepository(this.view.container, this.repo);
		// void this.parent!.triggerChange();
	}

	@trace()
	protected subscribe(): Disposable | Promise<Disposable> {
		return weakEvent(this.repo.onDidChange, this.onRepositoryChanged, this);
	}

	protected override etag(): number {
		return this.repo.etag;
	}

	protected abstract changed(e: RepositoryChangeEvent): boolean;

	@trace()
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed('closed')) {
			this.dispose();
			void this.parent?.triggerChange(true);

			return;
		}

		if (e.changed('opened', 'starred')) {
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
