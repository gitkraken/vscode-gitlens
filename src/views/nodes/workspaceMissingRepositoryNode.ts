import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { unknownGitUri } from '../../git/gitUri';
import type { WorkspacesView } from '../workspacesView';
import { ContextValues, ViewNode } from './viewNode';

export class WorkspaceMissingRepositoryNode extends ViewNode<WorkspacesView> {
	static key = ':workspaceMissingRepository';
	static getId(workspaceId: string, repoName: string): string {
		return `gitlens${this.key}(${workspaceId}/${repoName})`;
	}

	private _workspaceId: string;
	private _repoName: string;

	constructor(view: WorkspacesView, parent: ViewNode, workspaceId: string, repoName: string) {
		super(unknownGitUri, view, parent);
		this._workspaceId = workspaceId;
		this._repoName = repoName;
	}

	override toClipboard(): string {
		return this.name;
	}

	override get id(): string {
		return WorkspaceMissingRepositoryNode.getId(this._workspaceId, this._repoName);
	}

	get name(): string {
		return this._repoName;
	}

	get workspaceId(): string {
		return this._workspaceId;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const description = 'missing';

		// TODO@ramint Use a better icon for this
		const icon: ThemeIcon = new ThemeIcon('folder');

		const item = new TreeItem(this.name, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.description = description;
		item.tooltip = `${this.name} (missing)`;
		item.contextValue = ContextValues.WorkspaceMissingRepository;
		item.iconPath = icon;
		return item;
	}
}
