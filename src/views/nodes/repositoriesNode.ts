import type { TextEditor } from 'vscode';
import { Disposable, TreeItem, TreeItemCollapsibleState, window, workspace } from 'vscode';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import { debounce, szudzikPairing } from '../../system/function';
import { Logger } from '../../system/logger';
import type { ViewsWithRepositoriesNode } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends SubscribeableViewNode<
	'repositories',
	ViewsWithRepositoriesNode,
	RepositoryNode | MessageNode
> {
	constructor(view: ViewsWithRepositoriesNode) {
		super('repositories', unknownGitUri, view);
	}

	getChildren(): ViewNode[] {
		if (this.children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) return [new MessageNode(this.view, this, 'No repositories could be found.')];

			this.children = repositories.map(r => new RepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r));
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const isInWorkspacesView = this.view.type === 'workspaces';
		const isLinkedWorkspace = isInWorkspacesView && this.view.container.workspaces.currentWorkspaceId != null;
		const isCurrentLinkedWorkspace = isLinkedWorkspace && this.view.container.workspaces.currentWorkspace != null;
		const item = new TreeItem(
			isInWorkspacesView ? 'Current Window' : 'Repositories',
			isInWorkspacesView ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.Expanded,
		);

		if (isInWorkspacesView) {
			item.description = workspace.name ?? workspace.workspaceFolders?.[0]?.name ?? '';
		}

		let contextValue: string = ContextValues.Repositories;
		if (isInWorkspacesView) {
			contextValue += '+workspaces';
		}

		if (isLinkedWorkspace) {
			contextValue += '+linked';
		}

		if (isCurrentLinkedWorkspace) {
			contextValue += '+current';
			item.resourceUri = createViewDecorationUri('repositories', { currentWorkspace: true });
		}

		item.contextValue = contextValue;
		return item;
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false) {
		const hasChildren = this.children != null;
		super.refresh(reset);
		if (!hasChildren) return;

		if (reset) {
			await this.unsubscribe();
			void this.ensureSubscription();

			return;
		}

		const repositories = this.view.container.git.openRepositories;
		if (repositories.length === 0 && (this.children == null || this.children.length === 0)) return;

		if (repositories.length === 0) {
			this.children = [new MessageNode(this.view, this, 'No repositories could be found.')];
			return;
		}

		const children = [];
		for (const repo of repositories) {
			const id = repo.id;
			const child = (this.children as RepositoryNode[]).find(c => c.repo.id === id);
			if (child != null) {
				children.push(child);
				void child.refresh();
			} else {
				children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), this.view, this, repo));
			}
		}

		this.children = children;

		void this.ensureSubscription();
	}

	@debug()
	protected subscribe() {
		const subscriptions = [
			weakEvent(this.view.container.git.onDidChangeRepositories, this.onRepositoriesChanged, this),
		];

		if (this.view.id === 'gitlens.views.repositories' && this.view.config.autoReveal) {
			subscriptions.push(
				weakEvent(window.onDidChangeActiveTextEditor, debounce(this.onActiveEditorChanged, 500), this),
			);
		}

		return Disposable.from(...subscriptions);
	}

	protected override etag(): number {
		return szudzikPairing(this.view.container.git.etag, this.view.container.subscription.etag);
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (editor == null || this.children == null || this.children.length === 1) {
			return;
		}

		try {
			const uri = editor.document.uri;
			const node = this.children.find(n => n instanceof RepositoryNode && n.repo.containsUri(uri)) as
				| RepositoryNode
				| undefined;
			if (node == null) return;

			// Check to see if this repo has a descendant that is already selected
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
		void this.triggerChange(true);
	}
}
