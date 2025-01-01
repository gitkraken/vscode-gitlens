import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { GitContributor } from '../../git/models/contributor';
import type { Repository } from '../../git/models/repository';
import { sortContributors } from '../../git/utils/sorting';
import { debug } from '../../system/decorators/log';
import { configuration } from '../../system/vscode/configuration';
import type { ViewsWithContributorsNode } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { MessageNode } from './common';
import { ContributorNode } from './contributorNode';

export class ContributorsNode extends CacheableChildrenViewNode<
	'contributors',
	ViewsWithContributorsNode,
	ContributorNode
> {
	protected override splatted = true;

	constructor(
		uri: GitUri,
		view: ViewsWithContributorsNode,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
		private readonly options?: {
			all?: boolean;
			icon?: boolean;
			ref?: string;
			showMergeCommits?: boolean;
			stats?: boolean;
		},
	) {
		super('contributors', uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			let ref = this.options?.ref;
			const all = ref == null && (this.options?.all ?? configuration.get('views.contributors.showAllBranches'));

			// If there is no ref and we aren't getting all branches, get the upstream of the current branch if there is one
			if (ref == null && !all) {
				try {
					const branch = await this.view.container.git.getBranch(this.uri.repoPath);
					if (branch?.upstream?.name != null && !branch.upstream.missing) {
						ref = '@{u}';
					}
				} catch {}
			}

			const stats = this.options?.stats ?? configuration.get('views.contributors.showStatistics');

			const contributors = await this.repo.git.getContributors({
				all: all,
				merges: this.options?.showMergeCommits,
				ref: ref,
				stats: stats,
			});
			if (contributors.length === 0) return [new MessageNode(this.view, this, 'No contributors could be found.')];

			sortContributors(contributors);
			const presenceMap = this.view.container.vsls.active ? await this.getPresenceMap(contributors) : undefined;

			this.children = contributors.map(
				c =>
					new ContributorNode(this.uri, this.view, this, c, {
						all: all,
						ref: ref,
						presence: presenceMap,
						showMergeCommits: this.options?.showMergeCommits,
					}),
			);
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Contributors;
		if (this.options?.icon !== false) {
			item.iconPath = new ThemeIcon('organization');
		}
		return item;
	}

	updateAvatar(email: string) {
		if (this.children == null) return;

		for (const child of this.children) {
			if (child.contributor.email === email) {
				void child.triggerChange();
			}
		}
	}

	@debug()
	override refresh() {
		super.refresh(true);
	}

	@debug({ args: false })
	private async getPresenceMap(contributors: GitContributor[]) {
		// Only get presence for the current user, because it is far too slow otherwise
		const email = contributors.find(c => c.current)?.email;
		if (email == null) return undefined;

		return this.view.container.vsls.getContactsPresence([email]);
	}
}
