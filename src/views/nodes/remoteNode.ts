import { l10n, MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { getRemoteUpstreamDescription } from '@gitlens/git/utils/remote.utils.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { GlyphChars } from '../../constants.js';
import { GitUri } from '../../git/gitUri.js';
import type { GlRepository } from '../../git/models/repository.js';
import {
	getRemoteIntegration,
	remoteSupportsIntegration,
	setRemoteAsDefault,
} from '../../git/utils/-webview/remote.utils.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { ViewsWithRemotes } from '../viewBase.js';
import { createViewDecorationUri } from '../viewDecorationProvider.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import { BranchNode } from './branchNode.js';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode.js';
import { MessageNode } from './common.js';

export class RemoteNode extends ViewNode<'remote', ViewsWithRemotes> {
	constructor(
		uri: GitUri,
		view: ViewsWithRemotes,
		protected override readonly parent: ViewNode,
		public readonly repo: GlRepository,
		public readonly remote: GitRemote,
		private readonly _options?: { expand?: boolean },
	) {
		super('remote', uri, view, parent);

		this.updateContext({ repository: repo, remote: remote });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.remote.name;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		const branches = await this.repo.git.branches.getBranches({
			// only show remote branches for this remote
			filter: b => b.remote && b.name.startsWith(this.remote.name),
			sort: { orderBy: configuration.get('sortBranchesBy') },
		});
		if (branches.values.length === 0) {
			return [new MessageNode(this.view, this, l10n.t('No branches could be found.'))];
		}

		// TODO@eamodio handle paging
		const branchNodes = branches.values.map(
			b =>
				new BranchNode(GitUri.fromRepoPath(this.uri.repoPath!, b.ref), this.view, this, this.repo, b, false, {
					showComparison: false,
					showStashes: false,
					showTracking: false,
				}),
		);
		if (this.view.config.branches.layout === 'list') return branchNodes;

		const hierarchy = makeHierarchical(
			branchNodes,
			n => n.treeHierarchy,
			(...paths) => paths.join('/'),
			this.view.config.branches.compact,
			b => {
				b.compacted = true;
				return true;
			},
		);

		const root = new BranchOrTagFolderNode(
			this.view,
			this,
			'remote-branch',
			hierarchy,
			this.repo.path,
			'',
			undefined,
		);
		const children = root.getChildren();
		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = new TreeItem(
			this.remote.name,
			this._options?.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.description = getRemoteUpstreamDescription(this.remote);

		let tooltip;
		if (this.remote.provider != null) {
			const { provider } = this.remote;
			const avatarUri = provider.avatarUri;

			item.iconPath =
				avatarUri != null && this.view.config.avatars
					? avatarUri
					: provider.icon === 'remote'
						? new ThemeIcon('cloud')
						: {
								dark: Uri.file(
									this.view.container.context.asAbsolutePath(`images/dark/icon-${provider.icon}.svg`),
								),
								light: Uri.file(
									this.view.container.context.asAbsolutePath(
										`images/light/icon-${provider.icon}.svg`,
									),
								),
							};

			if (remoteSupportsIntegration(this.remote)) {
				const integration = await getRemoteIntegration(this.remote);
				const connected = integration?.maybeConnected ?? (await integration?.isConnected());

				item.contextValue = `${ContextValues.Remote}${connected ? '+connected' : '+disconnected'}`;
				if (connected) {
					tooltip = this.remote.default
						? l10n.t(
								'`{0}` \u00a0({1} {2} _connected, default_) \n\n{3}',
								this.remote.name,
								provider.name,
								GlyphChars.Dash,
								provider.displayPath,
							)
						: l10n.t(
								'`{0}` \u00a0({1} {2} _connected_) \n\n{3}',
								this.remote.name,
								provider.name,
								GlyphChars.Dash,
								provider.displayPath,
							);
				} else {
					tooltip = this.remote.default
						? l10n.t(
								'`{0}` \u00a0({1} {2} _not connected, default_) \n\n{3}',
								this.remote.name,
								provider.name,
								GlyphChars.Dash,
								provider.displayPath,
							)
						: l10n.t(
								'`{0}` \u00a0({1} {2} _not connected_) \n\n{3}',
								this.remote.name,
								provider.name,
								GlyphChars.Dash,
								provider.displayPath,
							);
				}
			} else {
				item.contextValue = ContextValues.Remote;
				tooltip = this.remote.default
					? l10n.t(
							'`{0}` \u00a0({1}, default) \n\n{2}',
							this.remote.name,
							provider.name,
							provider.displayPath,
						)
					: l10n.t('`{0}` \u00a0({1}) \n\n{2}', this.remote.name, provider.name, provider.displayPath);
			}
		} else {
			item.contextValue = ContextValues.Remote;
			item.iconPath = new ThemeIcon('cloud');
			tooltip = this.remote.default
				? l10n.t('`{0}` \u00a0({1}, default) \n\n{2}', this.remote.name, this.remote.domain, this.remote.path)
				: l10n.t('`{0}` \u00a0({1}) \n\n{2}', this.remote.name, this.remote.domain, this.remote.path);
		}

		if (this.remote.default) {
			item.contextValue += '+default';
		}
		item.resourceUri = createViewDecorationUri('remote', { state: this.remote.default ? 'default' : undefined });

		for (const { type, url } of this.remote.urls) {
			tooltip += `\\\n${url} (${type})`;
		}

		item.tooltip = new MarkdownString(tooltip, true);

		return item;
	}

	@debug()
	async setAsDefault(state: boolean = true): Promise<void> {
		await setRemoteAsDefault(this.remote, state);
		void this.triggerChange();
	}
}
