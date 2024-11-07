import { Disposable } from 'vscode';
import type { Commands } from '../constants.commands';
import type { GroupableTreeViewTypes } from '../constants.views';
import type { Container } from '../container';
import { first } from '../system/iterable';
import { executeCommand, registerCommand } from '../system/vscode/command';
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
	private _disposable: Disposable;
	private _view: TreeViewByType[GroupableTreeViewTypes] | undefined;

	constructor(
		private readonly container: Container,
		private views: Views,
	) {
		this._disposable = Disposable.from(
			registerCommand('gitlens.views.scm.grouped.refresh', () => {
				if (this._view == null) return;

				executeCommand(`gitlens.views.${this._view.type}.refresh` as Commands);
			}),
			registerCommand('gitlens.views.scm.grouped.branches', () => this.setView('branches', true)),
			registerCommand('gitlens.views.scm.grouped.commits', () => this.setView('commits', true)),
			registerCommand('gitlens.views.scm.grouped.contributors', () => this.setView('contributors', true)),
			registerCommand('gitlens.views.scm.grouped.launchpad', () => this.setView('launchpad', true)),
			registerCommand('gitlens.views.scm.grouped.remotes', () => this.setView('remotes', true)),
			registerCommand('gitlens.views.scm.grouped.repositories', () => this.setView('repositories', true)),
			registerCommand('gitlens.views.scm.grouped.searchAndCompare', () => this.setView('searchAndCompare', true)),
			registerCommand('gitlens.views.scm.grouped.stashes', () => this.setView('stashes', true)),
			registerCommand('gitlens.views.scm.grouped.tags', () => this.setView('tags', true)),
			registerCommand('gitlens.views.scm.grouped.worktrees', () => this.setView('worktrees', true)),
		);

		this._view = this.setView(this.views.lastSelectedScmGroupedView!);
	}

	dispose() {
		this._disposable.dispose();
		this._view?.dispose();
	}

	setView<T extends GroupableTreeViewTypes>(type: T, focus?: boolean): TreeViewByType[T] {
		if (!this.views.scmGroupedViews.has(type)) {
			type = first(this.views.scmGroupedViews) as T;
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
