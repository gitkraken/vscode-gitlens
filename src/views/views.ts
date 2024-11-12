import type { ConfigurationChangeEvent, MessageItem } from 'vscode';
import { Disposable, window } from 'vscode';
import type { Commands } from '../constants.commands';
import type { GroupableTreeViewTypes } from '../constants.views';
import type { Container } from '../container';
import type { GitContributor } from '../git/models/contributor';
import type {
	GitBranchReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../git/models/reference';
import type { GitRemote } from '../git/models/remote';
import type { GitWorktree } from '../git/models/worktree';
import type { GraphWebviewShowingArgs } from '../plus/webviews/graph/registration';
import { registerGraphWebviewView } from '../plus/webviews/graph/registration';
import type { PatchDetailsWebviewShowingArgs } from '../plus/webviews/patchDetails/registration';
import { registerPatchDetailsWebviewView } from '../plus/webviews/patchDetails/registration';
import type { TimelineWebviewShowingArgs } from '../plus/webviews/timeline/registration';
import { registerTimelineWebviewView } from '../plus/webviews/timeline/registration';
import { first } from '../system/iterable';
import { executeCommand, executeCoreCommand, registerCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { getContext, setContext } from '../system/vscode/context';
import type { CommitDetailsWebviewShowingArgs } from '../webviews/commitDetails/registration';
import {
	registerCommitDetailsWebviewView,
	registerGraphDetailsWebviewView,
} from '../webviews/commitDetails/registration';
import type { HomeWebviewShowingArgs } from '../webviews/home/registration';
import { registerHomeWebviewView } from '../webviews/home/registration';
import type { WebviewsController, WebviewViewProxy } from '../webviews/webviewsController';
import { BranchesView } from './branchesView';
import { CommitsView } from './commitsView';
import { ContributorsView } from './contributorsView';
import { DraftsView } from './draftsView';
import { FileHistoryView } from './fileHistoryView';
import { LaunchpadView } from './launchpadView';
import { LineHistoryView } from './lineHistoryView';
import { PullRequestView } from './pullRequestView';
import { RemotesView } from './remotesView';
import { RepositoriesView } from './repositoriesView';
import { ScmGroupedView } from './scmGroupedView';
import { SearchAndCompareView } from './searchAndCompareView';
import { StashesView } from './stashesView';
import { TagsView } from './tagsView';
import type { TreeViewByType, ViewsWithRepositoryFolders } from './viewBase';
import { ViewCommands } from './viewCommands';
import { WorkspacesView } from './workspacesView';
import { WorktreesView } from './worktreesView';

export class Views implements Disposable {
	private readonly _disposable: Disposable;

	private _lastSelectedScmGroupedView: GroupableTreeViewTypes | undefined;
	get lastSelectedScmGroupedView() {
		if (!this._scmGroupedViews.size) return undefined;

		if (!this._lastSelectedScmGroupedView || !this._scmGroupedViews.has(this._lastSelectedScmGroupedView)) {
			return first(this._scmGroupedViews);
		}

		return this._lastSelectedScmGroupedView;
	}
	set lastSelectedScmGroupedView(type: GroupableTreeViewTypes | undefined) {
		this._lastSelectedScmGroupedView = type;
		void setContext('gitlens:views:scm:grouped:view', type);
		void this.container.storage.storeWorkspace('views:scm:grouped:selected', type);
	}

	private _scmGroupedView: ScmGroupedView | undefined;
	private _scmGroupedViews!: Set<GroupableTreeViewTypes>;
	get scmGroupedViews() {
		return this._scmGroupedViews;
	}

	private _welcomeDismissed = false;

	constructor(
		private readonly container: Container,
		webviews: WebviewsController,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			new ViewCommands(container),
			...this.registerViews(),
			...this.registerWebviewViews(webviews),
			...this.registerCommands(),
		);

		this._welcomeDismissed = container.storage.get('views:scm:grouped:welcome:dismissed', false);

		this._lastSelectedScmGroupedView = this.container.storage.getWorkspace(
			'views:scm:grouped:selected',
			configuration.get('views.scm.grouped.default'),
		);
		this.updateScmGroupedViewsRegistration();
	}

	dispose() {
		this._scmGroupedView?.dispose();
		this._branchesView?.dispose();
		this._commitsView?.dispose();
		this._contributorsView?.dispose();
		this._launchpadView?.dispose();
		this._remotesView?.dispose();
		this._repositoriesView?.dispose();
		this._searchAndCompareView?.dispose();
		this._stashesView?.dispose();
		this._tagsView?.dispose();
		this._worktreesView?.dispose();

		this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'views.scm.grouped.default')) {
			this.lastSelectedScmGroupedView ??= configuration.get('views.scm.grouped.default');
		}

		if (configuration.changed(e, 'views.scm.grouped.views')) {
			this.updateScmGroupedViewsRegistration();
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.views.branches.regroup', () => this.toggleScmViewGrouping('branches', true)),
			registerCommand('gitlens.views.scm.grouped.branches.detach', () =>
				this.toggleScmViewGrouping('branches', false),
			),
			registerCommand('gitlens.views.scm.grouped.branches.regroup', () =>
				this.toggleScmViewGrouping('branches', true),
			),
			registerCommand('gitlens.views.scm.grouped.branches.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('branches'),
			),
			registerCommand('gitlens.views.commits.regroup', () => this.toggleScmViewGrouping('commits', true)),
			registerCommand('gitlens.views.scm.grouped.commits.detach', () =>
				this.toggleScmViewGrouping('commits', false),
			),
			registerCommand('gitlens.views.scm.grouped.commits.regroup', () =>
				this.toggleScmViewGrouping('commits', true),
			),
			registerCommand('gitlens.views.scm.grouped.commits.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('commits'),
			),
			registerCommand('gitlens.views.contributors.regroup', () =>
				this.toggleScmViewGrouping('contributors', true),
			),
			registerCommand('gitlens.views.scm.grouped.contributors.detach', () =>
				this.toggleScmViewGrouping('contributors', false),
			),
			registerCommand('gitlens.views.scm.grouped.contributors.regroup', () =>
				this.toggleScmViewGrouping('contributors', true),
			),
			registerCommand('gitlens.views.scm.grouped.contributors.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('contributors'),
			),
			registerCommand('gitlens.views.launchpad.regroup', () => this.toggleScmViewGrouping('launchpad', true)),
			registerCommand('gitlens.views.scm.grouped.launchpad.detach', () =>
				this.toggleScmViewGrouping('launchpad', false),
			),
			registerCommand('gitlens.views.scm.grouped.launchpad.regroup', () =>
				this.toggleScmViewGrouping('launchpad', true),
			),
			registerCommand('gitlens.views.scm.grouped.launchpad.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('launchpad'),
			),
			registerCommand('gitlens.views.remotes.regroup', () => this.toggleScmViewGrouping('remotes', true)),
			registerCommand('gitlens.views.scm.grouped.remotes.detach', () =>
				this.toggleScmViewGrouping('remotes', false),
			),
			registerCommand('gitlens.views.scm.grouped.remotes.regroup', () =>
				this.toggleScmViewGrouping('remotes', true),
			),
			registerCommand('gitlens.views.scm.grouped.remotes.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('remotes'),
			),
			registerCommand('gitlens.views.repositories.regroup', () =>
				this.toggleScmViewGrouping('repositories', true),
			),
			registerCommand('gitlens.views.scm.grouped.repositories.detach', () =>
				this.toggleScmViewGrouping('repositories', false),
			),
			registerCommand('gitlens.views.scm.grouped.repositories.regroup', () =>
				this.toggleScmViewGrouping('repositories', true),
			),
			registerCommand('gitlens.views.scm.grouped.repositories.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('repositories'),
			),
			registerCommand('gitlens.views.searchAndCompare.regroup', () =>
				this.toggleScmViewGrouping('searchAndCompare', true),
			),
			registerCommand('gitlens.views.scm.grouped.searchAndCompare.detach', () =>
				this.toggleScmViewGrouping('searchAndCompare', false),
			),
			registerCommand('gitlens.views.scm.grouped.searchAndCompare.regroup', () =>
				this.toggleScmViewGrouping('searchAndCompare', true),
			),
			registerCommand('gitlens.views.scm.grouped.searchAndCompare.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('searchAndCompare'),
			),
			registerCommand('gitlens.views.stashes.regroup', () => this.toggleScmViewGrouping('stashes', true)),
			registerCommand('gitlens.views.scm.grouped.stashes.detach', () =>
				this.toggleScmViewGrouping('stashes', false),
			),
			registerCommand('gitlens.views.scm.grouped.stashes.regroup', () =>
				this.toggleScmViewGrouping('stashes', true),
			),
			registerCommand('gitlens.views.scm.grouped.stashes.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('stashes'),
			),
			registerCommand('gitlens.views.tags.regroup', () => this.toggleScmViewGrouping('tags', true)),
			registerCommand('gitlens.views.scm.grouped.tags.detach', () => this.toggleScmViewGrouping('tags', false)),
			registerCommand('gitlens.views.scm.grouped.tags.regroup', () => this.toggleScmViewGrouping('tags', true)),
			registerCommand('gitlens.views.scm.grouped.tags.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('tags'),
			),
			registerCommand('gitlens.views.worktrees.regroup', () => this.toggleScmViewGrouping('worktrees', true)),
			registerCommand('gitlens.views.scm.grouped.worktrees.detach', () =>
				this.toggleScmViewGrouping('worktrees', false),
			),
			registerCommand('gitlens.views.scm.grouped.worktrees.regroup', () =>
				this.toggleScmViewGrouping('worktrees', true),
			),
			registerCommand('gitlens.views.scm.grouped.worktrees.setAsDefault', () =>
				this.setAsScmGroupedDefaultView('worktrees'),
			),

			registerCommand('gitlens.views.scm.grouped.welcome.dismiss', () => {
				this._welcomeDismissed = true;
				void this.container.storage.store('views:scm:grouped:welcome:dismissed', true);
				this.updateScmGroupedViewsRegistration();
			}),
			registerCommand('gitlens.views.scm.grouped.welcome.restore', async () => {
				this._welcomeDismissed = true;
				void this.container.storage.store('views:scm:grouped:welcome:dismissed', true);
				await updateScmGroupedViewsInConfig(new Set());
			}),
		];
	}

	private registerViews(): Disposable[] {
		return [
			(this._draftsView = new DraftsView(this.container)),
			(this._fileHistoryView = new FileHistoryView(this.container)),
			(this._lineHistoryView = new LineHistoryView(this.container)),
			(this._pullRequestView = new PullRequestView(this.container)),
			(this._workspacesView = new WorkspacesView(this.container)),
		];
	}

	registerWebviewViews(webviews: WebviewsController) {
		return [
			(this._commitDetailsView = registerCommitDetailsWebviewView(webviews)),
			(this._graphView = registerGraphWebviewView(webviews)),
			(this._graphDetailsView = registerGraphDetailsWebviewView(webviews)),
			(this._homeView = registerHomeWebviewView(webviews)),
			(this._patchDetailsView = registerPatchDetailsWebviewView(webviews)),
			(this._timelineView = registerTimelineWebviewView(webviews)),
		];
	}

	private async setAsScmGroupedDefaultView(type: GroupableTreeViewTypes) {
		this.lastSelectedScmGroupedView = type;
		await configuration.updateEffective('views.scm.grouped.default', type);
	}

	private async toggleScmViewGrouping(type: GroupableTreeViewTypes, grouped: boolean) {
		if (grouped) {
			if (!this._scmGroupedViews.has(type)) {
				this._scmGroupedViews.add(type);
				this.lastSelectedScmGroupedView = type;
			}
		} else if (this._scmGroupedViews.has(type)) {
			this._scmGroupedViews.delete(type);
			if (type === this.lastSelectedScmGroupedView) {
				this.lastSelectedScmGroupedView = first(this._scmGroupedViews);
			}
		}

		await updateScmGroupedViewsInConfig(this._scmGroupedViews);

		// Show the view after the configuration change has been applied
		setTimeout(() => executeCoreCommand(`gitlens.views.${grouped ? 'scm.grouped' : type}.focus`), 1);
	}

	private async showWelcomeNotification() {
		this._welcomeDismissed = true;

		const newInstall = getContext('gitlens:newInstall', false);

		const confirm: MessageItem = { title: 'OK', isCloseAffordance: true };
		const Restore: MessageItem = { title: 'Restore Previous Locations' };

		const buttons = newInstall ? [confirm] : [confirm, Restore];

		const result = await window.showInformationMessage(
			newInstall
				? 'GitLens groups many related views—Commits, Branches, Stashes, etc—together for easier view management. Use the tabs in the view header to navigate, detach, or regroup views.'
				: "In GitLens 16, we've grouped many related views—Commits, Branches, Stashes, etc—together for easier view management. Use the tabs in the view header to navigate, detach, or regroup views.",
			...buttons,
		);

		if (result === Restore) {
			executeCommand('gitlens.views.scm.grouped.welcome.restore' as Commands);
		} else {
			executeCommand('gitlens.views.scm.grouped.welcome.dismiss' as Commands);
		}
	}

	private updateScmGroupedViewsRegistration(bypassWelcomeView?: boolean) {
		void setContext('gitlens:views:scm:grouped:welcome:dismissed', this._welcomeDismissed);
		if (!this._welcomeDismissed) {
			if (!bypassWelcomeView) return;

			// If we are bypassing the welcome view, show it as a notification -- since we can't block the view from loading
			void this.showWelcomeNotification();
		}

		const groupedViews = getScmGroupedViewsFromConfig();

		// If we are going from 0 to > 0, we need to force the views to refresh (since there is some VS Code bug)
		const forceRefresh = this._scmGroupedViews?.size === 0 && groupedViews.size;

		this._scmGroupedViews = groupedViews;

		if (forceRefresh) {
			void setContext('gitlens:views:scm:grouped:refresh', true).then(() =>
				setContext('gitlens:views:scm:grouped:refresh', undefined).then(() =>
					this.updateScmGroupedViewsRegistration(),
				),
			);
			return;
		}

		this._scmGroupedView?.dispose();
		this._scmGroupedView = undefined;

		if (!this._scmGroupedViews.has('branches')) {
			this._branchesView ??= new BranchesView(this.container);
		} else {
			this._branchesView?.dispose();
			this._branchesView = undefined;
		}

		if (!this._scmGroupedViews.has('commits')) {
			this._commitsView ??= new CommitsView(this.container);
		} else {
			this._commitsView?.dispose();
			this._commitsView = undefined;
		}

		if (!this._scmGroupedViews.has('contributors')) {
			this._contributorsView ??= new ContributorsView(this.container);
		} else {
			this._contributorsView?.dispose();
			this._contributorsView = undefined;
		}

		if (!this._scmGroupedViews.has('launchpad')) {
			this._launchpadView ??= new LaunchpadView(this.container);
		} else {
			this._launchpadView?.dispose();
			this._launchpadView = undefined;
		}

		if (!this._scmGroupedViews.has('remotes')) {
			this._remotesView ??= new RemotesView(this.container);
		} else {
			this._remotesView?.dispose();
			this._remotesView = undefined;
		}

		if (!this._scmGroupedViews.has('repositories')) {
			this._repositoriesView ??= new RepositoriesView(this.container);
		} else {
			this._repositoriesView?.dispose();
			this._repositoriesView = undefined;
		}

		if (!this._scmGroupedViews.has('searchAndCompare')) {
			this._searchAndCompareView ??= new SearchAndCompareView(this.container);
		} else {
			this._searchAndCompareView?.dispose();
			this._searchAndCompareView = undefined;
		}

		if (!this._scmGroupedViews.has('stashes')) {
			this._stashesView ??= new StashesView(this.container);
		} else {
			this._stashesView?.dispose();
			this._stashesView = undefined;
		}

		if (!this._scmGroupedViews.has('tags')) {
			this._tagsView ??= new TagsView(this.container);
		} else {
			this._tagsView?.dispose();
			this._tagsView = undefined;
		}

		if (!this._scmGroupedViews.has('worktrees')) {
			this._worktreesView ??= new WorktreesView(this.container);
		} else {
			this._worktreesView?.dispose();
			this._worktreesView = undefined;
		}

		if (this._scmGroupedViews.size) {
			this._scmGroupedView ??= new ScmGroupedView(this.container, this);
			// } else {
			// 	this._scmGroupedView?.dispose();
			// 	this._scmGroupedView = undefined;
		}
	}

	private _branchesView: BranchesView | undefined;
	get branches(): BranchesView {
		return this._branchesView ?? this.getScmGroupedView('branches');
	}

	private _commitsView: CommitsView | undefined;
	get commits(): CommitsView {
		return this._commitsView ?? this.getScmGroupedView('commits');
	}

	private _commitDetailsView!: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	get commitDetails() {
		return this._commitDetailsView;
	}

	private _contributorsView: ContributorsView | undefined;
	get contributors(): ContributorsView {
		return this._contributorsView ?? this.getScmGroupedView('contributors');
	}

	private _draftsView!: DraftsView;
	get drafts(): DraftsView {
		return this._draftsView;
	}

	private _fileHistoryView!: FileHistoryView;
	get fileHistory(): FileHistoryView {
		return this._fileHistoryView;
	}

	private _graphView!: WebviewViewProxy<GraphWebviewShowingArgs>;
	get graph() {
		return this._graphView;
	}

	private _graphDetailsView!: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	get graphDetails() {
		return this._graphDetailsView;
	}

	private _homeView!: WebviewViewProxy<HomeWebviewShowingArgs>;
	get home() {
		return this._homeView;
	}

	private _launchpadView!: LaunchpadView | undefined;
	get launchpad(): LaunchpadView {
		return this._launchpadView ?? this.getScmGroupedView('launchpad');
	}

	private _lineHistoryView!: LineHistoryView;
	get lineHistory(): LineHistoryView {
		return this._lineHistoryView;
	}

	private _patchDetailsView!: WebviewViewProxy<PatchDetailsWebviewShowingArgs>;
	get patchDetails() {
		return this._patchDetailsView;
	}

	private _pullRequestView!: PullRequestView;
	get pullRequest(): PullRequestView {
		return this._pullRequestView;
	}

	private _remotesView: RemotesView | undefined;
	get remotes(): RemotesView {
		return this._remotesView ?? this.getScmGroupedView('remotes');
	}

	private _repositoriesView!: RepositoriesView | undefined;
	get repositories(): RepositoriesView {
		return this._repositoriesView ?? this.getScmGroupedView('repositories');
	}

	private _searchAndCompareView: SearchAndCompareView | undefined;
	get searchAndCompare(): SearchAndCompareView {
		return this._searchAndCompareView ?? this.getScmGroupedView('searchAndCompare');
	}

	private _stashesView: StashesView | undefined;
	get stashes(): StashesView {
		return this._stashesView ?? this.getScmGroupedView('stashes');
	}

	private _tagsView: TagsView | undefined;
	get tags(): TagsView {
		return this._tagsView ?? this.getScmGroupedView('tags');
	}

	private _timelineView!: WebviewViewProxy<TimelineWebviewShowingArgs>;
	get timeline() {
		return this._timelineView;
	}

	private _worktreesView: WorktreesView | undefined;
	get worktrees(): WorktreesView {
		return this._worktreesView ?? this.getScmGroupedView('worktrees');
	}

	private _workspacesView!: WorkspacesView;
	get workspaces(): WorkspacesView {
		return this._workspacesView;
	}

	private getScmGroupedView<T extends GroupableTreeViewTypes>(type: T): TreeViewByType[T] {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		// Use a proxy to guard against the view not existing or having been disposed

		let view: TreeViewByType[T] | undefined;
		const proxy = new Proxy<TreeViewByType[T]>(Object.create(null) as TreeViewByType[T], {
			get: function (_target, prop) {
				if (view == null || view.disposed) {
					if (self._scmGroupedView == null) {
						// Don't bother creating the view if we are just checking visibility
						if (prop === 'visible') return false;

						self.updateScmGroupedViewsRegistration(true);
					}
					view = self._scmGroupedView!.setView(type);
				}

				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return (view as any)[prop];
			},
		});
		return proxy;
	}

	async revealBranch(
		branch: GitBranchReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const branches = branch.remote ? this.remotes : this.branches;
		const view = branches.canReveal ? branches : this.repositories;

		const node = await view.revealBranch(branch, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealCommit(
		commit: GitRevisionReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const { commits } = this;
		const view = commits.canReveal ? commits : this.repositories;

		const node = await view.revealCommit(commit, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealContributor(
		contributor: GitContributor,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const { contributors } = this;
		const view = contributors.canReveal ? contributors : this.repositories;

		const node = await view.revealContributor(contributor, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealRemote(
		remote: GitRemote | undefined,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const { remotes } = this;
		const view = remotes.canReveal ? remotes : this.repositories;

		const node = remote != null ? await view.revealRemote(remote, options) : undefined;
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealRepository(
		repoPath: string,
		useView?: ViewsWithRepositoryFolders,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const view = useView == null || useView.canReveal === false ? this.repositories : useView;

		const node = await view.revealRepository(repoPath, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealStash(
		stash: GitStashReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const { stashes } = this;
		const view = stashes.canReveal ? stashes : this.repositories;

		const node = await view.revealStash(stash, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealTag(
		tag: GitTagReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const { tags } = this;
		const view = tags.canReveal ? tags : this.repositories;

		const node = await view.revealTag(tag, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}

	async revealWorktree(
		worktree: GitWorktree,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const { worktrees } = this;
		const view = worktrees.canReveal ? worktrees : this.repositories;

		const node = await view.revealWorktree(worktree, options);
		await view.show({ preserveFocus: !options?.focus });
		return node;
	}
}

const defaultScmGroupedViews: Record<GroupableTreeViewTypes, boolean> = Object.freeze({
	commits: true,
	branches: true,
	remotes: true,
	stashes: true,
	tags: true,
	worktrees: true,
	contributors: true,
	repositories: false,
	searchAndCompare: true,
	launchpad: false,
});

function getScmGroupedViewsFromConfig() {
	const groupedViews = {
		...defaultScmGroupedViews,
		...configuration.get('views.scm.grouped.views', undefined, defaultScmGroupedViews),
	};
	return new Set<GroupableTreeViewTypes>(
		Object.keys(groupedViews).filter(
			key => groupedViews[key as GroupableTreeViewTypes],
		) as GroupableTreeViewTypes[],
	);
}

async function updateScmGroupedViewsInConfig(groupedViews: Set<GroupableTreeViewTypes>) {
	await configuration.updateEffective('views.scm.grouped.views', {
		commits: groupedViews.has('commits'),
		branches: groupedViews.has('branches'),
		remotes: groupedViews.has('remotes'),
		stashes: groupedViews.has('stashes'),
		tags: groupedViews.has('tags'),
		worktrees: groupedViews.has('worktrees'),
		contributors: groupedViews.has('contributors'),
		repositories: groupedViews.has('repositories'),
		searchAndCompare: groupedViews.has('searchAndCompare'),
		launchpad: groupedViews.has('launchpad'),
	});
}
