import { ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { unknownGitUri } from '../../git/gitUri';
import type {
	CloudWorkspaceRepositoryDescriptor,
	LocalWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models';
import type { WorkspacesView } from '../workspacesView';
import { ContextValues, ViewNode } from './viewNode';

export class WorkspaceMissingRepositoryNode extends ViewNode<WorkspacesView> {
	static key = ':workspaceMissingRepository';
	static getId(workspaceId: string, repoName: string): string {
		return `gitlens${this.key}(${workspaceId}/${repoName})`;
	}

	constructor(
		view: WorkspacesView,
		parent: ViewNode,
		public readonly workspaceId: string,
		public readonly workspaceRepositoryDescriptor:
			| CloudWorkspaceRepositoryDescriptor
			| LocalWorkspaceRepositoryDescriptor,
	) {
		super(unknownGitUri, view, parent);
	}

	override toClipboard(): string {
		return this.name;
	}

	override get id(): string {
		return WorkspaceMissingRepositoryNode.getId(this.workspaceId, this.workspaceRepositoryDescriptor.name);
	}

	get name(): string {
		return this.workspaceRepositoryDescriptor.name;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const description = 'repo not found \u2022 please locate';

		const icon: ThemeIcon = new ThemeIcon('question');

		const item = new TreeItem(this.name, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.description = description;
		item.tooltip = `${this.name} (missing)`;
		item.contextValue = ContextValues.WorkspaceMissingRepository;
		item.iconPath = icon;
		item.resourceUri = Uri.parse(`gitlens-view://workspaces/repository/missing`);
		return item;
	}
}
