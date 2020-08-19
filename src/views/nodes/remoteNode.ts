'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitRemote, GitRemoteType, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Arrays, log } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ContextValues, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';
import { MessageNode } from './common';

export class RemoteNode extends ViewNode<RepositoriesView> {
	static key = ':remote';
	static getId(repoPath: string, name: string, id: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name}|${id})`;
	}

	constructor(
		uri: GitUri,
		view: RepositoriesView,
		parent: ViewNode,
		public readonly remote: GitRemote,
		public readonly repo: Repository,
	) {
		super(uri, view, parent);
	}

	toClipboard(): string {
		return this.remote.name;
	}

	get id(): string {
		return RemoteNode.getId(this.remote.repoPath, this.remote.name, this.remote.id);
	}

	async getChildren(): Promise<ViewNode[]> {
		const branches = await this.repo.getBranches({
			// only show remote branches for this remote
			filter: b => b.remote && b.name.startsWith(this.remote.name),
			sort: true,
		});
		if (branches.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

		const branchNodes = branches.map(
			b => new BranchNode(GitUri.fromRepoPath(this.uri.repoPath!, b.ref), this.view, this, b, false),
		);
		if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchNodes;

		const hierarchy = Arrays.makeHierarchical(
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
			this.repo.path,
			'',
			undefined,
			hierarchy,
			`remote(${this.remote.name})`,
		);
		const children = root.getChildren();
		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let arrows;
		let left;
		let right;
		for (const { type } of this.remote.types) {
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
		} else {
			arrows = GlyphChars.Dash;
		}

		const item = new TreeItem(
			`${this.remote.default ? `${GlyphChars.Check} ${GlyphChars.Space}` : ''}${this.remote.name}`,
			TreeItemCollapsibleState.Collapsed,
		);

		if (this.remote.provider != null) {
			const { provider } = this.remote;

			item.description = `${arrows}${GlyphChars.Space} ${provider.name} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ${provider.displayPath}`;
			item.iconPath = {
				dark: Container.context.asAbsolutePath(`images/dark/icon-${provider.icon}.svg`),
				light: Container.context.asAbsolutePath(`images/light/icon-${provider.icon}.svg`),
			};

			if (provider.hasApi()) {
				const connected = provider.maybeConnected ?? (await provider.isConnected());

				item.contextValue += `${ContextValues.Remote}${connected ? '+connected' : '+disconnected'}`;
				item.tooltip = `${this.remote.name} (${provider.name} ${GlyphChars.Dash} ${
					connected ? 'connected' : 'not connected'
				})\n${provider.displayPath}\n`;
			} else {
				item.contextValue = ContextValues.Remote;
				item.tooltip = `${this.remote.name} (${provider.name})\n${provider.displayPath}\n`;
			}
		} else {
			item.description = `${arrows}${GlyphChars.Space} ${
				this.remote.domain
					? `${this.remote.domain} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
					: ''
			}${this.remote.path}`;
			item.contextValue = ContextValues.Remote;
			item.iconPath = {
				dark: Container.context.asAbsolutePath('images/dark/icon-remote.svg'),
				light: Container.context.asAbsolutePath('images/light/icon-remote.svg'),
			};
			item.tooltip = `${this.remote.name} (${this.remote.domain})\n${this.remote.path}\n`;
		}

		if (this.remote.default) {
			item.contextValue += '+default';
		}

		item.id = this.id;

		for (const type of this.remote.types) {
			item.tooltip += `\n${type.url} (${type.type})`;
		}

		return item;
	}

	@log()
	async setAsDefault(state: boolean = true) {
		void (await this.remote.setAsDefault(state));
		void this.parent!.triggerChange();
	}
}
