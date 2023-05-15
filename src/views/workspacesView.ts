import type { Disposable } from 'vscode';
import type { WorkspacesViewConfig } from '../config';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { GKCloudWorkspace } from '../plus/workspaces/models';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../subscription';
import { pluralize } from '../system/string';
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
		this._subscriptionDisposable = this.container.subscription.onDidChange(async event => {
			if (
				event.current.account == null ||
				event.current.account.id !== event.previous?.account?.id ||
				event.current.state !== event.previous?.state
			) {
				await this.container.workspaces.getWorkspaces({
					resetCloudWorkspaces: true,
					resetLocalWorkspaces: true,
				});
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

		switch (subscription.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
				this.description = '✨ GitLens+ feature';
				break;
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial: {
				const days = getSubscriptionTimeRemaining(subscription, 'days')!;
				this.description = `✨ GitLens Pro (Trial), ${days < 1 ? '<1 day' : pluralize('day', days)} left`;
				break;
			}
			case SubscriptionState.VerificationRequired:
				this.description = `✨ ${subscription.plan.effective.name} (Unverified)`;
				break;
			case SubscriptionState.Paid:
				this.description = undefined;
		}
	}

	override get canReveal(): boolean {
		return false;
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(
				this.getQualifiedCommand('refresh'),
				async () => {
					await this.container.workspaces.getWorkspaces({
						resetCloudWorkspaces: true,
						resetLocalWorkspaces: true,
					});
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
					const repoName = node instanceof RepositoryNode ? node.repo.name : node.name;
					const workspaceNode = node.getParent();
					if (workspaceNode == null || !(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					await this.container.workspaces.locateWorkspaceRepo(repoName, workspaceNode.workspaceId);

					void workspaceNode.triggerChange(true);
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
					const repoName = node instanceof RepositoryNode ? node.repo.name : node.name;
					const workspaceNode = node.getParent();
					if (!(workspaceNode instanceof WorkspaceNode)) {
						return;
					}

					const workspace = workspaceNode.workspace;
					if (!(workspace instanceof GKCloudWorkspace)) {
						return;
					}

					await this.container.workspaces.removeCloudWorkspaceRepo(workspace.id, repoName);
					void workspaceNode.getParent()?.triggerChange(true);
				},
			),
		];
	}
}
