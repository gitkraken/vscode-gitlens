'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { MessageNode } from './common';
import { Container } from '../../container';
import { ContributorNode } from './contributorNode';
import { ContributorsView } from '../contributorsView';
import { GitContributor, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoryNode } from './repositoryNode';
import { RepositoriesView } from '../repositoriesView';
import { debug, gate, timeout } from '../../system';
import { ContextValues, ViewNode } from './viewNode';

export class ContributorsNode extends ViewNode<ContributorsView | RepositoriesView> {
	static key = ':contributors';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	protected splatted = true;

	private _children: ContributorNode[] | undefined;

	constructor(
		uri: GitUri,
		view: ContributorsView | RepositoriesView,
		parent: ViewNode,
		public readonly repo: Repository,
	) {
		super(uri, view, parent);
	}

	get id(): string {
		return ContributorsNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const contributors = await this.repo.getContributors();
			if (contributors.length === 0) return [new MessageNode(this.view, this, 'No contributors could be found.')];

			GitContributor.sort(contributors);
			const presenceMap = await this.maybeGetPresenceMap(contributors).catch(() => undefined);

			this._children = contributors.map(c => new ContributorNode(this.uri, this.view, this, c, presenceMap));
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Contributors;
		item.iconPath = new ThemeIcon('organization');
		return item;
	}

	updateAvatar(email: string) {
		if (this._children == null) return;

		for (const child of this._children) {
			if (child.contributor.email === email) {
				void child.triggerChange();
			}
		}
	}

	@gate()
	@debug()
	refresh() {
		this._children = undefined;
	}

	@debug({ args: false })
	@timeout(250)
	private async maybeGetPresenceMap(contributors: GitContributor[]) {
		// Only get presence for the current user, because it is far too slow otherwise
		const email = contributors.find(c => c.current)?.email;
		if (email == null) return undefined;

		return Container.vsls.getContactsPresence([email]);
	}
}
