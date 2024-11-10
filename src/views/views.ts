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
import { LaunchpadView } from './launchpadView';
import { LineHistoryView } from './lineHistoryView';
import { PullRequestView } from './pullRequestView';
import { RemotesView } from './remotesView';
import { RepositoriesView } from './repositoriesView';
import { ScmGroupedView } from './scmGroupedView';
import { SearchAndCompareView } from './searchAndCompareView';
import { StashesView } from './stashesView';
import { TagsView } from './tagsView';
import type { ViewsWithRepositoryFolders } from './viewBase';
import { ViewCommands } from './viewCommands';
import { WorkspacesView } from './workspacesView';
import { WorktreesView } from './worktreesView';

export class Views implements Disposable {
	private readonly _disposable: Disposable;
	private _scmGroupedView!: ScmGroupedView;
	private _scmGroupedViewsDisposable: Disposable;

	private _lastSelectedScmGroupedView: GroupableTreeViewTypes | undefined;
	get lastSelectedScmGroupedView() {
		const included = configuration.get('views.scm.grouped.views', undefined, []);
		if (!included.length) return undefined;

		if (!this._lastSelectedScmGroupedView || !included.includes(this._lastSelectedScmGroupedView)) {
			return included[0];
		}

		return this._lastSelectedScmGroupedView;
	}
	set lastSelectedScmGroupedView(type: GroupableTreeViewTypes | undefined) {
		this._lastSelectedScmGroupedView = type;
		void this.container.storage.storeWorkspace('views:scm:grouped:selected', type);
	}

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

		this._lastSelectedScmGroupedView = this.container.storage.getWorkspace('views:scm:grouped:selected');
		this._scmGroupedViewsDisposable = Disposable.from(...this.registerScmGroupedViews());
	}

	dispose() {
		this._disposable.dispose();
		this._scmGroupedViewsDisposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'views.scm.grouped')) {
			this._scmGroupedViewsDisposable.dispose();
			this._scmGroupedViewsDisposable = Disposable.from(...this.registerScmGroupedViews());
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

	private registerScmGroupedViews(): Disposable[] {
		const groupingEnabled = configuration.get('views.scm.grouped.enabled');

		const included = configuration.get('views.scm.grouped.views', undefined, []);

		void setContext(
			'gitlens:views:scm:grouped:views',
			groupingEnabled ? (included.length ? included.join(',') : ' ') : undefined,
		);
		void setContext('gitlens:views:scm:grouped:default', groupingEnabled ? included[0] : undefined);

		const views: Disposable[] = [];
		if (groupingEnabled && included.length) {
			views.push((this._scmGroupedView = new ScmGroupedView(this.container, this, included)));
		} else {
			this._scmGroupedView = undefined!;
		}

		if (!groupingEnabled || !included.includes('branches')) {
			views.push((this._branchesView = new BranchesView(this.container)));
		} else {
			this._branchesView = undefined;
		}

		if (!groupingEnabled || !included.includes('commits')) {
			views.push((this._commitsView = new CommitsView(this.container)));
		} else {
			this._commitsView = undefined;
		}

		if (!groupingEnabled || !included.includes('contributors')) {
			views.push((this._contributorsView = new ContributorsView(this.container)));
		} else {
			this._contributorsView = undefined;
		}

		if (!groupingEnabled || !included.includes('remotes')) {
			views.push((this._remotesView = new RemotesView(this.container)));
		} else {
			this._remotesView = undefined;
		}

		if (!groupingEnabled || !included.includes('repositories')) {
			views.push((this._repositoriesView = new RepositoriesView(this.container)));
		} else {
			this._repositoriesView = undefined;
		}

		if (!groupingEnabled || !included.includes('searchAndCompare')) {
			views.push((this._searchAndCompareView = new SearchAndCompareView(this.container)));
		} else {
			this._searchAndCompareView = undefined;
		}

		if (!groupingEnabled || !included.includes('stashes')) {
			views.push((this._stashesView = new StashesView(this.container)));
		} else {
			this._stashesView = undefined;
		}

		if (!groupingEnabled || !included.includes('tags')) {
			views.push((this._tagsView = new TagsView(this.container)));
		} else {
			this._tagsView = undefined;
		}

		if (!groupingEnabled || !included.includes('worktrees')) {
			views.push((this._worktreesView = new WorktreesView(this.container)));
		} else {
			this._worktreesView = undefined;
		}

		return views;
	}

	private async setAsScmGroupedDefaultView(type: GroupableTreeViewTypes) {
		let included = configuration.get('views.scm.grouped.views', undefined, []);
		if (!included.includes(type)) return;

		// Move the type to be the first in the list (default)
		included = [type, ...included.filter(t => t !== type)];

		this.lastSelectedScmGroupedView = type;
		await configuration.updateEffective('views.scm.grouped.views', included);
	}

	private async toggleScmViewGrouping(type: GroupableTreeViewTypes, grouped: boolean) {
		let included = configuration.get('views.scm.grouped.views', undefined, []);

		let changed = false;
		if (grouped) {
			if (!included.includes(type)) {
				changed = true;
				this.lastSelectedScmGroupedView = type;
				included = included.concat(type);
			}
		} else if (included.includes(type)) {
			changed = true;
			if (type === this.lastSelectedScmGroupedView) {
				this.lastSelectedScmGroupedView = undefined;
			}
			included = included.filter(t => t !== type);
		}

		if (!changed) return;

		await configuration.updateEffective('views.scm.grouped.views', included);

		// Show the view after the configuration change has been applied
		setTimeout(() => executeCoreCommand(`gitlens.views.${type}.focus`), 1);
	}

	private _branchesView: BranchesView | undefined;
	get branches(): BranchesView {
		return this._branchesView ?? this._scmGroupedView.setView('branches');
	}

	private _commitsView: CommitsView | undefined;
	get commits(): CommitsView {
		return this._commitsView ?? this._scmGroupedView.setView('commits');
	}

	private _commitDetailsView!: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	get commitDetails() {
		return this._commitDetailsView;
	}

	private _contributorsView: ContributorsView | undefined;
	get contributors(): ContributorsView {
		return this._contributorsView ?? this._scmGroupedView.setView('contributors');
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
		return this._remotesView ?? this._scmGroupedView.setView('remotes');
	}

	private _repositoriesView!: RepositoriesView | undefined;
	get repositories(): RepositoriesView {
		return this._repositoriesView ?? this._scmGroupedView.setView('repositories');
	}

	private _searchAndCompareView: SearchAndCompareView | undefined;
	get searchAndCompare(): SearchAndCompareView {
		return this._searchAndCompareView ?? this._scmGroupedView.setView('searchAndCompare');
	}

	private _stashesView: StashesView | undefined;
	get stashes(): StashesView {
		return this._stashesView ?? this._scmGroupedView.setView('stashes');
	}

	private _tagsView: TagsView | undefined;
	get tags(): TagsView {
		return this._tagsView ?? this._scmGroupedView.setView('tags');
	}

	private _timelineView!: WebviewViewProxy<TimelineWebviewShowingArgs>;
	get timeline() {
		return this._timelineView;
	}

	private _worktreesView: WorktreesView | undefined;
	get worktrees(): WorktreesView {
		return this._worktreesView ?? this._scmGroupedView.setView('worktrees');
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
