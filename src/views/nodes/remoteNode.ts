import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { GitUri } from '../../git/gitUri';
import type { GitRemote } from '../../git/models/remote';
import { getRemoteUpstreamDescription } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import { makeHierarchical } from '../../system/array';
import { log } from '../../system/decorators/log';
import type { ViewsWithRemotes } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';

export class RemoteNode extends ViewNode<'remote', ViewsWithRemotes> {
	constructor(
		uri: GitUri,
		view: ViewsWithRemotes,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
		public readonly remote: GitRemote,
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
		const branches = await this.repo.git.getBranches({
			// only show remote branches for this remote
			filter: b => b.remote && b.name.startsWith(this.remote.name),
			sort: true,
		});
		if (branches.values.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

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
			this.view.config.files.compact,
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
		const item = new TreeItem(this.remote.name, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.description = getRemoteUpstreamDescription(this.remote);

		let tooltip;
		if (this.remote.provider != null) {
			const { provider } = this.remote;

			item.iconPath =
				provider.avatarUri != null && this.view.config.avatars
					? provider.avatarUri
					: provider.icon === 'remote'
					  ? new ThemeIcon('cloud')
					  : {
								dark: this.view.container.context.asAbsolutePath(
									`images/dark/icon-${provider.icon}.svg`,
								),
								light: this.view.container.context.asAbsolutePath(
									`images/light/icon-${provider.icon}.svg`,
								),
					    };

			if (this.remote.hasIntegration()) {
				const integration = await this.view.container.integrations.getByRemote(this.remote);
				const connected = integration?.maybeConnected ?? (await integration?.isConnected());

				item.contextValue = `${ContextValues.Remote}${connected ? '+connected' : '+disconnected'}`;
				tooltip = `\`${this.remote.name}\` \u00a0(${provider.name} ${GlyphChars.Dash} _${
					connected ? 'connected' : 'not connected'
				}${this.remote.default ? ', default' : ''}_) \n\n${provider.displayPath}`;
			} else {
				item.contextValue = ContextValues.Remote;
				tooltip = `\`${this.remote.name}\` \u00a0(${provider.name}${
					this.remote.default ? ', default' : ''
				}) \n\n${provider.displayPath}`;
			}
		} else {
			item.contextValue = ContextValues.Remote;
			item.iconPath = new ThemeIcon('cloud');
			tooltip = `\`${this.remote.name}\` \u00a0(${this.remote.domain}${
				this.remote.default ? ', default' : ''
			}) \n\n${this.remote.path}`;
		}

		if (this.remote.default) {
			item.contextValue += '+default';
		}
		item.resourceUri = createViewDecorationUri('remote', { default: this.remote.default });

		for (const { type, url } of this.remote.urls) {
			tooltip += `\\\n${url} (${type})`;
		}

		item.tooltip = new MarkdownString(tooltip, true);

		return item;
	}

	@log()
	async setAsDefault(state: boolean = true) {
		await this.remote.setAsDefault(state);
		void this.triggerChange();
	}
}
