import type { Disposable } from 'vscode';
import { env, ProgressLocation, Uri, window } from 'vscode';
import type { RepositoriesViewConfig } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import type { Repository } from '../git/models/repository';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { executeCommand } from '../system/command';
import { openWorkspace } from '../system/utils';
import type { RepositoriesNode } from './nodes/repositoriesNode';
import { RepositoryNode } from './nodes/repositoryNode';
import type { WorkspaceMissingRepositoryNode } from './nodes/workspaceMissingRepositoryNode';
import { WorkspaceNode } from './nodes/workspaceNode';
import { WorkspacesViewNode } from './nodes/workspacesViewNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class WorkspacesView extends ViewBase<'workspaces', WorkspacesViewNode, RepositoriesViewConfig> {
	protected readonly configKey = 'repositories';
	private _disposable: Disposable | undefined;

	constructor(container: Container) {
		super(container, 'workspaces', 'Workspaces', 'workspaceView');

		this.description = `PREVIEW\u00a0\u00a0☁️`;
		this.disposables.push(container.workspaces.onDidResetWorkspaces(() => void this.refresh(true)));
	}

	override dispose() {
		this._disposable?.dispose();
		super.dispose();
	}

	override get canSelectMany(): boolean {
		return false;
	}

	protected getRoot() {
		return new WorkspacesViewNode(unknownGitUri, this);
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		return super.show(options);
	}

	override get canReveal(): boolean {
		return false;
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(
				this.getQualifiedCommand('info'),
				() =>
					env.openExternal(Uri.parse('https://help.gitkraken.com/gitlens/side-bar/#workspaces-☁%ef%b8%8f')),
				this,
			),
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
