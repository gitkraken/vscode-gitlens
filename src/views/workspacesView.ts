import type { Disposable } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import type { WorkspacesViewConfig } from '../config';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import type { Repository } from '../git/models/repository';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { WorkspaceType } from '../plus/workspaces/models';
import { SubscriptionState } from '../subscription';
import { openWorkspace, OpenWorkspaceLocation } from '../system/utils';
import type { RepositoriesNode } from './nodes/repositoriesNode';
import { RepositoryNode } from './nodes/repositoryNode';
import type { WorkspaceMissingRepositoryNode } from './nodes/workspaceMissingRepositoryNode';
import { WorkspaceNode } from './nodes/workspaceNode';
import { WorkspacesViewNode } from './nodes/workspacesViewNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class WorkspacesView extends ViewBase<WorkspacesViewNode, WorkspacesViewConfig> {
	protected readonly configKey = 'repositories';
	private _subscriptionDisposable: Disposable | undefined;

	constructor(container: Container) {
		super(container, 'gitlens.views.workspaces', 'Workspaces', 'workspaceView');
		// TODO@ramint May want the view node to be in charge of resetting the workspaces
		this._subscriptionDisposable = this.container.subscription.onDidChange(e => {
			if (
				e.current.account == null ||
				e.current.account.id !== e.previous?.account?.id ||
				e.current.state !== e.previous?.state
			) {
				this.container.workspaces.resetWorkspaces({ cloud: true });
			}

			void this.ensureRoot().triggerChange(true);
			void this.updateDescription();
		});
	}

	override dispose() {
		this._subscriptionDisposable?.dispose();
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

	private async updateDescription() {
		const subscription = await this.container.subscription.getSubscription();
		this.description = subscription.state === SubscriptionState.Paid ? undefined : '✨';
	}

	override get canReveal(): boolean {
		return false;
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(
				this.getQualifiedCommand('refresh'),
				() => {
					this.container.workspaces.resetWorkspaces();
					void this.ensureRoot().triggerChange(true);
				},
				this,
			),
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
				this.getQualifiedCommand('open'),
				async (node: WorkspaceNode) => {
					await this.container.workspaces.saveAsCodeWorkspaceFile(node.workspaceId, node.type, {
						open: true,
					});
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('delete'),
				async (node: WorkspaceNode) => {
					await this.container.workspaces.deleteCloudWorkspace(node.workspaceId);
					void node.getParent()?.triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('locateRepo'),
				async (node: RepositoryNode | WorkspaceMissingRepositoryNode) => {
					const descriptor = node.workspaceRepositoryDescriptor;
					if (descriptor == null || node.workspaceId == null) return;

					await this.container.workspaces.locateWorkspaceRepo(node.workspaceId, descriptor);

					void node.getParent()?.triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('locateAllRepos'),
				async (node: WorkspaceNode) => {
					if (node.type !== WorkspaceType.Cloud) return;

					await window.withProgress(
						{
							location: ProgressLocation.Notification,
							title: `Locating Repositories for '${node.workspace.name}'...`,
							cancellable: true,
						},
						(_progress, token) =>
							this.container.workspaces.locateAllCloudWorkspaceRepos(node.workspaceId, token),
					);

					void node.triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('openRepoNewWindow'),
				(node: RepositoryNode) => {
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					openWorkspace(node.repo.uri, { location: OpenWorkspaceLocation.NewWindow });
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('openRepoCurrentWindow'),
				(node: RepositoryNode) => {
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					openWorkspace(node.repo.uri, { location: OpenWorkspaceLocation.CurrentWindow });
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('openRepoWorkspace'),
				(node: RepositoryNode) => {
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					openWorkspace(node.repo.uri, { location: OpenWorkspaceLocation.AddToWorkspace });
				},
				this,
			),
			registerViewCommand(this.getQualifiedCommand('addRepo'), async (node: WorkspaceNode) => {
				await this.container.workspaces.addCloudWorkspaceRepo(node.workspaceId);
				void node.getParent()?.triggerChange(true);
			}),
			registerViewCommand(
				this.getQualifiedCommand('removeRepo'),
				async (node: RepositoryNode | WorkspaceMissingRepositoryNode) => {
					const descriptor = node.workspaceRepositoryDescriptor;
					if (descriptor?.id == null || node.workspaceId == null) return;

					await this.container.workspaces.removeCloudWorkspaceRepo(node.workspaceId, descriptor);
					// TODO@axosoft-ramint Do we need the grandparent here?
					void node.getParent()?.getParent()?.triggerChange(true);
				},
			),
		];
	}
}
