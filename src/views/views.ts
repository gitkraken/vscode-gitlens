import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
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
import { executeCoreCommand, registerCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
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
import { getLastView, GroupedView, setLastView } from './groupedView';
import { LaunchpadView } from './launchpadView';
import { LineHistoryView } from './lineHistoryView';
import { PullRequestView } from './pullRequestView';
import { RemotesView } from './remotesView';
import { RepositoriesView } from './repositoriesView';
import { SearchAndCompareView } from './searchAndCompareView';
import { StashesView } from './stashesView';
import { TagsView } from './tagsView';
import type { ViewsWithRepositoryFolders } from './viewBase';
import { ViewCommands } from './viewCommands';
import { WorkspacesView } from './workspacesView';
import { WorktreesView } from './worktreesView';

export class Views implements Disposable {
	private readonly _disposable: Disposable;
	private _groupedViewsDisposable: Disposable;
	private _groupedView!: GroupedView;

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
		this._groupedViewsDisposable = Disposable.from(...this.registerGroupedViews());
	}

	dispose() {
		this._disposable.dispose();
		this._groupedViewsDisposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'views.grouped')) {
			this._groupedViewsDisposable.dispose();
			this._groupedViewsDisposable = Disposable.from(...this.registerGroupedViews());
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.views.branches.close', () => this.toggleViewGrouping('branches', true)),
			registerCommand('gitlens.views.grouped.branches.moveToNewView', () =>
				this.toggleViewGrouping('branches', false),
			),
			registerCommand('gitlens.views.grouped.branches.setAsDefault', () => this.setAsDefaultView('branches')),
			registerCommand('gitlens.views.commits.close', () => this.toggleViewGrouping('commits', true)),
			registerCommand('gitlens.views.grouped.commits.moveToNewView', () =>
				this.toggleViewGrouping('commits', false),
			),
			registerCommand('gitlens.views.grouped.commits.setAsDefault', () => this.setAsDefaultView('commits')),
			registerCommand('gitlens.views.contributors.close', () => this.toggleViewGrouping('contributors', true)),
			registerCommand('gitlens.views.grouped.contributors.moveToNewView', () =>
				this.toggleViewGrouping('contributors', false),
			),
			registerCommand('gitlens.views.grouped.contributors.setAsDefault', () =>
				this.setAsDefaultView('contributors'),
			),
			registerCommand('gitlens.views.remotes.close', () => this.toggleViewGrouping('remotes', true)),
			registerCommand('gitlens.views.grouped.remotes.moveToNewView', () =>
				this.toggleViewGrouping('remotes', false),
			),
			registerCommand('gitlens.views.grouped.remotes.setAsDefault', () => this.setAsDefaultView('remotes')),
			registerCommand('gitlens.views.repositories.close', () => this.toggleViewGrouping('repositories', true)),
			registerCommand('gitlens.views.grouped.repositories.moveToNewView', () =>
				this.toggleViewGrouping('repositories', false),
			),
			registerCommand('gitlens.views.grouped.repositories.setAsDefault', () =>
				this.setAsDefaultView('repositories'),
			),
			registerCommand('gitlens.views.searchAndCompare.close', () =>
				this.toggleViewGrouping('searchAndCompare', true),
			),
			registerCommand('gitlens.views.grouped.searchAndCompare.moveToNewView', () =>
				this.toggleViewGrouping('searchAndCompare', false),
			),
			registerCommand('gitlens.views.grouped.searchAndCompare.setAsDefault', () =>
				this.setAsDefaultView('searchAndCompare'),
			),
			registerCommand('gitlens.views.stashes.close', () => this.toggleViewGrouping('stashes', true)),
			registerCommand('gitlens.views.grouped.stashes.moveToNewView', () =>
				this.toggleViewGrouping('stashes', false),
			),
			registerCommand('gitlens.views.grouped.stashes.setAsDefault', () => this.setAsDefaultView('stashes')),
			registerCommand('gitlens.views.tags.close', () => this.toggleViewGrouping('tags', true)),
			registerCommand('gitlens.views.grouped.tags.moveToNewView', () => this.toggleViewGrouping('tags', false)),
			registerCommand('gitlens.views.grouped.tags.setAsDefault', () => this.setAsDefaultView('tags')),
			registerCommand('gitlens.views.worktrees.close', () => this.toggleViewGrouping('worktrees', true)),
			registerCommand('gitlens.views.grouped.worktrees.moveToNewView', () =>
				this.toggleViewGrouping('worktrees', false),
			),
			registerCommand('gitlens.views.grouped.worktrees.setAsDefault', () => this.setAsDefaultView('worktrees')),
		];
	}

	private registerViews(): Disposable[] {
		return [
			(this._draftsView = new DraftsView(this.container)),
			(this._fileHistoryView = new FileHistoryView(this.container)),
			(this._launchpadView = new LaunchpadView(this.container)),
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

	private registerGroupedViews(): Disposable[] {
		if (configuration.get('views.grouped.enabled')) {
			const included = configuration.get('views.grouped.views', undefined, []);
			void setContext('gitlens:views:grouped:views', included.length ? included.join(',') : ' ');
			void setContext('gitlens:views:grouped:default', included[0]);

			const views: Disposable[] = [];
			if (included.length) {
				views.push((this._groupedView = new GroupedView(this.container, included)));
			} else {
				this._groupedView = undefined!;
			}

			if (!included.includes('branches')) {
				views.push((this._branchesView = new BranchesView(this.container)));
			} else {
				this._branchesView = undefined;
			}

			if (!included.includes('commits')) {
				views.push((this._commitsView = new CommitsView(this.container)));
			} else {
				this._commitsView = undefined;
			}

			if (!included.includes('contributors')) {
				views.push((this._contributorsView = new ContributorsView(this.container)));
			} else {
				this._contributorsView = undefined;
			}

			if (!included.includes('remotes')) {
				views.push((this._remotesView = new RemotesView(this.container)));
			} else {
				this._remotesView = undefined;
			}

			if (!included.includes('repositories')) {
				views.push((this._repositoriesView = new RepositoriesView(this.container)));
			} else {
				this._repositoriesView = undefined;
			}

			if (!included.includes('searchAndCompare')) {
				views.push((this._searchAndCompareView = new SearchAndCompareView(this.container)));
			} else {
				this._searchAndCompareView = undefined;
			}

			if (!included.includes('stashes')) {
				views.push((this._stashesView = new StashesView(this.container)));
			} else {
				this._stashesView = undefined;
			}

			if (!included.includes('tags')) {
				views.push((this._tagsView = new TagsView(this.container)));
			} else {
				this._tagsView = undefined;
			}

			if (!included.includes('worktrees')) {
				views.push((this._worktreesView = new WorktreesView(this.container)));
			} else {
				this._worktreesView = undefined;
			}

			return views;
		}

		void setContext('gitlens:views:grouped:views', undefined);
		void setContext('gitlens:views:grouped:default', undefined);

		return [
			(this._branchesView = new BranchesView(this.container)),
			(this._commitsView = new CommitsView(this.container)),
			(this._contributorsView = new ContributorsView(this.container)),
			(this._remotesView = new RemotesView(this.container)),
			(this._repositoriesView = new RepositoriesView(this.container)),
			(this._searchAndCompareView = new SearchAndCompareView(this.container)),
			(this._stashesView = new StashesView(this.container)),
			(this._tagsView = new TagsView(this.container)),
			(this._worktreesView = new WorktreesView(this.container)),
		];
	}

	private async setAsDefaultView(type: GroupableTreeViewTypes) {
		let included = configuration.get('views.grouped.views', undefined, []);
		if (!included.includes(type)) return;

		// Move the type to be the first in the list (default)
		included = [type, ...included.filter(t => t !== type)];

		setLastView(type);
		await configuration.updateEffective('views.grouped.views', included);
	}

	private async toggleViewGrouping(type: GroupableTreeViewTypes, grouped: boolean) {
		let included = configuration.get('views.grouped.views', undefined, []);

		let changed = false;
		if (grouped) {
			if (!included.includes(type)) {
				changed = true;
				setLastView(type);
				included = included.concat(type);
			}
		} else if (included.includes(type)) {
			changed = true;
			if (type === getLastView()) {
				setLastView(undefined);
			}
			included = included.filter(t => t !== type);
		}

		if (!changed) return;

		await configuration.updateEffective('views.grouped.views', included);

		// Show the view after the configuration change has been applied
		setTimeout(() => executeCoreCommand(`gitlens.views.${type}.focus`), 1);
	}

	private _branchesView: BranchesView | undefined;
	get branches(): BranchesView {
		return this._branchesView ?? this._groupedView.setView('branches');
	}

	private _commitsView: CommitsView | undefined;
	get commits(): CommitsView {
		return this._commitsView ?? this._groupedView.setView('commits');
	}

	private _commitDetailsView!: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	get commitDetails() {
		return this._commitDetailsView;
	}

	private _contributorsView: ContributorsView | undefined;
	get contributors(): ContributorsView {
		return this._contributorsView ?? this._groupedView.setView('contributors');
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

	private _launchpadView!: LaunchpadView;
	get launchpad(): LaunchpadView {
		return this._launchpadView;
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
		return this._remotesView ?? this._groupedView.setView('remotes');
	}

	private _repositoriesView!: RepositoriesView | undefined;
	get repositories(): RepositoriesView {
		return this._repositoriesView ?? this._groupedView.setView('repositories');
	}

	private _searchAndCompareView: SearchAndCompareView | undefined;
	get searchAndCompare(): SearchAndCompareView {
		return this._searchAndCompareView ?? this._groupedView.setView('searchAndCompare');
	}

	private _stashesView: StashesView | undefined;
	get stashes(): StashesView {
		return this._stashesView ?? this._groupedView.setView('stashes');
	}

	private _tagsView: TagsView | undefined;
	get tags(): TagsView {
		return this._tagsView ?? this._groupedView.setView('tags');
	}

	private _timelineView!: WebviewViewProxy<TimelineWebviewShowingArgs>;
	get timeline() {
		return this._timelineView;
	}

	private _worktreesView: WorktreesView | undefined;
	get worktrees(): WorktreesView {
		return this._worktreesView ?? this._groupedView.setView('worktrees');
	}

	private _workspacesView!: WorkspacesView;
	get workspaces(): WorkspacesView {
		return this._workspacesView;
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
