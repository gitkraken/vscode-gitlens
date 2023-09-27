import type {
	CancellationToken,
	ConfigurationChangeEvent,
	TreeViewSelectionChangeEvent,
	TreeViewVisibilityChangeEvent,
} from 'vscode';
import { Disposable, ProgressLocation, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { CommitsViewConfig, ViewFilesLayout } from '../config';
import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitRevisionReference } from '../git/models/reference';
import { getReferenceLabel } from '../git/models/reference';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { createCommand, executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import { gate } from '../system/decorators/gate';
import { debug } from '../system/decorators/log';
import { disposableInterval } from '../system/function';
import type { UsageChangeEvent } from '../telemetry/usageTracker';
import { BranchNode } from './nodes/branchNode';
import { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import { CommitFileNode } from './nodes/commitFileNode';
import { CommitNode } from './nodes/commitNode';
import { CommandMessageNode } from './nodes/common';
import { FileRevisionAsCommitNode } from './nodes/fileRevisionAsCommitNode';
import type { ViewNode } from './nodes/viewNode';
import { RepositoriesSubscribeableNode, RepositoryFolderNode } from './nodes/viewNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class CommitsRepositoryNode extends RepositoryFolderNode<CommitsView, BranchNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			const branch = await this.repo.getBranch();
			if (branch == null) {
				this.view.message = 'No commits could be found.';

				return [];
			}

			this.view.message = undefined;

			let authors;
			if (this.view.state.myCommitsOnly) {
				const user = await this.view.container.git.getCurrentUser(this.repo.path);
				if (user != null) {
					authors = [{ name: user.name, email: user.email, username: user.username, id: user.id }];
				}
			}

			this.child = new BranchNode(
				this.uri,
				this.view,
				this.splatted ? this.parent ?? this : this,
				this.repo,
				branch,
				true,
				{
					expanded: true,
					limitCommits: !this.splatted,
					showComparison: this.view.config.showBranchComparison,
					showCurrent: false,
					showTracking: true,
					authors: authors,
				},
			);
		}

		return this.child.getChildren();
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false) {
		if (reset) {
			this.child = undefined;
		} else {
			void this.parent?.triggerChange(false);
		}

		await this.ensureSubscription();
	}

	@debug()
	protected override async subscribe() {
		const lastFetched = (await this.repo?.getLastFetched()) ?? 0;

		const interval = Repository.getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			return Disposable.from(
				await super.subscribe(),
				disposableInterval(() => {
					// Check if the interval should change, and if so, reset it
					if (interval !== Repository.getLastFetchedUpdateInterval(lastFetched)) {
						void this.resetSubscription();
					}

					if (this.splatted) {
						this.view.triggerNodeChange(this.parent ?? this);
					} else {
						this.view.triggerNodeChange(this);
					}
				}, interval),
			);
		}

		return super.subscribe();
	}

	protected changed(e: RepositoryChangeEvent) {
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

export class CommitsViewNode extends RepositoriesSubscribeableNode<CommitsView, CommitsRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No commits could be found.';

				return [];
			}

			this.view.message = undefined;

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r =>
					new CommitsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat, {
						showBranchAndLastFetched: true,
					}),
			);
		}

		const commitGraphNode =
			configuration.get('plusFeatures.enabled') &&
			this.view.container.usage.get('graphView:shown') == null &&
			this.view.container.usage.get('graphWebview:shown') == null
				? new CommandMessageNode(
						this.view,
						this,
						createCommand(Commands.ShowGraph, 'Show Commit Graph'),
						'Visualize commits on the Commit Graph ✨',
						undefined,
						'Visualize commits on the Commit Graph ✨',
						new ThemeIcon('gitlens-graph'),
				  )
				: undefined;

		if (this.children.length === 1) {
			const [child] = this.children;

			const branch = await child.repo.getBranch();
			if (branch != null) {
				const lastFetched = (await child.repo.getLastFetched()) ?? 0;

				const status = branch.getTrackingStatus();
				this.view.description = `${status ? `${status} ${GlyphChars.Dot} ` : ''}${branch.name}${
					branch.rebasing ? ' (Rebasing)' : ''
				}${lastFetched ? ` ${GlyphChars.Dot} Last fetched ${Repository.formatLastFetched(lastFetched)}` : ''}`;
			}

			return commitGraphNode == null ? child.getChildren() : [commitGraphNode, ...(await child.getChildren())];
		}

		return commitGraphNode == null ? this.children : [commitGraphNode, ...this.children];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Commits', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

interface CommitsViewState {
	myCommitsOnly?: boolean;
}

export class CommitsView extends ViewBase<'commits', CommitsViewNode, CommitsViewConfig> {
	protected readonly configKey = 'commits';

	constructor(container: Container) {
		super(container, 'commits', 'Commits', 'commitsView');
		this.disposables.push(container.usage.onDidChange(this.onUsageChanged, this));
	}

	private onUsageChanged(e: UsageChangeEvent | void) {
		// Refresh the view if the graph usage state has changed, since we render a node for it before the first use
		if (e == null || e.key === 'graphView:shown' || e.key === 'graphWebview:shown') {
			void this.refresh();
		}
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showCommits');
	}

	private readonly _state: CommitsViewState = {};
	get state(): CommitsViewState {
		return this._state;
	}

	protected getRoot() {
		return new CommitsViewNode(this);
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
					this.container.git.resetCaches('branches', 'status', 'tags');
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
				this.getQualifiedCommand('setMyCommitsOnlyOn'),
				() => this.setMyCommitsOnly(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setMyCommitsOnlyOff'),
				() => this.setMyCommitsOnly(false),
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
			!configuration.changed(e, 'defaultTimeFormat') &&
			!configuration.changed(e, 'plusFeatures.enabled')
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

		if (node instanceof CommitNode || node instanceof FileRevisionAsCommitNode || node instanceof CommitFileNode) {
			this.container.events.fire(
				'commit:selected',
				{
					commit: node.commit,
					interaction: 'passive',
					preserveFocus: true,
					preserveVisibility: true,
				},
				{ source: this.id },
			);
		}

		if (node instanceof FileRevisionAsCommitNode || node instanceof CommitFileNode) {
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

	async findCommit(commit: GitCommit | { repoPath: string; ref: string }, token?: CancellationToken) {
		const { repoPath } = commit;

		const branch = await this.container.git.getBranch(commit.repoPath);
		if (branch == null) return undefined;

		// Check if the commit exists on the current branch
		const branches = await this.container.git.getCommitBranches(commit.repoPath, commit.ref, {
			branch: branch.name,
			commitDate: isCommit(commit) ? commit.committer.date : undefined,
		});
		if (!branches.length) return undefined;

		return this.findNode((n: any) => n.commit?.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 2,
			canTraverse: async n => {
				if (n instanceof CommitsViewNode) {
					let node: ViewNode | undefined = await n.getSplattedChild?.();
					if (node instanceof CommitsRepositoryNode) {
						node = await node.getSplattedChild?.();
						if (node instanceof BranchNode) {
							await node.loadMore({ until: commit.ref });
						}
					}

					return true;
				}

				if (n instanceof CommitsRepositoryNode) {
					if (n.repoPath === repoPath) {
						const node = await n.getSplattedChild?.();
						if (node instanceof BranchNode) {
							await node.loadMore({ until: commit.ref });
							return true;
						}
					}
				}

				if (n instanceof BranchTrackingStatusNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
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
			async (progress, token) => {
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
			canTraverse: n => n instanceof CommitsViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setMyCommitsOnly(enabled: boolean) {
		void setContext('gitlens:views:commits:myCommitsOnly', enabled);
		this.state.myCommitsOnly = enabled;
		void this.refresh(true);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private setShowBranchComparison(enabled: boolean) {
		return configuration.updateEffective(
			`views.${this.configKey}.showBranchComparison` as const,
			enabled ? 'working' : false,
		);
	}

	private async setShowBranchPullRequest(enabled: boolean) {
		await configuration.updateEffective(`views.${this.configKey}.pullRequests.showForBranches` as const, enabled);
		await configuration.updateEffective(`views.${this.configKey}.pullRequests.enabled` as const, enabled);
	}
}
