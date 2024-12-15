import type { CancellationToken, ConfigurationChangeEvent } from 'vscode';
import { Disposable, ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { onDidFetchAvatar } from '../avatars';
import type { ContributorsViewConfig, ViewFilesLayout } from '../config';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitContributor } from '../git/models/contributor';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { groupRepositories } from '../git/models/repository.utils';
import { gate } from '../system/decorators/gate';
import { debug } from '../system/decorators/log';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { ContributorNode } from './nodes/contributorNode';
import { ContributorsNode } from './nodes/contributorsNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class ContributorsRepositoryNode extends RepositoryFolderNode<ContributorsView, ContributorsNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new ContributorsNode(this.uri, this.view, this, this.repo, {
				showMergeCommits: !this.view.state.hideMergeCommits,
			});
		}

		return this.child.getChildren();
	}

	@debug()
	protected override async subscribe() {
		return Disposable.from(
			await super.subscribe(),
			onDidFetchAvatar(e => this.child?.updateAvatar(e.email)),
		);
	}

	protected changed(e: RepositoryChangeEvent) {
		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Heads,
			RepositoryChange.Remotes,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

export class ContributorsViewNode extends RepositoriesSubscribeableNode<ContributorsView, ContributorsRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				this.view.message = 'Loading contributors...';
				await this.view.container.git.isDiscoveringRepositories;
			}

			let repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No contributors could be found.';
				return [];
			}

			if (
				configuration.get('views.collapseWorktreesWhenPossible') &&
				configuration.get('views.contributors.showAllBranches')
			) {
				const grouped = await groupRepositories(repositories);
				repositories = [...grouped.keys()];
			}

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new ContributorsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
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
			if (children.length === 0) {
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

	constructor(container: Container, grouped?: boolean) {
		super(container, 'contributors', 'Contributors', 'contributorsView', grouped);

		void setContext('gitlens:views:contributors:hideMergeCommits', true);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showContributors');
	}

	override get canSelectMany(): boolean {
		return this.container.prereleaseOrDebugging;
	}

	private readonly _state: ContributorsViewState = { hideMergeCommits: true };
	get state(): ContributorsViewState {
		return this._state;
	}

	protected getRoot() {
		return new ContributorsViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(GlCommand.ViewsCopy, this.activeSelection, this.selection),
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

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
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
			!configuration.changed(e, 'sortRepositoriesBy') &&
			!configuration.changed(e, 'views.collapseWorktreesWhenPossible')
		) {
			return false;
		}

		return true;
	}

	findContributor(contributor: GitContributor, token?: CancellationToken) {
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
	async revealRepository(
		repoPath: string,
		options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
	) {
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
	async revealContributor(
		contributor: GitContributor,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing contributor '${contributor.name}' in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findContributor(contributor, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
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
