import { Disposable, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService';
import { GitUri } from '../../git/gitUri';
import type { CloudWorkspace, LocalWorkspace } from '../../plus/workspaces/models';
import { createCommand } from '../../system/command';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { WorkspacesView } from '../workspacesView';
import { CommandMessageNode, MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import type { ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, SubscribeableViewNode } from './viewNode';
import { WorkspaceMissingRepositoryNode } from './workspaceMissingRepositoryNode';

export class WorkspaceNode extends SubscribeableViewNode<WorkspacesView> {
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

	override dispose() {
		super.dispose();
		this.resetChildren();
	}

	private resetChildren() {
		if (this._children == null) return;

		for (const child of this._children) {
			if ('dispose' in child) {
				child.dispose();
			}
		}
		this._children = undefined;
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.workspace.name;
	}

	private _children:
		| (CommandMessageNode | MessageNode | RepositoryNode | WorkspaceMissingRepositoryNode)[]
		| undefined;

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

				const reposByName = await this.workspace.getRepositoriesByName({ force: true });

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

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		if (this._children == null) return;

		if (reset) {
			this.resetChildren();
		}
	}

	protected override etag(): number {
		return this.view.container.git.etag;
	}

	@debug()
	protected subscribe(): Disposable | Promise<Disposable> {
		return Disposable.from(this.view.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this));
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent) {
		void this.triggerChange(true);
	}
}
