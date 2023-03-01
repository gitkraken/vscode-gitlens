import type {
	CancellationToken,
	ConfigurationChangeEvent,
	Disposable,
	TreeViewSelectionChangeEvent,
	TreeViewVisibilityChangeEvent,
} from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { StashesViewConfig } from '../config';
import { ViewFilesLayout } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitStashReference } from '../git/models/reference';
import { getReferenceLabel } from '../git/models/reference';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { gate } from '../system/decorators/gate';
import { RepositoryNode } from './nodes/repositoryNode';
import { StashesNode } from './nodes/stashesNode';
import { StashFileNode } from './nodes/stashFileNode';
import { StashNode } from './nodes/stashNode';
import type { ViewNode } from './nodes/viewNode';
import { RepositoriesSubscribeableNode, RepositoryFolderNode } from './nodes/viewNode';
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
		if (this.children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No stashes could be found.';

				return [];
			}

			this.view.message = undefined;

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new StashesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const stash = await child.repo.getStash();
			if (stash == null || stash.commits.size === 0) {
				this.view.message = 'No stashes could be found.';
				this.view.title = 'Stashes';

				void child.ensureSubscription();

				return [];
			}

			this.view.message = undefined;
			this.view.title = `Stashes (${stash.commits.size})`;

			return child.getChildren();
		}

		this.view.title = 'Stashes';

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Stashes', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class StashesView extends ViewBase<StashesViewNode, StashesViewConfig> {
	protected readonly configKey = 'stashes';

	constructor(container: Container) {
		super(container, 'gitlens.views.stashes', 'Stashes', 'stashesView');
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showStashes');
	}

	protected getRoot() {
		return new StashesViewNode(this);
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
					this.container.git.resetCaches('stashes');
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
			!configuration.changed(e, 'defaultTimeFormat')
		) {
			return false;
		}

		return true;
	}

	protected override onSelectionChanged(e: TreeViewSelectionChangeEvent<ViewNode>) {
		super.onSelectionChanged(e);
		this.notifySelections();
	}

	protected override onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		super.onVisibilityChanged(e);
		if (e.visible) {
			this.notifySelections();
		}
	}

	private notifySelections() {
		const node = this.selection?.[0];
		if (node == null) return;

		if (node instanceof StashNode || node instanceof StashFileNode) {
			this.container.events.fire(
				'commit:selected',
				{
					commit: node.commit,
					pin: false,
					preserveFocus: true,
					preserveVisibility: true,
				},
				{ source: this.id },
			);
		}

		if (node instanceof StashFileNode) {
			this.container.events.fire(
				'file:selected',
				{
					uri: node.uri,
					preserveFocus: true,
					preserveVisibility: true,
				},
				{ source: this.id },
			);
		}
	}

	findStash(stash: GitStashReference, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(stash.repoPath);

		return this.findNode(StashNode.getId(stash.repoPath, stash.ref), {
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof StashesViewNode) return true;

				if (n instanceof StashesRepositoryNode) {
					return n.id.startsWith(repoNodeId);
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
		const node = await this.findNode(RepositoryFolderNode.getId(repoPath), {
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
			async (progress, token) => {
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
