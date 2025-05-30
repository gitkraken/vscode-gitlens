import { ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { unknownGitUri } from '../../git/gitUri';
import type {
	CloudWorkspace,
	CloudWorkspaceRepositoryDescriptor,
	LocalWorkspace,
	LocalWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models';
import type { WorkspacesView } from '../workspacesView';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export class WorkspaceMissingRepositoryNode extends ViewNode<WorkspacesView> {
	constructor(
		view: WorkspacesView,
		parent: ViewNode,
		public readonly workspace: CloudWorkspace | LocalWorkspace,
		public readonly wsRepositoryDescriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor,
	) {
		super(unknownGitUri, view, parent);

		this.updateContext({ wsRepositoryDescriptor: wsRepositoryDescriptor });
		this._uniqueId = getViewNodeId('missing-workspace-repository', this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.name;
	}

	get name(): string {
		return this.wsRepositoryDescriptor.name;
	}

	get workspaceId(): string {
		return this.wsRepositoryDescriptor.workspaceId;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.name, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.description = 'Unable to find repo, please locate';
		item.tooltip = `${this.name} (missing)`;
		item.contextValue = ContextValues.WorkspaceMissingRepository;
		item.iconPath = new ThemeIcon('question');
		item.resourceUri = Uri.parse(`gitlens-view://workspaces/repository/missing`);
		return item;
	}
}
