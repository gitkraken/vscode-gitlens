import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { RemotesViewConfig, ViewBranchesLayout, ViewFilesLayout } from '../config';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitBranchReference, GitRevisionReference } from '../git/models/reference';
import type { GitRemote } from '../git/models/remote';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { getRemoteNameFromBranchName } from '../git/utils/branch.utils';
import { getReferenceLabel } from '../git/utils/reference.utils';
import { executeCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { gate } from '../system/decorators/gate';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { BranchNode } from './nodes/branchNode';
import { BranchOrTagFolderNode } from './nodes/branchOrTagFolderNode';
import { RemoteNode } from './nodes/remoteNode';
import { RemotesNode } from './nodes/remotesNode';
import { RepositoryNode } from './nodes/repositoryNode';
import { updateSorting, updateSortingDirection } from './utils/-webview/sorting.utils';
import type { GroupedViewContext, RevealOptions } from './viewBase';
import { ViewBase } from './viewBase';
import type { CopyNodeCommandArgs } from './viewCommands';
import { registerViewCommand } from './viewCommands';

export class RemotesRepositoryNode extends RepositoryFolderNode<RemotesView, RemotesNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new RemotesNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent): boolean {
		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Remotes,
			RepositoryChange.RemoteProviders,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

export class RemotesViewNode extends RepositoriesSubscribeableNode<RemotesView, RemotesRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				await this.view.container.git.isDiscoveringRepositories;
			}

			const repositories = await this.view.getFilteredRepositories();
			if (!repositories.length) {
				this.view.message = 'No remotes could be found.';
				return [];
			}

			this.children = repositories.map(
				r => new RemotesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const remotes = await child.repo.git.remotes.getRemotes();
			if (!remotes.length) {
				this.view.message = 'No remotes could be found.';
				void child.ensureSubscription();

				return [];
			}

			this.view.description = this.view.getViewDescription(remotes.length);

			return child.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Remotes', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class RemotesView extends ViewBase<'remotes', RemotesViewNode, RemotesViewConfig> {
	protected readonly configKey = 'remotes';

	constructor(container: Container, grouped?: GroupedViewContext) {
		super(container, 'remotes', 'Remotes', 'remotesView', grouped);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showRemotes');
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	protected getRoot(): RemotesViewNode {
		return new RemotesViewNode(this);
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
					this.container.git.resetCaches('branches', 'remotes', 'worktrees');
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
				this.getQualifiedCommand('setShowBranchPullRequestOn'),
				() => this.setShowBranchPullRequest(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowBranchPullRequestOff'),
				() => this.setShowBranchPullRequest(false),
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
			!configuration.changed(e, 'integrations.enabled') &&
			!configuration.changed(e, 'sortBranchesBy') &&
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	async findBranch(branch: GitBranchReference, token?: CancellationToken): Promise<ViewNode | undefined> {
		if (!branch.remote) return undefined;

		const { repoPath } = branch;

		return this.findNode((n: any) => n.branch?.ref === branch.ref, {
			allowPaging: true,
			maxDepth: 5,
			canTraverse: n => {
				if (n instanceof RemotesViewNode) return true;

				if (n instanceof RemotesRepositoryNode || n instanceof BranchOrTagFolderNode) {
					return n.repoPath === repoPath;
				}

				if (n instanceof RemoteNode) {
					return n.repoPath === repoPath && n.remote.name === getRemoteNameFromBranchName(branch.name);
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

		// Get all the remote branches the commit is on
		const branches = await this.container.git
			.getRepositoryService(commit.repoPath)
			.branches.getBranchesWithCommits(
				[commit.ref],
				undefined,
				isCommit(commit) ? { commitDate: commit.committer.date, remotes: true } : { remotes: true },
			);
		if (branches.length === 0) return undefined;

		const remotes = branches.map(b => b.split('/', 1)[0]);

		return this.findNode((n: any) => n.commit?.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 6,
			canTraverse: n => {
				if (n instanceof RemotesViewNode) return true;

				if (n instanceof RemotesRepositoryNode || n instanceof BranchOrTagFolderNode) {
					return n.repoPath === repoPath;
				}

				if (n instanceof RemoteNode) {
					return n.repoPath === repoPath && remotes.includes(n.remote.name);
				}

				if (n instanceof BranchNode) {
					return n.repoPath === repoPath && branches.includes(n.branch.name);
				}

				if (n instanceof RepositoryNode || n instanceof RemotesNode || n instanceof BranchOrTagFolderNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
	}

	async findRemote(remote: GitRemote, token?: CancellationToken): Promise<ViewNode | undefined> {
		const { repoPath } = remote;

		return this.findNode((n: any) => n.remote?.name === remote.name, {
			allowPaging: true,
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof RemotesViewNode) return true;

				if (n instanceof RemotesRepositoryNode) {
					return n.repoPath === repoPath;
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
	async revealRemote(remote: GitRemote, options?: RevealOptions): Promise<ViewNode | undefined> {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing remote '${remote.name}' in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findRemote(remote, token);
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
			canTraverse: n => n instanceof RemotesViewNode || n instanceof RepositoryFolderNode,
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

	private async setShowBranchPullRequest(enabled: boolean) {
		await configuration.updateEffective(`views.${this.configKey}.pullRequests.showForBranches` as const, enabled);
		await configuration.updateEffective(`views.${this.configKey}.pullRequests.enabled` as const, enabled);
	}
}
