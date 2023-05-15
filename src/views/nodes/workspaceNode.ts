import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type {
	CloudWorkspaceRepositoryDescriptor,
	LocalWorkspaceRepositoryDescriptor,
	WorkspaceRepositoriesByName,
} from '../../plus/workspaces/models';
import { GKCloudWorkspace, GKLocalWorkspace, WorkspaceType } from '../../plus/workspaces/models';
import type { WorkspacesView } from '../workspacesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';
import { WorkspaceMissingRepositoryNode } from './workspaceMissingRepositoryNode';

export class WorkspaceNode extends ViewNode<WorkspacesView> {
	static key = ':workspace';
	static getId(workspaceId: string): string {
		return `gitlens${this.key}(${workspaceId})`;
	}

	private _workspace: GKCloudWorkspace | GKLocalWorkspace;
	private _type: WorkspaceType;

	constructor(
		uri: GitUri,
		view: WorkspacesView,
		parent: ViewNode,
		public readonly workspace: GKCloudWorkspace | GKLocalWorkspace,
	) {
		super(uri, view, parent);
		this._workspace = workspace;
		this._type = workspace.type;
	}

	override get id(): string {
		return WorkspaceNode.getId(this._workspace.id ?? '');
	}

	get name(): string {
		return this._workspace?.name ?? '';
	}

	get workspaceId(): string {
		return this._workspace.id ?? '';
	}

	get type(): WorkspaceType {
		return this._type;
	}

	private async getRepositories(): Promise<
		CloudWorkspaceRepositoryDescriptor[] | LocalWorkspaceRepositoryDescriptor[] | undefined
	> {
		return Promise.resolve(this._workspace?.repositories);
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			this._children = [];
			let repositories: CloudWorkspaceRepositoryDescriptor[] | LocalWorkspaceRepositoryDescriptor[] | undefined;
			let repositoryInfo: string | undefined;
			if (this.workspace instanceof GKLocalWorkspace) {
				repositories = (await this.getRepositories()) ?? [];
			} else {
				const { repositories: repos, repositoriesInfo: repoInfo } =
					await this.workspace.getOrLoadRepositories();
				repositories = repos;
				repositoryInfo = repoInfo;
			}

			if (repositories?.length === 0) {
				this._children.push(new MessageNode(this.view, this, 'No repositories in this workspace.'));
				return this._children;
			} else if (repositories?.length) {
				const reposByName: WorkspaceRepositoriesByName =
					await this.view.container.workspaces.resolveWorkspaceRepositoriesByName(
						this.workspaceId,
						this.type,
					);

				for (const repository of repositories) {
					const repo = reposByName.get(repository.name);
					if (!repo) {
						this._children.push(
							new WorkspaceMissingRepositoryNode(this.view, this, this.workspaceId, repository.name),
						);
						continue;
					}

					this._children.push(
						new RepositoryNode(GitUri.fromRepoPath(repo.path), this.view, this, repo, {
							workspace: this._workspace,
						}),
					);
				}
			}

			if (repositoryInfo != null) {
				this._children.push(new MessageNode(this.view, this, repositoryInfo));
			}
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const description = '';
		// TODO@ramint Icon needs to change based on workspace type, and need a tooltip.
		const icon: ThemeIcon = new ThemeIcon(this._type == WorkspaceType.Cloud ? 'cloud' : 'folder');

		const item = new TreeItem(this.name, TreeItemCollapsibleState.Collapsed);
		let contextValue = `${ContextValues.Workspace}`;

		if (this._type === WorkspaceType.Cloud) {
			contextValue += '+cloud';
		} else {
			contextValue += '+local';
		}
		item.id = this.id;
		item.description = description;
		item.contextValue = contextValue;
		item.iconPath = icon;
		item.tooltip = `${this.name}\n${
			this._type === WorkspaceType.Cloud
				? `Cloud Workspace ${this._workspace.isShared() ? '(Shared)' : ''}`
				: 'Local Workspace'
		}${
			this._workspace instanceof GKCloudWorkspace && this._workspace.provider != null
				? `\nProvider: ${this._workspace.provider}`
				: ''
		}`;
		item.resourceUri = undefined;
		return item;
	}

	override refresh() {
		this._children = undefined;
	}
}
