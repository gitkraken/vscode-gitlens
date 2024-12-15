import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { StashesViewConfig, ViewFilesLayout } from '../config';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitStashReference } from '../git/models/reference';
import { getReferenceLabel } from '../git/models/reference.utils';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { groupRepositories } from '../git/models/repository.utils';
import { gate } from '../system/decorators/gate';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { StashesNode } from './nodes/stashesNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class StashesRepositoryNode extends RepositoryFolderNode<StashesView, StashesNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new StashesNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent) {
		return e.changed(RepositoryChange.Stash, RepositoryChange.Unknown, RepositoryChangeComparisonMode.Any);
	}
}

export class StashesViewNode extends RepositoriesSubscribeableNode<StashesView, StashesRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				this.view.message = 'Loading stashes...';
				await this.view.container.git.isDiscoveringRepositories;
			}

			let repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No stashes could be found.';
				return [];
			}

			if (configuration.get('views.collapseWorktreesWhenPossible')) {
				const grouped = await groupRepositories(repositories);
				repositories = [...grouped.keys()];
			}

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new StashesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const gitStash = await child.repo.git.getStash();
			if (!gitStash?.stashes.size) {
				this.view.message = 'No stashes could be found.';
				void child.ensureSubscription();

				return [];
			}

			this.view.description = this.view.getViewDescription(gitStash.stashes.size);

			return child.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Stashes', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class StashesView extends ViewBase<'stashes', StashesViewNode, StashesViewConfig> {
	protected readonly configKey = 'stashes';

	constructor(container: Container, grouped?: boolean) {
		super(container, 'stashes', 'Stashes', 'stashesView', grouped);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showStashes');
	}

	override get canSelectMany(): boolean {
		return this.container.prereleaseOrDebugging;
	}

	protected getRoot() {
		return new StashesViewNode(this);
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
					this.container.git.resetCaches('stashes');
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
			!configuration.changed(e, 'sortRepositoriesBy') &&
			!configuration.changed(e, 'views.collapseWorktreesWhenPossible')
		) {
			return false;
		}

		return true;
	}

	findStash(stash: GitStashReference, token?: CancellationToken) {
		const { repoPath } = stash;

		return this.findNode((n: any) => n.commit?.ref === stash.ref, {
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof StashesViewNode) return true;

				if (n instanceof StashesRepositoryNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
	}

	@gate(() => '')
	async revealRepository(
		repoPath: string,
		options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
	) {
		const node = await this.findNode(n => n instanceof RepositoryFolderNode && n.repoPath === repoPath, {
			maxDepth: 1,
			canTraverse: n => n instanceof StashesViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	@gate(() => '')
	async revealStash(
		stash: GitStashReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${getReferenceLabel(stash, {
					icon: false,
					quoted: true,
				})} in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findStash(stash, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}
}
