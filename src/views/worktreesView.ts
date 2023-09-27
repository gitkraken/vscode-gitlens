import type { CancellationToken, ConfigurationChangeEvent, Disposable } from 'vscode';
import { ProgressLocation, ThemeColor, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { ViewFilesLayout, WorktreesViewConfig } from '../config';
import type { Colors } from '../constants';
import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { PlusFeatures } from '../features';
import { GitUri } from '../git/gitUri';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import type { GitWorktree } from '../git/models/worktree';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { gate } from '../system/decorators/gate';
import type { ViewNode } from './nodes/viewNode';
import { RepositoriesSubscribeableNode, RepositoryFolderNode } from './nodes/viewNode';
import { WorktreeNode } from './nodes/worktreeNode';
import { WorktreesNode } from './nodes/worktreesNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class WorktreesRepositoryNode extends RepositoryFolderNode<WorktreesView, WorktreesNode> {
	getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new WorktreesNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent) {
		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Worktrees,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

export class WorktreesViewNode extends RepositoriesSubscribeableNode<WorktreesView, WorktreesRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		const access = await this.view.container.git.access(PlusFeatures.Worktrees);
		if (access.allowed === false) return [];

		if (this.children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No worktrees could be found.';

				return [];
			}

			this.view.message = undefined;

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new WorktreesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const children = await child.getChildren();
			if (children.length <= 1) {
				this.view.message = undefined;
				this.view.title = 'Worktrees';

				void child.ensureSubscription();

				return [];
			}

			this.view.message = undefined;
			this.view.title = `Worktrees (${children.length})`;

			return children;
		}

		this.view.title = 'Worktrees';

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Worktrees', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class WorktreesView extends ViewBase<'worktrees', WorktreesViewNode, WorktreesViewConfig> {
	protected readonly configKey = 'worktrees';

	constructor(container: Container) {
		super(container, 'worktrees', 'Worktrees', 'workspaceView');

		this.disposables.push(
			window.registerFileDecorationProvider({
				provideFileDecoration: (uri, _token) => {
					if (uri.scheme !== 'gitlens-view' || uri.authority !== 'worktree') return undefined;

					const [, status] = uri.path.split('/');
					switch (status) {
						case 'changes':
							return {
								badge: '●',
								color: new ThemeColor(
									'gitlens.decorations.worktreeHasUncommittedChangesForegroundColor' as Colors,
								),
								tooltip: 'Has Uncommitted Changes',
							};

						case 'missing':
							return {
								badge: GlyphChars.Warning,
								color: new ThemeColor(
									'gitlens.decorations.worktreeMissingForegroundColor' satisfies Colors,
								),
								tooltip: '',
							};

						default:
							return undefined;
					}
				},
			}),
		);
		this.description = '✨';
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showWorktrees');
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(options);
	}

	protected getRoot() {
		return new WorktreesViewNode(this);
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
				async () => {
					// this.container.git.resetCaches('worktrees');
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
			// !configuration.changed(e, 'sortWorktreesBy')
		) {
			return false;
		}

		return true;
	}

	findWorktree(worktree: GitWorktree, token?: CancellationToken) {
		const { repoPath, uri } = worktree;
		const url = uri.toString();

		return this.findNode(n => n instanceof WorktreeNode && worktree.uri.toString() === url, {
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof WorktreesViewNode) return true;

				if (n instanceof WorktreesRepositoryNode) {
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
			canTraverse: n => n instanceof WorktreesViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	@gate(() => '')
	revealWorktree(
		worktree: GitWorktree,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing worktree '${worktree.name}' in the side bar...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findWorktree(worktree, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
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
}
