import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { WorkspacesView } from '../workspacesView';
import { MessageNode } from './common';
import { RepositoriesNode } from './repositoriesNode';
import { ViewNode } from './viewNode';
import { WorkspaceNode } from './workspaceNode';

export class WorkspacesViewNode extends ViewNode<WorkspacesView> {
	private _children: (WorkspaceNode | MessageNode | RepositoriesNode)[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const children: (WorkspaceNode | MessageNode | RepositoriesNode)[] = [];

			const { cloudWorkspaces, cloudWorkspaceInfo, localWorkspaces, localWorkspaceInfo } =
				await this.view.container.workspaces.getWorkspaces();

			if (cloudWorkspaces.length || localWorkspaces.length) {
				children.push(new RepositoriesNode(this.view));

				for (const workspace of cloudWorkspaces) {
					children.push(new WorkspaceNode(this.uri, this.view, this, workspace));
				}

				if (cloudWorkspaceInfo != null) {
					children.push(new MessageNode(this.view, this, cloudWorkspaceInfo));
				}

				for (const workspace of localWorkspaces) {
					children.push(new WorkspaceNode(this.uri, this.view, this, workspace));
				}

				if (cloudWorkspaces.length === 0 && cloudWorkspaceInfo == null) {
					children.push(new MessageNode(this.view, this, 'No cloud workspaces found.'));
				}

				if (localWorkspaceInfo != null) {
					children.push(new MessageNode(this.view, this, localWorkspaceInfo));
				}
			}

			this._children = children;
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Workspaces', TreeItemCollapsibleState.Expanded);
		return item;
	}

	@gate()
	@debug()
	override refresh() {
		this._children = undefined;
	}
}
