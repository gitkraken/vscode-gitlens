'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitContributor, GitLog, GitUri } from '../../git/gitService';
import { debug, gate, Iterables, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';
import { Container } from '../../container';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { CommitNode } from './commitNode';
import { GlyphChars } from '../../constants';
import { RepositoryNode } from './repositoryNode';
import { ContactPresence } from '../../vsls/vsls';

export class ContributorNode extends ViewNode<RepositoriesView> implements PageableViewNode {
	static key = ':contributor';
	static getId(repoPath: string, name: string, email: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name}|${email})`;
	}

	constructor(
		uri: GitUri,
		view: RepositoriesView,
		parent: ViewNode,
		public readonly contributor: GitContributor,
		private readonly _presenceMap: Map<string, ContactPresence> | undefined
	) {
		super(uri, view, parent);
	}

	toClipboard(): string {
		return this.contributor.name;
	}

	get id(): string {
		return ContributorNode.getId(this.contributor.repoPath, this.contributor.name, this.contributor.email);
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath);
		const children = [
			...insertDateMarkers(
				Iterables.map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, getBranchAndTagTips)
				),
				this
			)
		];

		if (log.hasMore) {
			children.push(new ShowMoreNode(this.view, this, 'Commits', children[children.length - 1]));
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const presence = this._presenceMap?.get(this.contributor.email);

		const item = new TreeItem(
			this.contributor.current ? `${this.contributor.name} (you)` : this.contributor.name,
			TreeItemCollapsibleState.Collapsed
		);
		item.id = this.id;
		item.contextValue = this.contributor.current ? `${ResourceType.Contributor}+current` : ResourceType.Contributor;
		item.description = `${
			presence != null && presence.status !== 'offline'
				? `${presence.statusText} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
				: ''
		}${this.contributor.email}`;
		item.tooltip = `${this.contributor.name}${presence != null ? ` (${presence.statusText})` : ''}\n${
			this.contributor.email
		}\n${Strings.pluralize('commit', this.contributor.count)}`;

		if (this.view.config.avatars) {
			item.iconPath = this.contributor.getGravatarUri(Container.config.defaultGravatarsStyle);
		}

		return item;
	}

	@gate()
	@debug()
	refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log === undefined) {
			this._log = await Container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				authors: [`^${this.contributor.name} <${this.contributor.email}>$`]
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async showMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log === undefined || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;
		this.triggerChange(false);
	}
}
