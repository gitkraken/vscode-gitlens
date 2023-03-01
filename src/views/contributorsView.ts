import type { CancellationToken, ConfigurationChangeEvent } from 'vscode';
import { Disposable, ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { onDidFetchAvatar } from '../avatars';
import type { ContributorsViewConfig } from '../config';
import { ViewFilesLayout } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitContributor } from '../git/models/contributor';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { gate } from '../system/decorators/gate';
import { debug } from '../system/decorators/log';
import { ContributorNode } from './nodes/contributorNode';
import { ContributorsNode } from './nodes/contributorsNode';
import { RepositoryNode } from './nodes/repositoryNode';
import type { ViewNode } from './nodes/viewNode';
import { RepositoriesSubscribeableNode, RepositoryFolderNode } from './nodes/viewNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class ContributorsRepositoryNode extends RepositoryFolderNode<ContributorsView, ContributorsNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new ContributorsNode(this.uri, this.view, this, this.repo);
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
		if (this.children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No contributors could be found.';

				return [];
			}

			this.view.message = undefined;

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
				this.view.title = 'Contributors';

				void child.ensureSubscription();

				return [];
			}

			this.view.message = undefined;
			this.view.title = `Contributors (${children.length})`;

			return children;
		}

		this.view.title = 'Contributors';

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class ContributorsView extends ViewBase<ContributorsViewNode, ContributorsViewConfig> {
	protected readonly configKey = 'contributors';

	constructor(container: Container) {
		super(container, 'gitlens.views.contributors', 'Contributors', 'contributorsView');
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showContributors');
	}

	protected getRoot() {
		return new ContributorsViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.activeSelection, this.selection),
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
				() => this.setFilesLayout(ViewFilesLayout.Auto),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout(ViewFilesLayout.List),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout(ViewFilesLayout.Tree),
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
			!configuration.changed(e, 'sortContributorsBy')
		) {
			return false;
		}

		return true;
	}

	findContributor(contributor: GitContributor, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(contributor.repoPath);

		return this.findNode(
			ContributorNode.getId(contributor.repoPath, contributor.name, contributor.email, contributor.username),
			{
				maxDepth: 2,
				canTraverse: n => {
					if (n instanceof ContributorsViewNode) return true;

					if (n instanceof ContributorsRepositoryNode) {
						return n.id.startsWith(repoNodeId);
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
		const node = await this.findNode(RepositoryFolderNode.getId(repoPath), {
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
			async (progress, token) => {
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

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private setShowStatistics(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showStatistics` as const, enabled);
	}
}
