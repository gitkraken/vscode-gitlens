import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { BranchesViewConfig, ViewBranchesLayout, ViewFilesLayout } from '../config';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitBranchReference, GitRevisionReference } from '../git/models/reference';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { getWorktreesByBranch } from '../git/utils/-webview/worktree.utils';
import { getReferenceLabel } from '../git/utils/reference.utils';
import { executeCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { gate } from '../system/decorators/gate';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { BranchesNode } from './nodes/branchesNode';
import { BranchNode } from './nodes/branchNode';
import { BranchOrTagFolderNode } from './nodes/branchOrTagFolderNode';
import { updateSorting, updateSortingDirection } from './utils/-webview/sorting.utils';
import type { GroupedViewContext, RevealOptions } from './viewBase';
import { ViewBase } from './viewBase';
import type { CopyNodeCommandArgs } from './viewCommands';
import { registerViewCommand } from './viewCommands';

export class BranchesRepositoryNode extends RepositoryFolderNode<BranchesView, BranchesNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.child ??= new BranchesNode(this.uri, this.view, this, this.repo);
		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		if (this.view.config.showStashes && e.changed(RepositoryChange.Stash, RepositoryChangeComparisonMode.Any)) {
			return true;
		}

		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Heads,
			RepositoryChange.Index,
			RepositoryChange.Remotes,
			RepositoryChange.RemoteProviders,
			RepositoryChange.PausedOperationStatus,
			RepositoryChange.Starred,
			RepositoryChange.Worktrees,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

export class BranchesViewNode extends RepositoriesSubscribeableNode<BranchesView, BranchesRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				await this.view.container.git.isDiscoveringRepositories;
			}

			const repositories = await this.view.getFilteredRepositories();
			if (!repositories.length) {
				this.view.message = 'No branches could be found.';
				return [];
			}

			// Get all the worktree branches (and track if they are opened) to pass along downstream, e.g. in the BranchNode to display an indicator
			const worktreesByBranch = await getWorktreesByBranch(repositories, { includeDefault: true });
			this.updateContext({
				worktreesByBranch: worktreesByBranch?.size ? worktreesByBranch : undefined,
			});

			this.children = repositories.map(
				r => new BranchesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const { showRemoteBranches } = this.view.config;
			const defaultRemote = showRemoteBranches
				? (await child.repo.git.remotes.getDefaultRemote())?.name
				: undefined;

			const branches = await child.repo.git.branches.getBranches({
				filter: b =>
					!b.remote || (showRemoteBranches && defaultRemote != null && b.getRemoteName() === defaultRemote),
			});
			if (!branches.values.length) {
				this.view.message = 'No branches could be found.';
				void child.ensureSubscription();

				return [];
			}

			this.view.description = this.view.getViewDescription(branches.values.length);

			return child.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Branches', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class BranchesView extends ViewBase<'branches', BranchesViewNode, BranchesViewConfig> {
	protected readonly configKey = 'branches';

	constructor(container: Container, grouped?: GroupedViewContext) {
		super(container, 'branches', 'Branches', 'branchesView', grouped);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showBranches');
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	protected getRoot(): BranchesViewNode {
		return new BranchesViewNode(this);
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
					this.container.git.resetCaches('branches', 'worktrees');
					return this.refresh(true);
				},
				this,
			),
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
			registerViewCommand(
				this.getQualifiedCommand('setShowRemoteBranchesOn'),
				() => this.setShowRemoteBranches(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowRemoteBranchesOff'),
				() => this.setShowRemoteBranches(false),
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
			!configuration.changed(e, 'sortBranchesBy') &&
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	async findBranch(branch: GitBranchReference, token?: CancellationToken): Promise<ViewNode | undefined> {
		if (branch.remote) return undefined;

		const { repoPath } = branch;

		return this.findNode((n: any) => n.branch?.ref === branch.ref, {
			allowPaging: true,
			maxDepth: 4,
			canTraverse: n => {
				if (n instanceof BranchesViewNode) return true;

				if (n instanceof BranchesRepositoryNode || n instanceof BranchOrTagFolderNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
	}

	async findCommit(
		commit: GitCommit | { repoPath: string; ref: string },
		token?: CancellationToken,
	): Promise<ViewNode | undefined> {
		const { repoPath } = commit;

		// Get all the branches the commit is on
		const branches = await this.container.git
			.getRepositoryService(commit.repoPath)
			.branches.getBranchesWithCommits(
				[commit.ref],
				undefined,
				isCommit(commit) ? { commitDate: commit.committer.date } : undefined,
			);
		if (branches.length === 0) return undefined;

		return this.findNode((n: any) => n.commit?.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 5,
			canTraverse: async n => {
				if (n instanceof BranchesViewNode) return true;

				if (n instanceof BranchesRepositoryNode || n instanceof BranchOrTagFolderNode) {
					return n.repoPath === repoPath;
				}

				if (n instanceof BranchNode && n.repoPath === repoPath && branches.includes(n.branch.name)) {
					await n.loadMore({ until: commit.ref });
					return true;
				}

				return false;
			},
			token: token,
		});
	}

	@gate(() => '')
	async revealBranch(branch: GitBranchReference, options?: RevealOptions): Promise<ViewNode | undefined> {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${getReferenceLabel(branch, {
					icon: false,
					quoted: true,
				})} in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findBranch(branch, token);
				if (node == null) return undefined;

				await this.revealDeep(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealCommit(commit: GitRevisionReference, options?: RevealOptions): Promise<ViewNode | undefined> {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${getReferenceLabel(commit, {
					icon: false,
					quoted: true,
				})} in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findCommit(commit, token);
				if (node == null) return undefined;

				await this.revealDeep(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealRepository(repoPath: string, options?: RevealOptions): Promise<ViewNode | undefined> {
		const node = await this.findNode(n => n instanceof RepositoryFolderNode && n.repoPath === repoPath, {
			maxDepth: 1,
			canTraverse: n => n instanceof BranchesViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	private setLayout(layout: ViewBranchesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.branches.layout` as const, layout);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setSortByDate() {
		return updateSorting('sortBranchesBy', 'date', 'desc');
	}

	private setSortByName() {
		return updateSorting('sortBranchesBy', 'name', 'asc');
	}

	private setSortDescending() {
		return updateSortingDirection('sortBranchesBy', 'desc');
	}

	private setSortAscending() {
		return updateSortingDirection('sortBranchesBy', 'asc');
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

	private setShowRemoteBranches(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showRemoteBranches` as const, enabled);
	}

	private setShowStashes(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showStashes` as const, enabled);
	}
}
