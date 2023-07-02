import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { CloudWorkspace, LocalWorkspace, WorkspaceRepositoriesByName } from '../../plus/workspaces/models';
import { WorkspaceType } from '../../plus/workspaces/models';
import { createCommand } from '../../system/command';
import type { WorkspacesView } from '../workspacesView';
import { CommandMessageNode, MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';
import { WorkspaceMissingRepositoryNode } from './workspaceMissingRepositoryNode';

export class WorkspaceNode extends ViewNode<WorkspacesView> {
	constructor(
		uri: GitUri,
		view: WorkspacesView,
		protected override parent: ViewNode,
		public readonly workspace: CloudWorkspace | LocalWorkspace,
	) {
		super(uri, view, parent);

		this.updateContext({ workspace: workspace });
		this._uniqueId = getViewNodeId('workspace', this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.workspace.name;
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			this._children = [];

			try {
				const descriptors = await this.workspace.getRepositoryDescriptors();

				if (descriptors == null || descriptors.length === 0) {
					this._children.push(
						new CommandMessageNode(
							this.view,
							this,
							createCommand<[WorkspaceNode]>(
								'gitlens.views.workspaces.addRepos',
								'Add Repositories...',
								this,
							),
							'No repositories',
						),
					);
					return this._children;
				}

				// TODO@eamodio this should not be done here -- it should be done in the workspaces model (when loading the repos)
				const reposByName: WorkspaceRepositoriesByName =
					await this.view.container.workspaces.resolveWorkspaceRepositoriesByName(this.workspace.id, {
						resolveFromPath: true,
						usePathMapping: true,
					});

				for (const descriptor of descriptors) {
					const repo = reposByName.get(descriptor.name)?.repository;
					if (!repo) {
						this._children.push(
							new WorkspaceMissingRepositoryNode(this.view, this, this.workspace, descriptor),
						);
						continue;
					}

					this._children.push(
						new RepositoryNode(
							GitUri.fromRepoPath(repo.path),
							this.view,
							this,
							repo,
							this.getNewContext({ wsRepositoryDescriptor: descriptor }),
						),
					);
				}
			} catch (ex) {
				return [new MessageNode(this.view, this, 'Failed to load repositories')];
			}
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.workspace.name, TreeItemCollapsibleState.Collapsed);

		let contextValue = `${ContextValues.Workspace}`;
		if (this.workspace.type === WorkspaceType.Cloud) {
			contextValue += '+cloud';
		} else {
			contextValue += '+local';
		}
		item.id = this.id;
		item.contextValue = contextValue;
		item.iconPath = new ThemeIcon(this.workspace.type == WorkspaceType.Cloud ? 'cloud' : 'folder');
		item.tooltip = `${this.workspace.name}\n${
			this.workspace.type === WorkspaceType.Cloud
				? `Cloud Workspace ${this.workspace.shared ? '(Shared)' : ''}`
				: 'Local Workspace'
		}${
			this.workspace.type === WorkspaceType.Cloud && this.workspace.provider != null
				? `\nProvider: ${this.workspace.provider}`
				: ''
		}`;
		item.resourceUri = undefined;
		return item;
	}

	override refresh() {
		this._children = undefined;
	}
}
