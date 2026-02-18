import type { CancellationToken, ConfigurationChangeEvent } from 'vscode';
import { Disposable, ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { onDidFetchAvatar } from '../avatars.js';
import type { ContributorsViewConfig, ViewFilesLayout } from '../config.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import type { GitContributor } from '../git/models/contributor.js';
import type { RepositoryChangeEvent } from '../git/models/repository.js';
import { executeCommand } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { setContext } from '../system/-webview/context.js';
import { gate } from '../system/decorators/gate.js';
import { trace } from '../system/decorators/log.js';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode.js';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode.js';
import type { ViewNode } from './nodes/abstract/viewNode.js';
import { ContributorNode } from './nodes/contributorNode.js';
import { ContributorsNode } from './nodes/contributorsNode.js';
import { updateSorting, updateSortingDirection } from './utils/-webview/sorting.utils.js';
import type { GroupedViewContext, RevealOptions } from './viewBase.js';
import { ViewBase } from './viewBase.js';
import type { CopyNodeCommandArgs } from './viewCommands.js';
import { registerViewCommand } from './viewCommands.js';

export class ContributorsRepositoryNode extends RepositoryFolderNode<ContributorsView, ContributorsNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.child ??= new ContributorsNode(this.uri, this.view, this, this.repo, {
			showMergeCommits: !this.view.state.hideMergeCommits,
		});
		return this.child.getChildren();
	}

	@trace()
	protected override async subscribe(): Promise<Disposable> {
		return Disposable.from(
			await super.subscribe(),
			onDidFetchAvatar(e => this.child?.updateAvatar(e.email)),
		);
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		return e.changed('config', 'heads', 'remotes', 'unknown');
	}
}

export class ContributorsViewNode extends RepositoriesSubscribeableNode<ContributorsView, ContributorsRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				await this.view.container.git.isDiscoveringRepositories;
			}

			const repositories = this.view.getFilteredRepositories();
			if (!repositories.length) {
				this.view.message = 'No contributors could be found.';
				return [];
			}

			const repo = this.view.container.git.getBestRepositoryOrFirst();
			this.children = repositories.map(
				r =>
					new ContributorsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, {
						expand: r === repo,
					}),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const children = await child.getChildren();

			// const all = configuration.get('views.contributors.showAllBranches');

			// let ref: string | undefined;
			// // If we aren't getting all branches, get the upstream of the current branch if there is one
			// if (!all) {
			// 	try {
			// 		const branch = await this.view.container.git.getBranch(this.uri.repoPath);
			// 		if (branch?.upstream?.name != null && !branch.upstream.missing) {
			// 			ref = '@{u}';
			// 		}
			// 	} catch {}
			// }

			// const contributors = await child.repo.getContributors({ all: all, ref: ref });
			if (!children.length) {
				this.view.message = 'No contributors could be found.';
				void child.ensureSubscription();

				return [];
			}

			this.view.description = this.view.getViewDescription(children.length);

			return children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

interface ContributorsViewState {
	hideMergeCommits?: boolean;
}

export class ContributorsView extends ViewBase<'contributors', ContributorsViewNode, ContributorsViewConfig> {
	protected readonly configKey = 'contributors';

	constructor(container: Container, grouped?: GroupedViewContext) {
		super(container, 'contributors', 'Contributors', 'contributorsView', grouped);

		void setContext('gitlens:views:contributors:hideMergeCommits', true);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showContributors');
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	private readonly _state: ContributorsViewState = { hideMergeCommits: true };
	get state(): ContributorsViewState {
		return this._state;
	}

	protected getRoot(): ContributorsViewNode {
		return new ContributorsViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand<CopyNodeCommandArgs>('gitlens.views.copy', this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('refresh'),
				() => {
					this.container.git.resetCaches('contributors');
					return this.refresh(true);
				},
				this,
			),
			registerViewCommand(this.getQualifiedCommand('filterRepositories'), () => this.filterRepositories(), this),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToAuto'),
				() => this.setFilesLayout('auto'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout('list'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout('tree'),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setSortByCount'), () => this.setSortByCount(), this),
			registerViewCommand(this.getQualifiedCommand('setSortByDate'), () => this.setSortByDate(), this),
			registerViewCommand(this.getQualifiedCommand('setSortByName'), () => this.setSortByName(), this),
			registerViewCommand(this.getQualifiedCommand('setSortByScore'), () => this.setSortByScore(), this),
			registerViewCommand(this.getQualifiedCommand('setSortDescending'), () => this.setSortDescending(), this),
			registerViewCommand(this.getQualifiedCommand('setSortAscending'), () => this.setSortAscending(), this),

			registerViewCommand(
				this.getQualifiedCommand('setShowAllBranchesOn'),
				() => this.setShowAllBranches(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowAllBranchesOff'),
				() => this.setShowAllBranches(false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowMergeCommitsOn'),
				() => this.setShowMergeCommits(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowMergeCommitsOff'),
				() => this.setShowMergeCommits(false),
				this,
			),

			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),

			registerViewCommand(
				this.getQualifiedCommand('setShowStatisticsOn'),
				() => this.setShowStatistics(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowStatisticsOff'),
				() => this.setShowStatistics(false),
				this,
			),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent): boolean {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateLocale') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat') &&
			!configuration.changed(e, 'sortContributorsBy') &&
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	findContributor(contributor: GitContributor, token?: CancellationToken): Promise<ViewNode | undefined> {
		const { repoPath, username, email, name } = contributor;

		return this.findNode(
			n =>
				n instanceof ContributorNode &&
				n.contributor.username === username &&
				n.contributor.email === email &&
				n.contributor.name === name,
			{
				maxDepth: 2,
				canTraverse: n => {
					if (n instanceof ContributorsViewNode) return true;

					if (n instanceof ContributorsRepositoryNode) {
						return n.repoPath === repoPath;
					}

					return false;
				},
				token: token,
			},
		);
	}

	@gate(() => '')
	async revealRepository(repoPath: string, options?: RevealOptions): Promise<ViewNode | undefined> {
		const node = await this.findNode(n => n instanceof RepositoryFolderNode && n.repoPath === repoPath, {
			maxDepth: 1,
			canTraverse: n => n instanceof ContributorsViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	@gate(() => '')
	async revealContributor(contributor: GitContributor, options?: RevealOptions): Promise<ViewNode | undefined> {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing contributor '${contributor.name}' in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findContributor(contributor, token);
				if (node == null) return undefined;

				await this.revealDeep(node, options);

				return node;
			},
		);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setSortByCount() {
		return updateSorting('sortContributorsBy', 'count', 'desc');
	}

	private setSortByDate() {
		return updateSorting('sortContributorsBy', 'date', 'desc');
	}

	private setSortByName() {
		return updateSorting('sortContributorsBy', 'name', 'asc');
	}

	private setSortByScore() {
		return updateSorting('sortContributorsBy', 'score', 'desc');
	}

	private setSortDescending() {
		return updateSortingDirection('sortContributorsBy', 'desc');
	}

	private setSortAscending() {
		return updateSortingDirection('sortContributorsBy', 'asc');
	}

	private setShowAllBranches(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showAllBranches` as const, enabled);
	}

	private setShowMergeCommits(on: boolean) {
		void setContext('gitlens:views:contributors:hideMergeCommits', !on);
		this.state.hideMergeCommits = !on;
		void this.refresh(true);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private setShowStatistics(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showStatistics` as const, enabled);
	}
}
