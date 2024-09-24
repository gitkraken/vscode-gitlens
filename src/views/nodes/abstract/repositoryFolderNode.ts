import type { Disposable } from 'vscode';
import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../../constants';
import type { GitUri } from '../../../git/gitUri';
import { getHighlanderProviders } from '../../../git/models/remote';
import type { RepositoryChangeEvent } from '../../../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import { weakEvent } from '../../../system/event';
import { basename } from '../../../system/path';
import { pad } from '../../../system/string';
import type { View } from '../../viewBase';
import { SubscribeableViewNode } from './subscribeableViewNode';
import type { ViewNode } from './viewNode';
import { ContextValues, getViewNodeId } from './viewNode';

export abstract class RepositoryFolderNode<
	TView extends View = View,
	TChild extends ViewNode = ViewNode,
> extends SubscribeableViewNode<'repo-folder', TView> {
	protected override splatted = true;

	constructor(
		uri: GitUri,
		view: TView,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
		splatted: boolean,
		private readonly options?: { showBranchAndLastFetched?: boolean },
	) {
		super('repo-folder', uri, view, parent);

		this.updateContext({ repository: this.repo });
		this._uniqueId = getViewNodeId(this.type, this.context);

		this.splatted = splatted;
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

	override dispose() {
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
		this.splatted = false;

		const branch = await this.repo.git.getBranch();
		const ahead = (branch?.state.ahead ?? 0) > 0;
		const behind = (branch?.state.behind ?? 0) > 0;

		const expand = ahead || behind || this.repo.starred || this.view.container.git.isRepositoryForEditor(this.repo);

		let label = this.repo.formattedName ?? this.uri.repoPath ?? '';
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
			expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = `${ContextValues.RepositoryFolder}${this.repo.starred ? '+starred' : ''}`;
		if (ahead) {
			item.contextValue += '+ahead';
		}
		if (behind) {
			item.contextValue += '+behind';
		}
		if (this.view.type === 'commits' && this.view.state.filterCommits.get(this.repo.id)?.length) {
			item.contextValue += '+filtered';
		}

		if (branch != null && this.options?.showBranchAndLastFetched) {
			const lastFetched = (await this.repo.getLastFetched()) ?? 0;

			const status = branch.getTrackingStatus();
			if (status) {
				item.description = status;
				if (lastFetched) {
					item.description += pad(GlyphChars.Dot, 1, 1);
				}
			}
			if (lastFetched) {
				item.description = `${item.description ?? ''}Last fetched ${Repository.formatLastFetched(lastFetched)}`;
			}

			let providerName;
			if (branch.upstream != null) {
				const providers = getHighlanderProviders(
					await this.view.container.git.getRemotesWithProviders(branch.repoPath),
				);
				providerName = providers?.length ? providers[0].name : undefined;
			} else {
				const remote = await branch.getRemote();
				providerName = remote?.provider?.name;
			}

			item.tooltip = new MarkdownString(
				`${this.repo.formattedName ?? this.uri.repoPath ?? ''}${
					lastFetched
						? `${pad(GlyphChars.Dash, 2, 2)}Last fetched ${Repository.formatLastFetched(
								lastFetched,
								false,
						  )}`
						: ''
				}${this.repo.formattedName ? `\n${this.uri.repoPath}` : ''}\n\nCurrent branch $(git-branch) ${
					branch.name
				}${
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
		} else {
			item.tooltip = this.repo.formattedName
				? `${this.repo.formattedName}\n${this.uri.repoPath}`
				: this.uri.repoPath ?? '';
		}

		return item;
	}

	override async getSplattedChild() {
		if (this.child == null) {
			await this.getChildren();
		}

		return this.child;
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false) {
		super.refresh(reset);
		await this.child?.triggerChange(reset, false, this);

		await this.ensureSubscription();
	}

	@log()
	async star() {
		await this.repo.star();
		// void this.parent!.triggerChange();
	}

	@log()
	async unstar() {
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
			const node = !this.loaded || this.repo.orderByLastFetched ? this.parent ?? this : this;
			void node.triggerChange(true);
		}
	}
}
