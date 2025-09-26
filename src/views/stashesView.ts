import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { StashesViewConfig, ViewFilesLayout } from '../config';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitStashReference } from '../git/models/reference';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { getReferenceLabel } from '../git/utils/reference.utils';
import { executeCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { gate } from '../system/decorators/gate';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { StashesNode } from './nodes/stashesNode';
import type { GroupedViewContext, RevealOptions } from './viewBase';
import { ViewBase } from './viewBase';
import type { CopyNodeCommandArgs } from './viewCommands';
import { registerViewCommand } from './viewCommands';

export class StashesRepositoryNode extends RepositoryFolderNode<StashesView, StashesNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.child ??= new StashesNode(this.uri, this.view, this, this.repo);
		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		return e.changed(RepositoryChange.Stash, RepositoryChange.Unknown, RepositoryChangeComparisonMode.Any);
	}
}

export class StashesViewNode extends RepositoriesSubscribeableNode<StashesView, StashesRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				await this.view.container.git.isDiscoveringRepositories;
			}

			const repositories = await this.view.getFilteredRepositories();
			if (!repositories.length) {
				this.view.message = 'No stashes could be found.';
				return [];
			}

			this.children = repositories.map(
				r => new StashesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const stash = await child.repo.git.stash?.getStash();
			if (!stash?.stashes.size) {
				this.view.message = 'No stashes could be found.';
				void child.ensureSubscription();

				return [];
			}

			this.view.description = this.view.getViewDescription(stash.stashes.size);

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

	constructor(container: Container, grouped?: GroupedViewContext) {
		super(container, 'stashes', 'Stashes', 'stashesView', grouped);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showStashes');
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	protected getRoot(): StashesViewNode {
		return new StashesViewNode(this);
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
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	findStash(stash: GitStashReference, token?: CancellationToken): Promise<ViewNode | undefined> {
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
	async revealRepository(repoPath: string, options?: RevealOptions): Promise<ViewNode | undefined> {
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
	async revealStash(stash: GitStashReference, options?: RevealOptions): Promise<ViewNode | undefined> {
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

				await this.revealDeep(node, options);

				return node;
			},
		);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}
}
