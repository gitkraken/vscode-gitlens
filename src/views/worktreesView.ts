import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { ViewBranchesLayout, ViewFilesLayout, WorktreesViewConfig } from '../config.js';
import { proBadge } from '../constants.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import type { RepositoryChangeEvent } from '../git/models/repository.js';
import type { GitWorktree } from '../git/models/worktree.js';
import { ensurePlusFeaturesEnabled } from '../plus/gk/utils/-webview/plus.utils.js';
import { executeCommand } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { gate } from '../system/decorators/gate.js';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode.js';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode.js';
import type { ViewNode } from './nodes/abstract/viewNode.js';
import { BranchOrTagFolderNode } from './nodes/branchOrTagFolderNode.js';
import { WorktreeNode } from './nodes/worktreeNode.js';
import { WorktreesNode } from './nodes/worktreesNode.js';
import { updateSorting, updateSortingDirection } from './utils/-webview/sorting.utils.js';
import type { GroupedViewContext, RevealOptions } from './viewBase.js';
import { ViewBase } from './viewBase.js';
import type { CopyNodeCommandArgs } from './viewCommands.js';
import { registerViewCommand } from './viewCommands.js';

export class WorktreesRepositoryNode extends RepositoryFolderNode<WorktreesView, WorktreesNode> {
	getChildren(): Promise<ViewNode[]> {
		this.child ??= new WorktreesNode(this.uri, this.view, this, this.repo);
		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		if (this.view.config.showStashes && e.changed('stash')) {
			return true;
		}

		return e.changed('config', 'heads', 'index', 'remotes', 'remoteProviders', 'pausedOp', 'worktrees', 'unknown');
	}
}

export class WorktreesViewNode extends RepositoriesSubscribeableNode<WorktreesView, WorktreesRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			const access = await this.view.container.git.access('worktrees');
			if (access.allowed === false) return [];

			if (this.view.container.git.isDiscoveringRepositories) {
				await this.view.container.git.isDiscoveringRepositories;
			}

			const repositories = this.view.getFilteredRepositories();
			if (!repositories.length) {
				this.view.message = 'No worktrees could be found.';
				return [];
			}

			const repo = this.view.container.git.getBestRepositoryOrFirst();
			if (repo != null && !(await repo.git.supports('git:worktrees'))) return [];

			this.children = repositories.map(
				r =>
					new WorktreesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, {
						expand: r === repo,
					}),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const grandChildren = await child.getChildren();
			if (grandChildren.length <= 1) {
				void child.ensureSubscription();

				return [];
			}

			this.view.description = this.view.getViewDescription(grandChildren.length);

			return grandChildren;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Worktrees', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class WorktreesView extends ViewBase<'worktrees', WorktreesViewNode, WorktreesViewConfig> {
	protected readonly configKey = 'worktrees';

	constructor(container: Container, grouped?: GroupedViewContext) {
		super(container, 'worktrees', 'Worktrees', 'worktreesView', grouped);
	}

	override getViewDescription(count?: number): string {
		const description = super.getViewDescription(count);
		return description ? `${description} \u00a0\u2022\u00a0 ${proBadge}` : proBadge;
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showWorktrees');
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(options);
	}

	protected getRoot(): WorktreesViewNode {
		return new WorktreesViewNode(this);
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
				async () => {
					this.container.git.resetCaches('branches', 'status', 'worktrees');
					return this.refresh(true);
				},
				this,
			),
			registerViewCommand(this.getQualifiedCommand('filterRepositories'), () => this.filterRepositories(), this),
			registerViewCommand(this.getQualifiedCommand('setLayoutToList'), () => this.setLayout('list'), this),
			registerViewCommand(this.getQualifiedCommand('setLayoutToTree'), () => this.setLayout('tree'), this),
			registerViewCommand(this.getQualifiedCommand('setSortByDate'), () => this.setSortByDate(), this),
			registerViewCommand(this.getQualifiedCommand('setSortByName'), () => this.setSortByName(), this),
			registerViewCommand(this.getQualifiedCommand('setSortDescending'), () => this.setSortDescending(), this),
			registerViewCommand(this.getQualifiedCommand('setSortAscending'), () => this.setSortAscending(), this),
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

			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),
			registerViewCommand(
				this.getQualifiedCommand('setShowBranchComparisonOn'),
				() => this.setShowBranchComparison(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowBranchComparisonOff'),
				() => this.setShowBranchComparison(false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowBranchPullRequestOn'),
				() => this.setShowBranchPullRequest(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowBranchPullRequestOff'),
				() => this.setShowBranchPullRequest(false),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowStashesOn'), () => this.setShowStashes(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowStashesOff'), () => this.setShowStashes(false), this),
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
			!configuration.changed(e, 'sortRepositoriesBy') &&
			!configuration.changed(e, 'sortWorktreesBy')
		) {
			return false;
		}

		return true;
	}

	findWorktree(worktree: GitWorktree, token?: CancellationToken): Promise<ViewNode | undefined> {
		const { repoPath, uri } = worktree;
		const url = uri.toString();

		return this.findNode(n => n instanceof WorktreeNode && n.worktree.uri.toString() === url, {
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof WorktreesViewNode) return true;

				if (n instanceof WorktreesRepositoryNode || n instanceof BranchOrTagFolderNode) {
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
			canTraverse: n => n instanceof WorktreesViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	@gate(() => '')
	async revealWorktree(worktree: GitWorktree, options?: RevealOptions): Promise<ViewNode | undefined> {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing worktree '${worktree.name}' in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findWorktree(worktree, token);
				if (node == null) return undefined;

				await this.revealDeep(node, options);

				return node;
			},
		);
	}

	private setLayout(layout: ViewBranchesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.branches.layout` as const, layout);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setSortByDate() {
		return updateSorting('sortWorktreesBy', 'date', 'desc');
	}

	private setSortByName() {
		return updateSorting('sortWorktreesBy', 'name', 'asc');
	}

	private setSortDescending() {
		return updateSortingDirection('sortWorktreesBy', 'desc');
	}

	private setSortAscending() {
		return updateSortingDirection('sortWorktreesBy', 'asc');
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private setShowBranchComparison(enabled: boolean) {
		return configuration.updateEffective(
			`views.${this.configKey}.showBranchComparison` as const,
			enabled ? 'branch' : false,
		);
	}

	private async setShowBranchPullRequest(enabled: boolean) {
		await configuration.updateEffective(`views.${this.configKey}.pullRequests.showForBranches` as const, enabled);
		await configuration.updateEffective(`views.${this.configKey}.pullRequests.enabled` as const, enabled);
	}

	private setShowStashes(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showStashes` as const, enabled);
	}
}
