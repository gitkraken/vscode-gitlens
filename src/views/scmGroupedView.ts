import type { Disposable } from 'vscode';
import type { GroupableTreeViewTypes } from '../constants.views';
import type { Container } from '../container';
import { first } from '../system/iterable';
import { BranchesView } from './branchesView';
import { CommitsView } from './commitsView';
import { ContributorsView } from './contributorsView';
import { LaunchpadView } from './launchpadView';
import { RemotesView } from './remotesView';
import { RepositoriesView } from './repositoriesView';
import { SearchAndCompareView } from './searchAndCompareView';
import { StashesView } from './stashesView';
import { TagsView } from './tagsView';
import type { TreeViewByType } from './viewBase';
import type { Views } from './views';
import { WorktreesView } from './worktreesView';

export class ScmGroupedView implements Disposable {
	private _view: TreeViewByType[GroupableTreeViewTypes] | undefined;

	constructor(
		private readonly container: Container,
		private views: Views,
	) {
		this._view = this.setView(this.views.lastSelectedScmGroupedView!);
	}

	dispose() {
		this._view?.dispose();
	}

	get view() {
		return this._view;
	}

	setView<T extends GroupableTreeViewTypes>(type: T, focus?: boolean): TreeViewByType[T] {
		if (!this.views.scmGroupedViews?.has(type)) {
			type = this.views.scmGroupedViews?.size ? (first(this.views.scmGroupedViews) as T) : undefined!;
		}

		if (this._view?.type === type) {
			this.views.lastSelectedScmGroupedView = type;
			return this._view as TreeViewByType[T];
		}

		this._view?.dispose();
		this._view = this.getView(type);
		if (focus) {
			void this._view.show({ preserveFocus: false });
		}
		this.views.lastSelectedScmGroupedView = type;

		return this._view as TreeViewByType[T];
	}

	private getView(type: GroupableTreeViewTypes) {
		switch (type) {
			case 'branches':
				return new BranchesView(this.container, true);
			case 'commits':
				return new CommitsView(this.container, true);
			case 'contributors':
				return new ContributorsView(this.container, true);
			case 'launchpad':
				return new LaunchpadView(this.container, true);
			case 'remotes':
				return new RemotesView(this.container, true);
			case 'repositories':
				return new RepositoriesView(this.container, true);
			case 'searchAndCompare':
				return new SearchAndCompareView(this.container, true);
			case 'stashes':
				return new StashesView(this.container, true);
			case 'tags':
				return new TagsView(this.container, true);
			case 'worktrees':
				return new WorktreesView(this.container, true);
		}
	}
}
