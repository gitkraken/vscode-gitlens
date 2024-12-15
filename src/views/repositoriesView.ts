import type { CancellationToken, ConfigurationChangeEvent, Disposable, Event } from 'vscode';
import { EventEmitter, ProgressLocation, window } from 'vscode';
import type { RepositoriesViewConfig, ViewBranchesLayout, ViewFilesLayout } from '../config';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { getRemoteNameFromBranchName } from '../git/models/branch.utils';
import type { GitCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitContributor } from '../git/models/contributor';
import type {
	GitBranchReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../git/models/reference';
import { getReferenceLabel } from '../git/models/reference.utils';
import type { GitRemote } from '../git/models/remote';
import type { GitWorktree } from '../git/models/worktree';
import { gate } from '../system/decorators/gate';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import { BranchesNode } from './nodes/branchesNode';
import { BranchNode } from './nodes/branchNode';
import { BranchOrTagFolderNode } from './nodes/branchOrTagFolderNode';
import { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import { CompareBranchNode } from './nodes/compareBranchNode';
import { ContributorNode } from './nodes/contributorNode';
import { ContributorsNode } from './nodes/contributorsNode';
import { ReflogNode } from './nodes/reflogNode';
import { RemoteNode } from './nodes/remoteNode';
import { RemotesNode } from './nodes/remotesNode';
import { RepositoriesNode } from './nodes/repositoriesNode';
import { RepositoryNode } from './nodes/repositoryNode';
import { StashesNode } from './nodes/stashesNode';
import { TagsNode } from './nodes/tagsNode';
import { WorktreeNode } from './nodes/worktreeNode';
import { WorktreesNode } from './nodes/worktreesNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class RepositoriesView extends ViewBase<'repositories', RepositoriesNode, RepositoriesViewConfig> {
	protected readonly configKey = 'repositories';

	constructor(container: Container, grouped?: boolean) {
		super(container, 'repositories', 'Repositories', 'repositoriesView', grouped);
	}

	private _onDidChangeAutoRefresh = new EventEmitter<void>();
	get onDidChangeAutoRefresh(): Event<void> {
		return this._onDidChangeAutoRefresh.event;
	}

	protected getRoot() {
		return new RepositoriesNode(this);
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
					this.container.git.resetCaches('branches', 'contributors', 'remotes', 'stashes', 'status', 'tags');
					return this.refresh(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setBranchesLayoutToList'),
				() => this.setBranchesLayout('list'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setBranchesLayoutToTree'),
				() => this.setBranchesLayout('tree'),
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
				this.getQualifiedCommand('setAutoRefreshToOn'),
				() => this.setAutoRefresh(configuration.get('views.repositories.autoRefresh'), true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setAutoRefreshToOff'),
				() => this.setAutoRefresh(configuration.get('views.repositories.autoRefresh'), false),
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
				this.getQualifiedCommand('setBranchesShowBranchComparisonOn'),
				() => this.setBranchShowBranchComparison(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setBranchesShowBranchComparisonOff'),
				() => this.setBranchShowBranchComparison(false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowBranchesOn'),
				() => this.toggleSection('showBranches', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowBranchesOff'),
				() => this.toggleSection('showBranches', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowCommitsOn'),
				() => this.toggleSection('showCommits', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowCommitsOff'),
				() => this.toggleSection('showCommits', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowContributorsOn'),
				() => this.toggleSection('showContributors', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowContributorsOff'),
				() => this.toggleSection('showContributors', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowRemotesOn'),
				() => this.toggleSection('showRemotes', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowRemotesOff'),
				() => this.toggleSection('showRemotes', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowStashesOn'),
				() => this.toggleSection('showStashes', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowStashesOff'),
				() => this.toggleSection('showStashes', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowTagsOn'),
				() => this.toggleSection('showTags', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowTagsOff'),
				() => this.toggleSection('showTags', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowWorktreesOn'),
				() => this.toggleSection('showWorktrees', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowWorktreesOff'),
				() => this.toggleSection('showWorktrees', false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowUpstreamStatusOn'),
				() => this.toggleSection('showUpstreamStatus', true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowUpstreamStatusOff'),
				() => this.toggleSection('showUpstreamStatus', false),
				this,
			),

			registerViewCommand(
				this.getQualifiedCommand('setShowSectionOff'),
				(
					node:
						| BranchesNode
						| BranchNode
						| BranchTrackingStatusNode
						| CompareBranchNode
						| ContributorsNode
						| ReflogNode
						| RemotesNode
						| StashesNode
						| TagsNode
						| WorktreesNode,
				) => this.toggleSectionByNode(node, false),
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
			!configuration.changed(e, 'sortBranchesBy') &&
			!configuration.changed(e, 'sortContributorsBy') &&
			!configuration.changed(e, 'sortTagsBy') &&
			!configuration.changed(e, 'sortRepositoriesBy')
		) {
			return false;
		}

		return true;
	}

	protected override onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, `views.${this.configKey}.autoRefresh` as const)) {
			void this.setAutoRefresh(configuration.get('views.repositories.autoRefresh'));
		}

		super.onConfigurationChanged(e);
	}

	get autoRefresh() {
		return this.config.autoRefresh && this.container.storage.getWorkspace('views:repositories:autoRefresh', true);
	}

	findBranch(branch: GitBranchReference, token?: CancellationToken) {
		const { repoPath } = branch;

		if (branch.remote) {
			return this.findNode((n: any) => n.branch?.ref === branch.ref, {
				allowPaging: true,
				maxDepth: 6,
				canTraverse: n => {
					// Only search for branch nodes in the same repo within BranchesNode
					if (n instanceof RepositoriesNode) return true;

					if (n instanceof RemoteNode) {
						if (n.repoPath !== repoPath) return false;

						return branch.remote && n.remote.name === getRemoteNameFromBranchName(branch.name); //branch.getRemoteName();
					}

					if (
						n instanceof RepositoryNode ||
						n instanceof BranchesNode ||
						n instanceof RemotesNode ||
						n instanceof BranchOrTagFolderNode
					) {
						return n.repoPath === repoPath;
					}

					return false;
				},
				token: token,
			});
		}

		return this.findNode((n: any) => n.branch?.ref === branch.ref, {
			allowPaging: true,
			maxDepth: 5,
			canTraverse: n => {
				// Only search for branch nodes in the same repo within BranchesNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof BranchesNode || n instanceof BranchOrTagFolderNode) {
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
		let branches = await this.container.git.getCommitBranches(
			commit.repoPath,
			commit.ref,
			undefined,
			isCommit(commit) ? { commitDate: commit.committer.date } : undefined,
		);
		if (branches.length !== 0) {
			return this.findNode((n: any) => n.commit?.ref === commit.ref, {
				allowPaging: true,
				maxDepth: 6,
				canTraverse: async n => {
					// Only search for commit nodes in the same repo within BranchNodes
					if (n instanceof RepositoriesNode) return true;

					if (
						n instanceof RepositoryNode ||
						n instanceof BranchesNode ||
						n instanceof BranchOrTagFolderNode
					) {
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

		// If we didn't find the commit on any local branches, check remote branches
		branches = await this.container.git.getCommitBranches(
			commit.repoPath,
			commit.ref,
			undefined,
			isCommit(commit) ? { commitDate: commit.committer.date, remotes: true } : { remotes: true },
		);
		if (branches.length === 0) return undefined;

		const remotes = branches.map(b => b.split('/', 1)[0]);

		return this.findNode((n: any) => n.commit?.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 8,
			canTraverse: n => {
				// Only search for commit nodes in the same repo within BranchNode/RemoteNode
				if (n instanceof RepositoriesNode) return true;

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

	findContributor(contributor: GitContributor, token?: CancellationToken) {
		const { repoPath, username, email, name } = contributor;

		return this.findNode(
			n =>
				n instanceof ContributorNode &&
				n.contributor.username === username &&
				n.contributor.email === email &&
				n.contributor.name === name,
			{
				maxDepth: 2,
				canTraverse: n => {
					// Only search for contributor nodes in the same repo within a ContributorsNode
					if (n instanceof RepositoriesNode) return true;

					if (n instanceof RepositoryNode || n instanceof ContributorsNode) {
						return n.repoPath === repoPath;
					}

					return false;
				},
				token: token,
			},
		);
	}

	findRemote(remote: GitRemote, token?: CancellationToken) {
		const { repoPath } = remote;

		return this.findNode((n: any) => n.remote?.name === remote.name, {
			allowPaging: true,
			maxDepth: 2,
			canTraverse: n => {
				// Only search for remote nodes in the same repo within a RemotesNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof RemotesNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
	}

	findStash(stash: GitStashReference, token?: CancellationToken) {
		const { repoPath } = stash;

		return this.findNode((n: any) => n.commit?.ref === stash.ref, {
			maxDepth: 3,
			canTraverse: n => {
				// Only search for stash nodes in the same repo within a StashesNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof StashesNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
	}

	findTag(tag: GitTagReference, token?: CancellationToken) {
		const { repoPath } = tag;

		return this.findNode((n: any) => n.tag?.ref === tag.ref, {
			allowPaging: true,
			maxDepth: 5,
			canTraverse: n => {
				// Only search for tag nodes in the same repo within TagsNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof TagsNode || n instanceof BranchOrTagFolderNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
			token: token,
		});
	}

	findWorktree(worktree: GitWorktree, token?: CancellationToken) {
		const { repoPath, uri } = worktree;
		const url = uri.toString();

		return this.findNode(n => n instanceof WorktreeNode && worktree.uri.toString() === url, {
			maxDepth: 2,
			canTraverse: n => {
				// Only search for worktree nodes in the same repo within WorktreesNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof WorktreesNode) {
					return n.repoPath === repoPath;
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
				})} in the Repositories view...`,
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
	async revealBranches(
		repoPath: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const node = await this.findNode(n => n instanceof BranchesNode && n.repoPath === repoPath, {
			maxDepth: 2,
			canTraverse: n => {
				// Only search for branches nodes in the same repo
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
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
				})} in the Repositories view...`,
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
	async revealContributor(
		contributor: GitContributor,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing contributor '${contributor.name} in the Repositories view...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findContributor(contributor, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	revealRemote(
		remote: GitRemote,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing remote '${remote.name}' in the side bar...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findRemote(remote, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealRepository(
		repoPath: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const node = await this.findNode(n => n instanceof RepositoryNode && n.repoPath === repoPath, {
			maxDepth: 1,
			canTraverse: n => n instanceof RepositoriesNode,
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
				})} in the Repositories view...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findStash(stash, token);
				if (node !== undefined) {
					await this.reveal(node, options);
				}

				return node;
			},
		);
	}

	@gate(() => '')
	async revealStashes(
		repoPath: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const node = await this.findNode(n => n instanceof StashesNode && n.repoPath === repoPath, {
			maxDepth: 2,
			canTraverse: n => {
				// Only search for stashes nodes in the same repo
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	@gate(() => '')
	revealTag(
		tag: GitTagReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${getReferenceLabel(tag, {
					icon: false,
					quoted: true,
				})} in the Repositories view...`,
				cancellable: true,
			},
			async (_progress, token) => {
				const node = await this.findTag(tag, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealTags(
		repoPath: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const node = await this.findNode(n => n instanceof TagsNode && n.repoPath === repoPath, {
			maxDepth: 2,
			canTraverse: n => {
				// Only search for tags nodes in the same repo
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
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
			async (_progress, token) => {
				const node = await this.findWorktree(worktree, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealWorktrees(
		repoPath: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const node = await this.findNode(n => n instanceof WorktreesNode && n.repoPath === repoPath, {
			maxDepth: 2,
			canTraverse: n => {
				// Only search for worktrees nodes in the same repo
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode) {
					return n.repoPath === repoPath;
				}

				return false;
			},
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	private async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
		if (enabled) {
			if (workspaceEnabled === undefined) {
				workspaceEnabled = this.container.storage.getWorkspace('views:repositories:autoRefresh', true);
			} else {
				await this.container.storage.storeWorkspace('views:repositories:autoRefresh', workspaceEnabled);
			}
		}

		void setContext('gitlens:views:repositories:autoRefresh', enabled && workspaceEnabled);

		this._onDidChangeAutoRefresh.fire();
	}

	private setBranchesLayout(layout: ViewBranchesLayout) {
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
			enabled ? 'working' : false,
		);
	}

	private setBranchShowBranchComparison(enabled: boolean) {
		return configuration.updateEffective(
			`views.${this.configKey}.branches.showBranchComparison` as const,
			enabled ? 'branch' : false,
		);
	}

	toggleSection(
		key:
			| 'showBranches'
			| 'showCommits'
			| 'showContributors'
			// | 'showIncomingActivity'
			| 'showRemotes'
			| 'showStashes'
			| 'showTags'
			| 'showWorktrees'
			| 'showUpstreamStatus',
		enabled: boolean,
	) {
		return configuration.updateEffective(`views.${this.configKey}.${key}` as const, enabled);
	}

	toggleSectionByNode(
		node:
			| BranchesNode
			| BranchNode
			| BranchTrackingStatusNode
			| CompareBranchNode
			| ContributorsNode
			| ReflogNode
			| RemotesNode
			| StashesNode
			| TagsNode
			| WorktreesNode,
		enabled: boolean,
	) {
		if (node instanceof BranchesNode) {
			return configuration.updateEffective(`views.${this.configKey}.showBranches` as const, enabled);
		}

		if (node instanceof BranchNode) {
			return configuration.updateEffective(`views.${this.configKey}.showCommits` as const, enabled);
		}

		if (node instanceof BranchTrackingStatusNode) {
			return configuration.updateEffective(`views.${this.configKey}.showUpstreamStatus` as const, enabled);
		}

		if (node instanceof CompareBranchNode) {
			return this.setShowBranchComparison(enabled);
		}

		if (node instanceof ContributorsNode) {
			return configuration.updateEffective(`views.${this.configKey}.showContributors` as const, enabled);
		}

		if (node instanceof ReflogNode) {
			return configuration.updateEffective(`views.${this.configKey}.showIncomingActivity` as const, enabled);
		}

		if (node instanceof RemotesNode) {
			return configuration.updateEffective(`views.${this.configKey}.showRemotes` as const, enabled);
		}

		if (node instanceof StashesNode) {
			return configuration.updateEffective(`views.${this.configKey}.showStashes` as const, enabled);
		}

		if (node instanceof TagsNode) {
			return configuration.updateEffective(`views.${this.configKey}.showTags` as const, enabled);
		}

		if (node instanceof WorktreesNode) {
			return configuration.updateEffective(`views.${this.configKey}.showWorktrees` as const, enabled);
		}

		return Promise.resolve();
	}
}
