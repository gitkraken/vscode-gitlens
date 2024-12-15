import type { CancellationToken, ConfigurationChangeEvent } from 'vscode';
import { Disposable, ProgressLocation, ThemeIcon, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { CommitsViewConfig, ViewFilesLayout } from '../config';
import { GlyphChars } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import { matchContributor } from '../git/models/contributor';
import type { GitRevisionReference } from '../git/models/reference';
import { getReferenceLabel } from '../git/models/reference.utils';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import type { GitUser } from '../git/models/user';
import { showContributorsPicker } from '../quickpicks/contributorsPicker';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { gate } from '../system/decorators/gate';
import { debug } from '../system/decorators/log';
import { disposableInterval } from '../system/function';
import { createCommand, executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import type { UsageChangeEvent } from '../telemetry/usageTracker';
import { RepositoriesSubscribeableNode } from './nodes/abstract/repositoriesSubscribeableNode';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ViewNode } from './nodes/abstract/viewNode';
import { BranchNode } from './nodes/branchNode';
import { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import { CommandMessageNode } from './nodes/common';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class CommitsRepositoryNode extends RepositoryFolderNode<CommitsView, BranchNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			const branch = await this.repo.git.getBranch();
			if (branch == null) {
				this.view.message = 'No commits could be found.';

				return [];
			}

			this.view.message = undefined;

			const authors = this.view.state.filterCommits.get(this.repo.id);
			this.child = new BranchNode(
				this.uri,
				this.view,
				this.splatted ? this.parent ?? this : this,
				this.repo,
				branch,
				true,
				{
					expand: true,
					limitCommits: !this.splatted,
					showComparison: this.view.config.showBranchComparison,
					showStatusDecorationOnly: true,
					showMergeCommits: !this.view.state.hideMergeCommits,
					showStashes: this.view.config.showStashes,
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

export class CommitsViewNode extends RepositoriesSubscribeableNode<CommitsView, CommitsRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		this.view.description = this.view.getViewDescription();
		this.view.message = undefined;

		if (this.children == null) {
			if (this.view.container.git.isDiscoveringRepositories) {
				this.view.message = 'Loading commits...';
				await this.view.container.git.isDiscoveringRepositories;
			}

			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No commits could be found.';

				return [];
			}

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r =>
					new CommitsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat, {
						showBranchAndLastFetched: true,
					}),
			);
		}

		const children = [];

		if (
			configuration.get('plusFeatures.enabled') &&
			!this.view.grouped &&
			this.view.container.usage.get('graphView:shown') == null &&
			this.view.container.usage.get('graphWebview:shown') == null
		) {
			children.push(
				new CommandMessageNode(
					this.view,
					this,
					createCommand(GlCommand.ShowGraph, 'Show Commit Graph'),
					'Visualize commits on the Commit Graph',
					undefined,
					'Visualize commits on the Commit Graph',
					new ThemeIcon('gitlens-graph'),
				),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const branch = await child.repo.git.getBranch();
			if (branch != null) {
				const descParts = [];

				if (branch.rebasing) {
					descParts.push(`${branch.name} (Rebasing)`);
				} else {
					descParts.push(branch.name);
				}

				const status = branch.getTrackingStatus();
				if (status) {
					descParts.push(status);
				}

				this.view.description = `${
					this.view.grouped ? `${this.view.name.toLocaleLowerCase()}: ` : ''
				}${descParts.join(` ${GlyphChars.Dot} `)}`;
			}

			children.push(...(await child.getChildren()));
		} else {
			children.push(...this.children);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Commits', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

interface CommitsViewState {
	filterCommits: Map<string, GitUser[] | undefined>;
	hideMergeCommits?: boolean;
}

export class CommitsView extends ViewBase<'commits', CommitsViewNode, CommitsViewConfig> {
	protected readonly configKey = 'commits';

	constructor(container: Container, grouped?: boolean) {
		super(container, 'commits', 'Commits', 'commitsView', grouped);
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

	override get canSelectMany(): boolean {
		return this.container.prereleaseOrDebugging;
	}

	private readonly _state: CommitsViewState = { filterCommits: new Map<string, GitUser[] | undefined>() };
	get state(): CommitsViewState {
		return this._state;
	}

	protected getRoot() {
		return new CommitsViewNode(this);
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
				this.getQualifiedCommand('setCommitsFilterAuthors'),
				n => this.setCommitsFilter(n, true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setCommitsFilterOff'),
				n => this.setCommitsFilter(n, false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowMergeCommitsOn'),
				() => this.setShowMergeCommits(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowMergeCommitsOff'),
				() => this.setShowMergeCommits(false),
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
			!configuration.changed(e, 'plusFeatures.enabled') &&
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	async findCommit(commit: GitCommit | { repoPath: string; ref: string }, token?: CancellationToken) {
		const { repoPath } = commit;

		const branch = await this.container.git.getBranch(commit.repoPath);
		if (branch == null) return undefined;

		// Check if the commit exists on the current branch
		const branches = await this.container.git.getCommitBranches(commit.repoPath, commit.ref, branch.name, {
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

	private async setCommitsFilter(node: ViewNode, filter: boolean) {
		let repo;
		if (node != null) {
			if (node.is('repo-folder')) {
				repo = node.repo;
			} else {
				let parent: ViewNode | undefined = node;
				do {
					parent = parent.getParent();
					if (parent?.is('repo-folder')) {
						repo = parent.repo;
						break;
					}
				} while (parent != null);
			}
		}

		if (filter) {
			repo ??= await getRepositoryOrShowPicker('Filter Commits', 'Choose a repository');
			if (repo == null) return;

			let authors = this.state.filterCommits.get(repo.id);
			if (authors == null) {
				const current = await this.container.git.getCurrentUser(repo.uri);
				authors = current != null ? [current] : undefined;
			}

			const result = await showContributorsPicker(
				this.container,
				repo,
				'Filter Commits',
				repo.virtual ? 'Choose a contributor to show commits from' : 'Choose contributors to show commits from',
				{
					appendReposToTitle: true,
					clearButton: true,
					multiselect: !repo.virtual,
					picked: c => authors?.some(u => matchContributor(c, u)) ?? false,
				},
			);
			if (result == null) return;

			if (result.length === 0) {
				filter = false;
				this.state.filterCommits.delete(repo.id);
			} else {
				this.state.filterCommits.set(repo.id, result);
			}
		} else if (repo != null) {
			this.state.filterCommits.delete(repo.id);
		} else {
			this.state.filterCommits.clear();
		}

		void setContext('gitlens:views:commits:filtered', this.state.filterCommits.size !== 0);
		void this.refresh(true);
	}

	private setShowMergeCommits(on: boolean) {
		void setContext('gitlens:views:commits:hideMergeCommits', !on);
		this.state.hideMergeCommits = !on;
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

	private setShowStashes(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showStashes` as const, enabled);
	}
}
