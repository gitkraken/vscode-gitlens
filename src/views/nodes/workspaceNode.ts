import { Disposable, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService';
import { GitUri } from '../../git/gitUri';
import type { CloudWorkspace, LocalWorkspace } from '../../plus/workspaces/models';
import { createCommand } from '../../system/command';
import { debug } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import type { WorkspacesView } from '../workspacesView';
import { CommandMessageNode, MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import type { ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, SubscribeableViewNode } from './viewNode';
import { WorkspaceMissingRepositoryNode } from './workspaceMissingRepositoryNode';

export class WorkspaceNode extends SubscribeableViewNode<
	'workspace',
	WorkspacesView,
	CommandMessageNode | MessageNode | RepositoryNode | WorkspaceMissingRepositoryNode
> {
	constructor(
		uri: GitUri,
		view: WorkspacesView,
		protected override parent: ViewNode,
		public readonly workspace: CloudWorkspace | LocalWorkspace,
	) {
		super('workspace', uri, view, parent);

		this.updateContext({ workspace: workspace });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.workspace.name;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const children = [];

			try {
				const descriptors = await this.workspace.getRepositoryDescriptors();

				if (!descriptors?.length) {
					children.push(
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

					this.children = children;
					return this.children;
				}

				const reposByName = await this.workspace.getRepositoriesByName({ force: true });

				for (const descriptor of descriptors) {
					const repo = reposByName.get(descriptor.name)?.repository;
					if (!repo) {
						children.push(new WorkspaceMissingRepositoryNode(this.view, this, this.workspace, descriptor));
						continue;
					}

					children.push(
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
				this.children = undefined;
				return [new MessageNode(this.view, this, 'Failed to load repositories')];
			}

			this.children = children;
		}

		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = new TreeItem(this.workspace.name, TreeItemCollapsibleState.Collapsed);

		const cloud = this.workspace.type === 'cloud';

		let contextValue = `${ContextValues.Workspace}`;
		item.resourceUri = undefined;
		const descriptionItems = [];
		if (cloud) {
			contextValue += '+cloud';
		} else {
			contextValue += '+local';
		}
		if (this.workspace.current) {
			contextValue += '+current';
			descriptionItems.push('current');
			item.resourceUri = Uri.parse('gitlens-view://workspaces/workspace/current');
		}
		if (this.workspace.localPath != null) {
			contextValue += '+hasPath';
		}

		if ((await this.workspace.getRepositoryDescriptors())?.length === 0) {
			contextValue += '+empty';
		}

		item.id = this.id;
		item.contextValue = contextValue;
		item.iconPath = new ThemeIcon(this.workspace.type == 'cloud' ? 'cloud' : 'folder');
		item.tooltip = `${this.workspace.name}\n${
			cloud ? `Cloud Workspace ${this.workspace.shared ? '(Shared)' : ''}` : 'Local Workspace'
		}${cloud && this.workspace.provider != null ? `\nProvider: ${this.workspace.provider}` : ''}`;

		if (cloud && this.workspace.organizationId != null) {
			descriptionItems.push('shared');
		}

		item.description = descriptionItems.join(', ');
		return item;
	}

	protected override etag(): number {
		return this.view.container.git.etag;
	}

	@debug()
	protected subscribe(): Disposable | Promise<Disposable> {
		return Disposable.from(
			weakEvent(this.view.container.git.onDidChangeRepositories, this.onRepositoriesChanged, this),
		);
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent) {
		void this.triggerChange(true);
	}
}
