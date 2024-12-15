import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { BranchesViewConfig, ViewBranchesLayout, ViewFilesLayout } from '../config';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitBranchReference, GitRevisionReference } from '../git/models/reference';
import { getReferenceLabel } from '../git/models/reference.utils';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { groupRepositories } from '../git/models/repository.utils';
import { getWorktreesByBranch } from '../git/models/worktree.utils';
import { gate } from '../system/decorators/gate';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { BranchesNode } from './nodes/branchesNode';
import { BranchNode } from './nodes/branchNode';
import { BranchOrTagFolderNode } from './nodes/branchOrTagFolderNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class BranchesRepositoryNode extends RepositoryFolderNode<BranchesView, BranchesNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new BranchesNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent) {
		if (this.view.config.showStashes && e.changed(RepositoryChange.Stash, RepositoryChangeComparisonMode.Any)) {
			return true;
		}

		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Heads,
			RepositoryChange.Index,
			RepositoryChange.Remotes,
			RepositoryChange.RemoteProviders,
			RepositoryChange.Status,
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
				this.view.message = 'Loading branches...';
				await this.view.container.git.isDiscoveringRepositories;
			}

			let repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No branches could be found.';
				return [];
			}

			if (configuration.get('views.collapseWorktreesWhenPossible')) {
				const grouped = await groupRepositories(repositories);
				repositories = [...grouped.keys()];
			}

			// Get all the worktree branches (and track if they are opened) to pass along downstream, e.g. in the BranchNode to display an indicator
			const worktreesByBranch = await getWorktreesByBranch(repositories, { includeDefault: true });
			this.updateContext({
				worktreesByBranch: worktreesByBranch?.size ? worktreesByBranch : undefined,
			});

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new BranchesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const { showRemoteBranches } = this.view.config;
			const defaultRemote = showRemoteBranches ? (await child.repo.git.getDefaultRemote())?.name : undefined;

			const branches = await child.repo.git.getBranches({
				filter: b =>
					!b.remote || (showRemoteBranches && defaultRemote != null && b.getRemoteName() === defaultRemote),
			});
			if (branches.values.length === 0) {
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

	constructor(container: Container, grouped?: boolean) {
		super(container, 'branches', 'Branches', 'branchesView', grouped);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showBranches');
	}

	override get canSelectMany(): boolean {
		return this.container.prereleaseOrDebugging;
	}

	protected getRoot() {
		return new BranchesViewNode(this);
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
					this.container.git.resetCaches('branches');
					return this.refresh(true);
				},
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setLayoutToList'), () => this.setLayout('list'), this),
			registerViewCommand(this.getQualifiedCommand('setLayoutToTree'), () => this.setLayout('tree'), this),
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
			!configuration.changed(e, 'sortBranchesBy') &&
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	findBranch(branch: GitBranchReference, token?: CancellationToken) {
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

	async findCommit(commit: GitCommit | { repoPath: string; ref: string }, token?: CancellationToken) {
		const { repoPath } = commit;

		// Get all the branches the commit is on
		const branches = await this.container.git.getCommitBranches(
			commit.repoPath,
			commit.ref,
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
	revealBranch(
		branch: GitBranchReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
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

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealCommit(
		commit: GitRevisionReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
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

				await this.ensureRevealNode(node, options);

				return node;
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
