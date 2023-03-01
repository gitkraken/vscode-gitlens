import type { TextEditor } from 'vscode';
import { Disposable, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { debounce, szudzikPairing } from '../../system/function';
import { Logger } from '../../system/logger';
import type { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import type { ViewNode } from './viewNode';
import { ContextValues, SubscribeableViewNode } from './viewNode';

export class RepositoriesNode extends SubscribeableViewNode<RepositoriesView> {
	private _children: (RepositoryNode | MessageNode)[] | undefined;

	constructor(view: RepositoriesView) {
		super(unknownGitUri, view);
	}

	override dispose() {
		super.dispose();

		this.resetChildren();
	}

	@debug()
	private resetChildren() {
		if (this._children == null) return;

		for (const child of this._children) {
			if (child instanceof RepositoryNode) {
				child.dispose();
			}
		}
		this._children = undefined;
	}

	getChildren(): ViewNode[] {
		if (this._children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) return [new MessageNode(this.view, this, 'No repositories could be found.')];

			this._children = repositories.map(r => new RepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r));
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Repositories', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.Repositories;

		return item;
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false) {
		if (this._children == null) return;

		if (reset) {
			this.resetChildren();
			await this.unsubscribe();
			void this.ensureSubscription();

			return;
		}

		const repositories = this.view.container.git.openRepositories;
		if (repositories.length === 0 && (this._children == null || this._children.length === 0)) return;

		if (repositories.length === 0) {
			this._children = [new MessageNode(this.view, this, 'No repositories could be found.')];
			return;
		}

		const children = [];
		for (const repo of repositories) {
			const id = repo.id;
			const child = (this._children as RepositoryNode[]).find(c => c.repo.id === id);
			if (child != null) {
				children.push(child);
				void child.refresh();
			} else {
				children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), this.view, this, repo));
			}
		}

		for (const child of this._children as RepositoryNode[]) {
			if (children.includes(child)) continue;

			child.dispose();
		}

		this._children = children;

		void this.ensureSubscription();
	}

	@debug()
	protected subscribe() {
		const subscriptions = [this.view.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this)];

		if (this.view.config.autoReveal) {
			subscriptions.push(window.onDidChangeActiveTextEditor(debounce(this.onActiveEditorChanged, 500), this));
		}

		return Disposable.from(...subscriptions);
	}

	protected override etag(): number {
		return szudzikPairing(this.view.container.git.etag, this.view.container.subscription.etag);
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (editor == null || this._children == null || this._children.length === 1) {
			return;
		}

		try {
			const uri = editor.document.uri;
			const node = this._children.find(n => n instanceof RepositoryNode && n.repo.containsUri(uri)) as
				| RepositoryNode
				| undefined;
			if (node == null) return;

			// Check to see if this repo has a descendent that is already selected
			let parent = this.view.selection.length === 0 ? undefined : this.view.selection[0];
			while (parent != null) {
				if (parent === node) return;

				parent = parent.getParent();
			}

			void this.view.reveal(node, { expand: true });
		} catch (ex) {
			Logger.error(ex);
		}
	}

	@debug()
	private onRepositoriesChanged(_e: RepositoriesChangeEvent) {
		void this.triggerChange();
	}
}
