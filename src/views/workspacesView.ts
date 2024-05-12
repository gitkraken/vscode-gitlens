import type { CancellationToken, Disposable } from 'vscode';
import { ProgressLocation, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { WorkspacesViewConfig } from '../config';
import { Commands, previewBadge, urls } from '../constants';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import type { Repository } from '../git/models/repository';
import { ensurePlusFeaturesEnabled } from '../plus/gk/utils';
import { executeCommand } from '../system/command';
import { gate } from '../system/decorators/gate';
import { debug } from '../system/decorators/log';
import { openUrl, openWorkspace } from '../system/utils';
import { ViewNode } from './nodes/abstract/viewNode';
import { MessageNode } from './nodes/common';
import { RepositoriesNode } from './nodes/repositoriesNode';
import { RepositoryNode } from './nodes/repositoryNode';
import type { WorkspaceMissingRepositoryNode } from './nodes/workspaceMissingRepositoryNode';
import { WorkspaceNode } from './nodes/workspaceNode';
import { disposeChildren, ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class WorkspacesViewNode extends ViewNode<'workspaces-view', WorkspacesView> {
	constructor(view: WorkspacesView) {
		super('workspaces-view', unknownGitUri, view);
	}

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
		if (this._children == null) return;

		disposeChildren(this._children);
		this._children = undefined;
	}
}

export class WorkspacesView extends ViewBase<'workspaces', WorkspacesViewNode, WorkspacesViewConfig> {
	protected readonly configKey = 'workspaces';
	private _disposable: Disposable | undefined;

	constructor(container: Container) {
		super(container, 'workspaces', 'Workspaces', 'workspacesView');

		this.description = previewBadge;
		this.disposables.push(container.workspaces.onDidResetWorkspaces(() => void this.refresh(true)));
	}

	override dispose() {
		this._disposable?.dispose();
		super.dispose();
	}

	protected getRoot() {
		return new WorkspacesViewNode(this);
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(options);
	}

	async findWorkspaceNode(workspaceId: string, token?: CancellationToken) {
		return this.findNode((n: any) => n.workspace?.id === workspaceId, {
			allowPaging: false,
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof WorkspacesViewNode) return true;

				return false;
			},
			token: token,
		});
	}

	async revealWorkspaceNode(
		workspaceId: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing workspace ${workspaceId} in the side bar...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findWorkspaceNode(workspaceId, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(this.getQualifiedCommand('info'), () => openUrl(urls.workspaces), this),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('refresh'),
				() => {
					this.container.workspaces.resetWorkspaces();
				},
				this,
			),
			registerViewCommand(this.getQualifiedCommand('addRepos'), async (node: WorkspaceNode) => {
				await this.container.workspaces.addCloudWorkspaceRepos(node.workspace.id);
				void node.getParent()?.triggerChange(true);
			}),
			registerViewCommand(this.getQualifiedCommand('addReposFromLinked'), async (node: RepositoriesNode) => {
				await this.container.workspaces.addMissingCurrentWorkspaceRepos({ force: true });
				void node.getParent()?.triggerChange(true);
			}),
			registerViewCommand(
				this.getQualifiedCommand('convert'),
				async (node: RepositoriesNode) => {
					const repos: Repository[] = [];
					for (const child of node.getChildren()) {
						if (child instanceof RepositoryNode) {
							repos.push(child.repo);
						}
					}

					if (repos.length === 0) return;
					await this.container.workspaces.createCloudWorkspace({ repos: repos });
					void this.ensureRoot().triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('create'),
				async () => {
					await this.container.workspaces.createCloudWorkspace();
					void this.ensureRoot().triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('createLocal'),
				async (node: WorkspaceNode) => {
					await this.container.workspaces.saveAsCodeWorkspaceFile(node.workspace.id);
					void this.ensureRoot().triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('openLocal'),
				async (node: WorkspaceNode) => {
					await this.container.workspaces.openCodeWorkspaceFile(node.workspace.id, {
						location: 'currentWindow',
					});
					void this.ensureRoot().triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('openLocalNewWindow'),
				async (node: WorkspaceNode) => {
					await this.container.workspaces.openCodeWorkspaceFile(node.workspace.id, {
						location: 'newWindow',
					});
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('changeAutoAddSetting'),
				async () => {
					await this.container.workspaces.chooseCodeWorkspaceAutoAddSetting({ current: true });
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('delete'),
				async (node: WorkspaceNode) => {
					await this.container.workspaces.deleteCloudWorkspace(node.workspace.id);
					void node.getParent()?.triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('locateAllRepos'),
				async (node: WorkspaceNode) => {
					if (node.workspace.type !== 'cloud') return;

					await window.withProgress(
						{
							location: ProgressLocation.Notification,
							title: `Locating Repositories for '${node.workspace.name}'...`,
							cancellable: true,
						},
						(_progress, token) =>
							this.container.workspaces.locateAllCloudWorkspaceRepos(node.workspace.id, token),
					);

					void node.triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('repo.locate'),
				async (node: RepositoryNode | WorkspaceMissingRepositoryNode) => {
					const descriptor = node.wsRepositoryDescriptor;
					if (descriptor == null || node.workspace?.id == null) return;

					await this.container.workspaces.locateWorkspaceRepo(node.workspace.id, descriptor);

					void node.getParent()?.triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('repo.openInNewWindow'),
				(node: RepositoryNode) => {
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					openWorkspace(node.repo.uri, { location: 'newWindow' });
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('repo.open'),
				(node: RepositoryNode) => {
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					openWorkspace(node.repo.uri, { location: 'currentWindow' });
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('repo.addToWindow'),
				(node: RepositoryNode) => {
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					openWorkspace(node.repo.uri, { location: 'addToWorkspace' });
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('repo.remove'),
				async (node: RepositoryNode | WorkspaceMissingRepositoryNode) => {
					const descriptor = node.wsRepositoryDescriptor;
					if (descriptor?.id == null || node.workspace?.id == null) return;

					await this.container.workspaces.removeCloudWorkspaceRepo(node.workspace.id, descriptor);
					// TODO@axosoft-ramint Do we need the grandparent here?
					void node.getParent()?.getParent()?.triggerChange(true);
				},
			),
		];
	}
}
