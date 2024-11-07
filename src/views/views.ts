import { Disposable } from 'vscode';
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
import { SearchAndCompareView } from './searchAndCompareView';
import { StashesView } from './stashesView';
import { TagsView } from './tagsView';
import type { ViewsWithRepositoryFolders } from './viewBase';
import { ViewCommands } from './viewCommands';
import { WorkspacesView } from './workspacesView';
import { WorktreesView } from './worktreesView';

export class Views implements Disposable {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		webviews: WebviewsController,
	) {
		this._disposable = Disposable.from(
			new ViewCommands(container),
			...this.registerViews(),
			...this.registerWebviewViews(webviews),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private registerViews(): Disposable[] {
		return [
			(this._branchesView = new BranchesView(this.container)),
			(this._commitsView = new CommitsView(this.container)),
			(this._contributorsView = new ContributorsView(this.container)),
			(this._remotesView = new RemotesView(this.container)),
			(this._repositoriesView = new RepositoriesView(this.container)),
			(this._stashesView = new StashesView(this.container)),
			(this._tagsView = new TagsView(this.container)),
			(this._worktreesView = new WorktreesView(this.container)),

			(this._draftsView = new DraftsView(this.container)),
			(this._fileHistoryView = new FileHistoryView(this.container)),
			(this._launchpadView = new LaunchpadView(this.container)),
			(this._lineHistoryView = new LineHistoryView(this.container)),
			(this._pullRequestView = new PullRequestView(this.container)),
			(this._searchAndCompareView = new SearchAndCompareView(this.container)),
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

	private _branchesView!: BranchesView;
	get branches(): BranchesView {
		return this._branchesView;
	}

	private _commitsView!: CommitsView;
	get commits(): CommitsView {
		return this._commitsView;
	}

	private _commitDetailsView!: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	get commitDetails() {
		return this._commitDetailsView;
	}

	private _contributorsView!: ContributorsView;
	get contributors(): ContributorsView {
		return this._contributorsView;
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

	private _remotesView!: RemotesView;
	get remotes(): RemotesView {
		return this._remotesView;
	}

	private _repositoriesView!: RepositoriesView;
	get repositories(): RepositoriesView {
		return this._repositoriesView;
	}

	private _searchAndCompareView!: SearchAndCompareView;
	get searchAndCompare(): SearchAndCompareView {
		return this._searchAndCompareView;
	}

	private _stashesView!: StashesView;
	get stashes(): StashesView {
		return this._stashesView;
	}

	private _tagsView!: TagsView;
	get tags(): TagsView {
		return this._tagsView;
	}

	private _timelineView!: WebviewViewProxy<TimelineWebviewShowingArgs>;
	get timeline() {
		return this._timelineView;
	}

	private _worktreesView!: WorktreesView;
	get worktrees(): WorktreesView {
		return this._worktreesView;
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
