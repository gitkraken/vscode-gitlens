import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { CoreColors } from '../../constants.colors';
import type { GitUri } from '../../git/gitUri';
import type { GitContributor } from '../../git/models/contributor';
import type { Repository } from '../../git/models/repository';
import { sortContributors } from '../../git/utils/-webview/sorting';
import { configuration } from '../../system/-webview/configuration';
import { debug } from '../../system/decorators/log';
import type { ViewsWithContributorsNode } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ActionMessageNode, MessageNode } from './common';
import { ContributorNode } from './contributorNode';

export class ContributorsNode extends CacheableChildrenViewNode<
	'contributors',
	ViewsWithContributorsNode,
	ContributorNode | MessageNode | ActionMessageNode
> {
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
			const stats = this.options?.stats ?? configuration.get('views.contributors.showStatistics');
			const children = await this.getContributors(stats, true);

			if (stats) {
				queueMicrotask(async () => {
					this.children = await this.getContributors(true, false);
					void this.triggerChange();
				});
			}

			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Contributors;
		if (this.options?.icon !== false) {
			item.iconPath = new ThemeIcon('organization');
		}
		return item;
	}

	updateAvatar(email: string): void {
		if (this.children == null) return;

		for (const child of this.children) {
			if (!child.is('contributor')) continue;

			if (child.contributor.email === email) {
				void child.triggerChange();
			}
		}
	}

	@debug({ args: false })
	private async getPresenceMap(contributors: GitContributor[]) {
		// Only get presence for the current user, because it is far too slow otherwise
		const email = contributors.find(c => c.current)?.email;
		if (email == null) return undefined;

		return this.view.container.vsls.getContactsPresence([email]);
	}

	private async getContributors(
		stats?: boolean,
		deferStats?: boolean,
	): Promise<(ContributorNode | MessageNode | ActionMessageNode)[]> {
		let rev = this.options?.ref;
		const all = rev == null && (this.options?.all ?? configuration.get('views.contributors.showAllBranches'));

		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath!);

		// If there is no ref and we aren't getting all branches, get the upstream of the current branch if there is one
		if (rev == null && !all) {
			try {
				const branch = await svc.branches.getBranch();
				if (branch?.upstream?.name != null && !branch.upstream.missing) {
					rev = '@{u}';
				}
			} catch {}
		}

		let timeout: number;
		const overrideMaxWait = this.getState('overrideMaxWait');
		if (overrideMaxWait) {
			timeout = overrideMaxWait;
			this.deleteState('overrideMaxWait');
		} else {
			timeout = configuration.get('views.contributors.maxWait') * 1000;
		}

		const result = await svc.contributors.getContributors(
			rev,
			{ all: all, merges: this.options?.showMergeCommits, stats: !deferStats && stats },
			this.view.cancellation,
			timeout || undefined,
		);
		if (!result.contributors.length) {
			return [new MessageNode(this.view, this, 'No contributors could be found.')];
		}

		const children: (ContributorNode | MessageNode | ActionMessageNode)[] = [];
		if (result.cancelled) {
			children.push(
				new ActionMessageNode(
					this.view,
					this,
					n => {
						n.update({
							iconPath: new ThemeIcon('loading~spin'),
							message: 'Loading contributors...',
							description: `waiting for ${(timeout * 2) / 1000}s`,
							tooltip: null,
						});
						this.storeState('overrideMaxWait', timeout * 2);
						void this.triggerChange(true);
					},
					stats ? 'Showing incomplete contributors and statistics' : 'Showing incomplete contributors',
					result.cancelled.reason === 'timedout' ? `timed out after ${timeout / 1000}s` : 'cancelled',
					'Click to retry and wait longer for contributors',
					new ThemeIcon('warning', new ThemeColor('list.warningForeground' satisfies CoreColors)),
				),
			);
		}

		if (deferStats && stats) {
			children.push(
				new MessageNode(
					this.view,
					this,
					'Loading statistics...',
					undefined,
					undefined,
					new ThemeIcon('loading~spin'),
				),
			);
		}

		sortContributors(result.contributors);
		const presenceMap = this.view.container.vsls.active
			? await this.getPresenceMap(result.contributors)
			: undefined;

		for (const c of result.contributors) {
			children.push(
				new ContributorNode(this.uri, this.view, this, c, {
					all: all,
					ref: rev,
					presence: presenceMap,
					showMergeCommits: this.options?.showMergeCommits,
				}),
			);
		}

		return children;
	}
}
