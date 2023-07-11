import type { CancellationToken, Event } from 'vscode';
import { Disposable, EventEmitter, ProgressLocation, Uri, window, workspace } from 'vscode';
import { getSupportedWorkspacesPathMappingProvider } from '@env/providers';
import type { Container } from '../../container';
import type { GitRemote } from '../../git/models/remote';
import { RemoteResourceType } from '../../git/models/remoteResource';
import { Repository } from '../../git/models/repository';
import { showRepositoriesPicker } from '../../quickpicks/repositoryPicker';
import { SubscriptionState } from '../../subscription';
import { normalizePath } from '../../system/path';
import { openWorkspace, OpenWorkspaceLocation } from '../../system/utils';
import type { ServerConnection } from '../subscription/serverConnection';
import type { SubscriptionChangeEvent } from '../subscription/subscriptionService';
import type {
	AddWorkspaceRepoDescriptor,
	CloudWorkspaceData,
	CloudWorkspaceProviderType,
	CloudWorkspaceRepositoryDescriptor,
	GetWorkspacesResponse,
	LoadCloudWorkspacesResponse,
	LoadLocalWorkspacesResponse,
	LocalWorkspaceData,
	LocalWorkspaceRepositoryDescriptor,
	RemoteDescriptor,
	RepositoryMatch,
	WorkspaceRepositoriesByName,
	WorkspacesResponse,
} from './models';
import {
	CloudWorkspace,
	CloudWorkspaceProviderInputType,
	cloudWorkspaceProviderTypeToRemoteProviderId,
	LocalWorkspace,
	WorkspaceAddRepositoriesChoice,
	WorkspaceSyncSetting,
} from './models';
import { WorkspacesApi } from './workspacesApi';
import type { WorkspacesPathMappingProvider } from './workspacesPathMappingProvider';

export class WorkspacesService implements Disposable {
	private _onDidResetWorkspaces: EventEmitter<void> = new EventEmitter<void>();
	get onDidResetWorkspaces(): Event<void> {
		return this._onDidResetWorkspaces.event;
	}

	private _cloudWorkspaces: CloudWorkspace[] | undefined;
	private _disposable: Disposable;
	private _localWorkspaces: LocalWorkspace[] | undefined;
	private _workspacesApi: WorkspacesApi;
	private _workspacesPathProvider: WorkspacesPathMappingProvider;
	private _currentWorkspaceId: string | undefined;
	private _currentWorkspaceSyncSetting: WorkspaceSyncSetting = WorkspaceSyncSetting.Never;

	constructor(
		private readonly container: Container,
		private readonly server: ServerConnection,
	) {
		this._workspacesApi = new WorkspacesApi(this.container, this.server);
		this._workspacesPathProvider = getSupportedWorkspacesPathMappingProvider();
		this._currentWorkspaceId = workspace.getConfiguration('gitkraken')?.get<string>('workspaceId');
		this._currentWorkspaceSyncSetting =
			workspace.getConfiguration('gitkraken')?.get<WorkspaceSyncSetting>('workspaceSyncSetting') ??
			WorkspaceSyncSetting.Never;
		this._disposable = Disposable.from(container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	dispose(): void {
		this._disposable.dispose();
	}

	get currentWorkspaceId(): string | undefined {
		return this._currentWorkspaceId;
	}

	private onSubscriptionChanged(event: SubscriptionChangeEvent): void {
		if (
			event.current.account == null ||
			event.current.account.id !== event.previous?.account?.id ||
			event.current.state !== event.previous?.state
		) {
			this.resetWorkspaces({ cloud: true });
		}
	}

	private async loadCloudWorkspaces(excludeRepositories: boolean = false): Promise<LoadCloudWorkspacesResponse> {
		const subscription = await this.container.subscription.getSubscription();
		if (subscription?.account == null) {
			return {
				cloudWorkspaces: undefined,
				cloudWorkspaceInfo: 'Please sign in to use cloud workspaces.',
			};
		}

		const cloudWorkspaces: CloudWorkspace[] = [];
		let workspaces: CloudWorkspaceData[] | undefined;
		try {
			const workspaceResponse: WorkspacesResponse | undefined = await this._workspacesApi.getWorkspaces({
				includeRepositories: !excludeRepositories,
				includeOrganizations: true,
			});
			workspaces = workspaceResponse?.data?.projects?.nodes;
		} catch {
			return {
				cloudWorkspaces: undefined,
				cloudWorkspaceInfo: 'Failed to load cloud workspaces.',
			};
		}

		let filteredSharedWorkspaceCount = 0;
		const isPlusEnabled =
			subscription.state === SubscriptionState.FreeInPreviewTrial ||
			subscription.state === SubscriptionState.FreePlusInTrial ||
			subscription.state === SubscriptionState.Paid;

		if (workspaces?.length) {
			for (const workspace of workspaces) {
				const localPath = await this._workspacesPathProvider.getCloudWorkspaceCodeWorkspacePath(workspace.id);
				if (!isPlusEnabled && workspace.organization?.id) {
					filteredSharedWorkspaceCount += 1;
					continue;
				}

				const repoDescriptors = workspace.provider_data?.repositories?.nodes;
				let repositories =
					repoDescriptors != null
						? repoDescriptors.map(descriptor => ({ ...descriptor, workspaceId: workspace.id }))
						: repoDescriptors;
				if (repositories == null && !excludeRepositories) {
					repositories = [];
				}

				cloudWorkspaces.push(
					new CloudWorkspace(
						this.container,
						workspace.id,
						workspace.name,
						workspace.organization?.id,
						workspace.provider as CloudWorkspaceProviderType,
						this._currentWorkspaceId != null && this._currentWorkspaceId === workspace.id,
						repositories,
						localPath,
					),
				);
			}
		}

		return {
			cloudWorkspaces: cloudWorkspaces,
			cloudWorkspaceInfo:
				filteredSharedWorkspaceCount > 0
					? `${filteredSharedWorkspaceCount} shared workspaces hidden - upgrade to GitLens Pro to access.`
					: undefined,
		};
	}

	// TODO@ramint: When we interact more with local workspaces, this should return more info about failures.
	private async loadLocalWorkspaces(): Promise<LoadLocalWorkspacesResponse> {
		const localWorkspaces: LocalWorkspace[] = [];
		const workspaceFileData: LocalWorkspaceData =
			(await this._workspacesPathProvider.getLocalWorkspaceData())?.workspaces || {};
		for (const workspace of Object.values(workspaceFileData)) {
			localWorkspaces.push(
				new LocalWorkspace(
					this.container,
					workspace.localId,
					workspace.name,
					workspace.repositories.map(repositoryPath => ({
						localPath: repositoryPath.localPath,
						name: repositoryPath.localPath.split(/[\\/]/).pop() ?? 'unknown',
						workspaceId: workspace.localId,
					})),
					this._currentWorkspaceId != null && this._currentWorkspaceId === workspace.localId,
				),
			);
		}

		return {
			localWorkspaces: localWorkspaces,
			localWorkspaceInfo: undefined,
		};
	}

	private getCloudWorkspace(workspaceId: string): CloudWorkspace | undefined {
		return this._cloudWorkspaces?.find(workspace => workspace.id === workspaceId);
	}

	private getLocalWorkspace(workspaceId: string): LocalWorkspace | undefined {
		return this._localWorkspaces?.find(workspace => workspace.id === workspaceId);
	}

	async getWorkspaces(options?: { excludeRepositories?: boolean; force?: boolean }): Promise<GetWorkspacesResponse> {
		const getWorkspacesResponse: GetWorkspacesResponse = {
			cloudWorkspaces: [],
			localWorkspaces: [],
			cloudWorkspaceInfo: undefined,
			localWorkspaceInfo: undefined,
		};

		if (this._cloudWorkspaces == null || options?.force) {
			const loadCloudWorkspacesResponse = await this.loadCloudWorkspaces(options?.excludeRepositories);
			this._cloudWorkspaces = loadCloudWorkspacesResponse.cloudWorkspaces;
			getWorkspacesResponse.cloudWorkspaceInfo = loadCloudWorkspacesResponse.cloudWorkspaceInfo;
		}

		if (this._localWorkspaces == null || options?.force) {
			const loadLocalWorkspacesResponse = await this.loadLocalWorkspaces();
			this._localWorkspaces = loadLocalWorkspacesResponse.localWorkspaces;
			getWorkspacesResponse.localWorkspaceInfo = loadLocalWorkspacesResponse.localWorkspaceInfo;
		}

		const currentWorkspace = [...(this._cloudWorkspaces ?? []), ...(this._localWorkspaces ?? [])].find(
			workspace => workspace.current,
		);

		if (currentWorkspace != null) {
			await this.syncCurrentWorkspace(currentWorkspace);
		}

		getWorkspacesResponse.cloudWorkspaces = this._cloudWorkspaces ?? [];
		getWorkspacesResponse.localWorkspaces = this._localWorkspaces ?? [];

		return getWorkspacesResponse;
	}

	async getCloudWorkspaceRepositories(workspaceId: string): Promise<CloudWorkspaceRepositoryDescriptor[]> {
		// TODO@ramint Add error handling/logging when this is used.
		const workspaceRepos = await this._workspacesApi.getWorkspaceRepositories(workspaceId);
		const descriptors = workspaceRepos?.data?.project?.provider_data?.repositories?.nodes;
		return descriptors?.map(d => ({ ...d, workspaceId: workspaceId })) ?? [];
	}

	async syncCurrentWorkspace(workspace: CloudWorkspace | LocalWorkspace): Promise<void> {
		if (this._currentWorkspaceSyncSetting === WorkspaceSyncSetting.Never || !workspace.current) return;

		if (!(await workspace.getRepositoryDescriptors())?.length) return;

		const repositories = [...(await workspace.getRepositoriesByName()).values()].map(r => r.repository);
		const currentWorkspaceRepositoryIdMap = new Map<string, Repository>();
		for (const repository of this.container.git.openRepositories) {
			currentWorkspaceRepositoryIdMap.set(repository.id, repository);
		}
		const repositoriesToAdd = repositories.filter(r => !currentWorkspaceRepositoryIdMap.has(r.id));
		if (repositoriesToAdd.length === 0) return;
		let chosenRepoPaths: string[] = [];
		if (this._currentWorkspaceSyncSetting === WorkspaceSyncSetting.Ask) {
			const addChoice = await window.showInformationMessage(
				'New repositories found in the cloud workspace matching this workspace. Would you like to add them?',
				{ modal: true },
				{ title: 'Add' },
				{ title: 'Cancel', isCloseAffordance: true },
			);

			if (addChoice?.title !== 'Add') {
				return;
			}

			const pick = await showRepositoriesPicker(
				'Add Repositories to Workspace',
				'Choose which repositories to add to the current workspace',
				repositoriesToAdd,
			);
			if (pick.length === 0) return;
			chosenRepoPaths = pick.map(p => p.repoPath);
		} else {
			chosenRepoPaths = repositoriesToAdd.map(r => r.path);
		}

		for (const path of chosenRepoPaths) {
			openWorkspace(Uri.file(path), { location: OpenWorkspaceLocation.AddToWorkspace });
		}
	}

	resetWorkspaces(options?: { cloud?: boolean; local?: boolean }) {
		if (options?.cloud ?? true) {
			this._cloudWorkspaces = undefined;
		}
		if (options?.local ?? true) {
			this._localWorkspaces = undefined;
		}

		this._onDidResetWorkspaces.fire();
	}

	async getCloudWorkspaceRepoPath(cloudWorkspaceId: string, repoId: string): Promise<string | undefined> {
		return this._workspacesPathProvider.getCloudWorkspaceRepoPath(cloudWorkspaceId, repoId);
	}

	async updateCloudWorkspaceRepoLocalPath(workspaceId: string, repoId: string, localPath: string): Promise<void> {
		await this._workspacesPathProvider.writeCloudWorkspaceRepoDiskPathToMap(workspaceId, repoId, localPath);
	}

	private async getRepositoriesInParentFolder(cancellation?: CancellationToken): Promise<Repository[] | undefined> {
		const parentUri = (
			await window.showOpenDialog({
				title: `Choose a folder containing repositories for this workspace`,
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
			})
		)?.[0];

		if (parentUri == null || cancellation?.isCancellationRequested) return undefined;

		try {
			return this.container.git.findRepositories(parentUri, {
				cancellation: cancellation,
				depth: 1,
				silent: true,
			});
		} catch (ex) {
			return undefined;
		}
	}

	async locateAllCloudWorkspaceRepos(workspaceId: string, cancellation?: CancellationToken): Promise<void> {
		const workspace = this.getCloudWorkspace(workspaceId);
		if (workspace == null) return;

		const repoDescriptors = await workspace.getRepositoryDescriptors();
		if (repoDescriptors == null || repoDescriptors.length === 0) return;

		const foundRepos = await this.getRepositoriesInParentFolder(cancellation);
		if (foundRepos == null || foundRepos.length === 0 || cancellation?.isCancellationRequested) return;

		for (const repoMatch of (
			await this.resolveWorkspaceRepositoriesByName(workspaceId, {
				cancellation: cancellation,
				repositories: foundRepos,
			})
		).values()) {
			await this.locateWorkspaceRepo(workspaceId, repoMatch.descriptor, repoMatch.repository);

			if (cancellation?.isCancellationRequested) return;
		}
	}

	async locateWorkspaceRepo(
		workspaceId: string,
		descriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor,
	): Promise<void>;
	async locateWorkspaceRepo(
		workspaceId: string,
		descriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor,
		// eslint-disable-next-line @typescript-eslint/unified-signatures
		uri: Uri,
	): Promise<void>;
	async locateWorkspaceRepo(
		workspaceId: string,
		descriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor,
		// eslint-disable-next-line @typescript-eslint/unified-signatures
		repository: Repository,
	): Promise<void>;
	async locateWorkspaceRepo(
		workspaceId: string,
		descriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor,
		uriOrRepository?: Uri | Repository,
	): Promise<void> {
		let repo;
		if (uriOrRepository == null || uriOrRepository instanceof Uri) {
			let repoLocatedUri = uriOrRepository;
			if (repoLocatedUri == null) {
				repoLocatedUri = (
					await window.showOpenDialog({
						title: `Choose a location for ${descriptor.name}`,
						canSelectFiles: false,
						canSelectFolders: true,
						canSelectMany: false,
					})
				)?.[0];
			}

			if (repoLocatedUri == null) return;

			repo = await this.container.git.getOrOpenRepository(repoLocatedUri, {
				closeOnOpen: true,
				detectNested: false,
			});
			if (repo == null) return;
		} else {
			repo = uriOrRepository;
		}

		const repoPath = repo.uri.fsPath;

		const remotes = await repo.getRemotes();
		const remoteUrls: string[] = [];
		for (const remote of remotes) {
			const remoteUrl = remote.provider?.url({ type: RemoteResourceType.Repo });
			if (remoteUrl != null) {
				remoteUrls.push(remoteUrl);
			}
		}

		for (const remoteUrl of remoteUrls) {
			await this.container.repositoryPathMapping.writeLocalRepoPath({ remoteUrl: remoteUrl }, repoPath);
		}

		if (descriptor.id != null) {
			await this.container.repositoryPathMapping.writeLocalRepoPath(
				{
					remoteUrl: descriptor.url,
					repoInfo: {
						provider: descriptor.provider,
						owner: descriptor.provider_organization_id,
						repoName: descriptor.name,
					},
				},
				repoPath,
			);
			await this.updateCloudWorkspaceRepoLocalPath(workspaceId, descriptor.id, repoPath);
		}
	}

	async createCloudWorkspace(options?: { repos?: Repository[] }): Promise<void> {
		const input = window.createInputBox();
		input.title = 'Create Cloud Workspace';
		const quickpick = window.createQuickPick();
		quickpick.title = 'Create Cloud Workspace';
		const quickpickLabelToProviderType: Record<string, CloudWorkspaceProviderInputType> = {
			GitHub: CloudWorkspaceProviderInputType.GitHub,
			'GitHub Enterprise': CloudWorkspaceProviderInputType.GitHubEnterprise,
			// TODO add support for these in the future
			// GitLab: CloudWorkspaceProviderInputType.GitLab,
			// 'GitLab Self-Managed': CloudWorkspaceProviderInputType.GitLabSelfHosted,
			// Bitbucket: CloudWorkspaceProviderInputType.Bitbucket,
			// Azure: CloudWorkspaceProviderInputType.Azure,
		};

		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		let workspaceName: string | undefined;
		let workspaceDescription: string | undefined;

		let hostUrl: string | undefined;
		let azureOrganizationName: string | undefined;
		let azureProjectName: string | undefined;
		let workspaceProvider: CloudWorkspaceProviderInputType | undefined;
		if (options?.repos != null && options.repos.length > 0) {
			// Currently only GitHub is supported.
			for (const repo of options.repos) {
				const repoRemotes = await repo.getRemotes({ filter: r => r.domain === 'github.com' });
				if (repoRemotes.length === 0) {
					await window.showErrorMessage(
						`Only GitHub is supported for this operation. Please ensure all open repositories are hosted on GitHub.`,
						{ modal: true },
					);
					return;
				}
			}

			workspaceProvider = CloudWorkspaceProviderInputType.GitHub;
		}

		try {
			workspaceName = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = 'Please enter a non-empty name for the workspace';
							return;
						}

						resolve(value);
					}),
				);

				input.placeholder = 'Please enter a name for the new workspace';
				input.prompt = 'Enter your workspace name';
				input.show();
			});

			if (!workspaceName) return;

			workspaceDescription = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = 'Please enter a non-empty description for the workspace';
							return;
						}

						resolve(value);
					}),
				);

				input.value = '';
				input.title = 'Create Workspace';
				input.placeholder = 'Please enter a description for the new workspace';
				input.prompt = 'Enter your workspace description';
				input.show();
			});

			if (!workspaceDescription) return;

			if (workspaceProvider == null) {
				workspaceProvider = await new Promise<CloudWorkspaceProviderInputType | undefined>(resolve => {
					disposables.push(
						quickpick.onDidHide(() => resolve(undefined)),
						quickpick.onDidAccept(() => {
							if (quickpick.activeItems.length !== 0) {
								resolve(quickpickLabelToProviderType[quickpick.activeItems[0].label]);
							}
						}),
					);

					quickpick.placeholder = 'Please select a provider for the new workspace';
					quickpick.items = Object.keys(quickpickLabelToProviderType).map(label => ({ label: label }));
					quickpick.canSelectMany = false;
					quickpick.show();
				});
			}

			if (!workspaceProvider) return;

			if (
				workspaceProvider == CloudWorkspaceProviderInputType.GitHubEnterprise ||
				workspaceProvider == CloudWorkspaceProviderInputType.GitLabSelfHosted
			) {
				hostUrl = await new Promise<string | undefined>(resolve => {
					disposables.push(
						input.onDidHide(() => resolve(undefined)),
						input.onDidAccept(() => {
							const value = input.value.trim();
							if (!value) {
								input.validationMessage = 'Please enter a non-empty host URL for the workspace';
								return;
							}

							resolve(value);
						}),
					);

					input.value = '';
					input.placeholder = 'Please enter a host URL for the new workspace';
					input.prompt = 'Enter your workspace host URL';
					input.show();
				});

				if (!hostUrl) return;
			}

			if (workspaceProvider == CloudWorkspaceProviderInputType.Azure) {
				azureOrganizationName = await new Promise<string | undefined>(resolve => {
					disposables.push(
						input.onDidHide(() => resolve(undefined)),
						input.onDidAccept(() => {
							const value = input.value.trim();
							if (!value) {
								input.validationMessage =
									'Please enter a non-empty organization name for the workspace';
								return;
							}

							resolve(value);
						}),
					);

					input.value = '';
					input.placeholder = 'Please enter an organization name for the new workspace';
					input.prompt = 'Enter your workspace organization name';
					input.show();
				});

				if (!azureOrganizationName) return;

				azureProjectName = await new Promise<string | undefined>(resolve => {
					disposables.push(
						input.onDidHide(() => resolve(undefined)),
						input.onDidAccept(() => {
							const value = input.value.trim();
							if (!value) {
								input.validationMessage = 'Please enter a non-empty project name for the workspace';
								return;
							}

							resolve(value);
						}),
					);

					input.value = '';
					input.placeholder = 'Please enter a project name for the new workspace';
					input.prompt = 'Enter your workspace project name';
					input.show();
				});

				if (!azureProjectName) return;
			}
		} finally {
			input.dispose();
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}

		const createOptions = {
			name: workspaceName,
			description: workspaceDescription,
			provider: workspaceProvider,
			hostUrl: hostUrl,
			azureOrganizationName: azureOrganizationName,
			azureProjectName: azureProjectName,
		};

		let createdProjectData: CloudWorkspaceData | null | undefined;
		try {
			const response = await this._workspacesApi.createWorkspace(createOptions);
			createdProjectData = response?.data?.create_project;
		} catch {
			return;
		}

		if (createdProjectData != null) {
			// Add the new workspace to cloud workspaces
			if (this._cloudWorkspaces == null) {
				this._cloudWorkspaces = [];
			}

			const localPath = await this._workspacesPathProvider.getCloudWorkspaceCodeWorkspacePath(
				createdProjectData.id,
			);

			this._cloudWorkspaces?.push(
				new CloudWorkspace(
					this.container,
					createdProjectData.id,
					createdProjectData.name,
					createdProjectData.organization?.id,
					createdProjectData.provider as CloudWorkspaceProviderType,
					this._currentWorkspaceId != null && this._currentWorkspaceId === createdProjectData.id,
					[],
					localPath,
				),
			);

			const newWorkspace = this.getCloudWorkspace(createdProjectData.id);
			if (newWorkspace != null) {
				await this.addCloudWorkspaceRepos(newWorkspace.id, {
					repos: options?.repos,
					suppressNotifications: true,
				});
			}
		}
	}

	async deleteCloudWorkspace(workspaceId: string) {
		const confirmation = await window.showWarningMessage(
			`Are you sure you want to delete this workspace? This cannot be undone.`,
			{ modal: true },
			{ title: 'Confirm' },
			{ title: 'Cancel', isCloseAffordance: true },
		);
		if (confirmation == null || confirmation.title == 'Cancel') return;
		try {
			const response = await this._workspacesApi.deleteWorkspace(workspaceId);
			if (response?.data?.delete_project?.id === workspaceId) {
				// Remove the workspace from the local workspace list.
				this._cloudWorkspaces = this._cloudWorkspaces?.filter(w => w.id !== workspaceId);
			}
		} catch (error) {
			void window.showErrorMessage(error.message);
		}
	}

	private async filterReposForProvider(
		repos: Repository[],
		provider: CloudWorkspaceProviderType,
	): Promise<Repository[]> {
		const validRepos: Repository[] = [];
		for (const repo of repos) {
			const matchingRemotes = await repo.getRemotes({
				filter: r => r.provider?.id === cloudWorkspaceProviderTypeToRemoteProviderId[provider],
			});
			if (matchingRemotes.length) {
				validRepos.push(repo);
			}
		}

		return validRepos;
	}

	private async filterReposForCloudWorkspace(repos: Repository[], workspaceId: string): Promise<Repository[]> {
		const workspace = this.getCloudWorkspace(workspaceId) ?? this.getLocalWorkspace(workspaceId);
		if (workspace == null) return repos;
		const workspaceRepos = [...(await workspace.getRepositoriesByName()).values()].map(match => match.repository);
		return repos.filter(repo => !workspaceRepos.find(r => r.id === repo.id));
	}

	async addCloudWorkspaceRepos(
		workspaceId: string,
		options?: { repos?: Repository[]; suppressNotifications?: boolean },
	) {
		const workspace = this.getCloudWorkspace(workspaceId);
		if (workspace == null) return;

		const repoInputs: (AddWorkspaceRepoDescriptor & { repo: Repository; url?: string })[] = [];
		let reposOrRepoPaths: Repository[] | string[] | undefined = options?.repos;
		if (!options?.repos) {
			let validRepos = await this.filterReposForProvider(this.container.git.openRepositories, workspace.provider);
			validRepos = await this.filterReposForCloudWorkspace(validRepos, workspaceId);
			const choices: {
				label: string;
				description?: string;
				choice: WorkspaceAddRepositoriesChoice;
				picked?: boolean;
			}[] = [
				{
					label: 'Choose repositories from a folder',
					description: undefined,
					choice: WorkspaceAddRepositoriesChoice.ParentFolder,
				},
			];

			if (validRepos.length > 0) {
				choices.unshift({
					label: 'Choose repositories from the current window',
					description: undefined,
					choice: WorkspaceAddRepositoriesChoice.CurrentWindow,
				});
			}

			choices[0].picked = true;

			const repoChoice = await window.showQuickPick(choices, {
				placeHolder: 'Choose repositories from the current window or a folder',
				ignoreFocusOut: true,
			});

			if (repoChoice == null) return;

			if (repoChoice.choice === WorkspaceAddRepositoriesChoice.ParentFolder) {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: `Finding repositories to add to the workspace...`,
						cancellable: true,
					},
					async (_progress, token) => {
						const foundRepos = await this.getRepositoriesInParentFolder(token);
						if (foundRepos == null) return;
						if (foundRepos.length === 0) {
							if (!options?.suppressNotifications) {
								void window.showInformationMessage(`No repositories found in the chosen folder.`, {
									modal: true,
								});
							}
							return;
						}

						if (token.isCancellationRequested) return;
						validRepos = await this.filterReposForProvider(foundRepos, workspace.provider);
						if (validRepos.length === 0) {
							if (!options?.suppressNotifications) {
								void window.showInformationMessage(
									`No matching repositories found for provider ${workspace.provider}.`,
									{
										modal: true,
									},
								);
							}
							return;
						}

						if (token.isCancellationRequested) return;
						validRepos = await this.filterReposForCloudWorkspace(validRepos, workspaceId);
						if (validRepos.length === 0) {
							if (!options?.suppressNotifications) {
								void window.showInformationMessage(
									`All possible repositories are already in this workspace.`,
									{
										modal: true,
									},
								);
							}
						}
					},
				);
			}

			const pick = await showRepositoriesPicker(
				'Add Repositories to Workspace',
				'Choose which repositories to add to the workspace',
				validRepos,
			);
			if (pick.length === 0) return;
			reposOrRepoPaths = pick.map(p => p.repoPath);
		}

		if (reposOrRepoPaths == null) return;
		for (const repoOrPath of reposOrRepoPaths) {
			const repo =
				repoOrPath instanceof Repository
					? repoOrPath
					: await this.container.git.getOrOpenRepository(Uri.file(repoOrPath), { closeOnOpen: true });
			if (repo == null) continue;
			const remote = (await repo.getRemote('origin')) || (await repo.getRemotes())?.[0];
			const remoteDescriptor = getRemoteDescriptor(remote);
			if (remoteDescriptor == null) continue;
			repoInputs.push({
				owner: remoteDescriptor.owner,
				repoName: remoteDescriptor.repoName,
				repo: repo,
				url: remoteDescriptor.url,
			});
		}

		if (repoInputs.length === 0) return;

		let newRepoDescriptors: CloudWorkspaceRepositoryDescriptor[] = [];
		const oldDescriptorIds = new Set((await workspace.getRepositoryDescriptors()).map(r => r.id));

		try {
			const response = await this._workspacesApi.addReposToWorkspace(
				workspaceId,
				repoInputs.map(r => ({ owner: r.owner, repoName: r.repoName })),
			);

			if (response?.data.add_repositories_to_project == null) return;
			newRepoDescriptors = Object.values(response.data.add_repositories_to_project.provider_data)
				.filter(descriptor => descriptor != null)
				.map(descriptor => ({
					...descriptor,
					workspaceId: workspaceId,
				})) as CloudWorkspaceRepositoryDescriptor[];
		} catch (error) {
			void window.showErrorMessage(error.message);
			return;
		}

		if (newRepoDescriptors.length > 0) {
			workspace.addRepositories(newRepoDescriptors);
		}

		if (newRepoDescriptors.length < repoInputs.length) {
			newRepoDescriptors = (await workspace.getRepositoryDescriptors({ force: true })).filter(
				r => !oldDescriptorIds.has(r.id),
			);
		}

		for (const { repo, repoName, url } of repoInputs) {
			const successfullyAddedDescriptor = newRepoDescriptors.find(
				r => r.name.toLowerCase() === repoName || r.url === url,
			);
			if (successfullyAddedDescriptor == null) continue;
			await this.locateWorkspaceRepo(workspaceId, successfullyAddedDescriptor, repo);
		}
	}

	async removeCloudWorkspaceRepo(workspaceId: string, descriptor: CloudWorkspaceRepositoryDescriptor) {
		const workspace = this.getCloudWorkspace(workspaceId);
		if (workspace == null) return;

		const confirmation = await window.showWarningMessage(
			`Are you sure you want to remove ${descriptor.name} from this workspace? This cannot be undone.`,
			{ modal: true },
			{ title: 'Confirm' },
			{ title: 'Cancel', isCloseAffordance: true },
		);
		if (confirmation == null || confirmation.title == 'Cancel') return;
		try {
			const response = await this._workspacesApi.removeReposFromWorkspace(workspaceId, [
				{ owner: descriptor.provider_organization_id, repoName: descriptor.name },
			]);

			if (response?.data.remove_repositories_from_project == null) return;

			workspace.removeRepositories([descriptor.name]);
		} catch (error) {
			void window.showErrorMessage(error.message);
		}
	}

	async resolveWorkspaceRepositoriesByName(
		workspaceId: string,
		options?: {
			cancellation?: CancellationToken;
			repositories?: Repository[];
			resolveFromPath?: boolean;
			usePathMapping?: boolean;
		},
	): Promise<WorkspaceRepositoriesByName> {
		const workspaceRepositoriesByName: WorkspaceRepositoriesByName = new Map<string, RepositoryMatch>();

		const workspace = this.getLocalWorkspace(workspaceId) ?? this.getCloudWorkspace(workspaceId);
		if (workspace == null) return workspaceRepositoriesByName;

		const repoDescriptors = await workspace.getRepositoryDescriptors();
		if (repoDescriptors == null || repoDescriptors.length === 0) return workspaceRepositoriesByName;

		const currentRepositories = options?.repositories ?? this.container.git.repositories;

		const reposProviderMap = new Map<string, Repository>();
		const reposPathMap = new Map<string, Repository>();
		for (const repo of currentRepositories) {
			if (options?.cancellation?.isCancellationRequested) break;
			reposPathMap.set(normalizePath(repo.uri.fsPath.toLowerCase()), repo);

			if (workspace instanceof CloudWorkspace) {
				const remotes = await repo.getRemotes();
				for (const remote of remotes) {
					const remoteDescriptor = getRemoteDescriptor(remote);
					if (remoteDescriptor == null) continue;
					reposProviderMap.set(
						`${remoteDescriptor.provider}/${remoteDescriptor.owner}/${remoteDescriptor.repoName}`,
						repo,
					);
				}
			}
		}

		for (const descriptor of repoDescriptors) {
			let repoLocalPath = null;
			let foundRepo = null;

			// Local workspace repo descriptors should match on local path
			if (descriptor.id == null) {
				repoLocalPath = descriptor.localPath;
				// Cloud workspace repo descriptors should match on either provider/owner/name or url on any remote
			} else if (options?.usePathMapping === true) {
				repoLocalPath = await this.getMappedPathForCloudWorkspaceRepoDescriptor(descriptor);
			}

			if (repoLocalPath != null) {
				foundRepo = reposPathMap.get(normalizePath(repoLocalPath.toLowerCase()));
			}

			if (foundRepo == null && descriptor.id != null && descriptor.provider != null) {
				foundRepo = reposProviderMap.get(
					`${descriptor.provider.toLowerCase()}/${descriptor.provider_organization_id.toLowerCase()}/${descriptor.name.toLowerCase()}`,
				);
			}

			if (repoLocalPath != null && foundRepo == null && options?.resolveFromPath === true) {
				foundRepo = await this.container.git.getOrOpenRepository(Uri.file(repoLocalPath), {
					closeOnOpen: true,
					force: true,
				});
				// TODO: Add this logic back in once we think through virtual repository support a bit more.
				// We want to support virtual repositories not just as an automatic backup, but as a user choice.
				/*if (!foundRepo) {
					let uri: Uri | undefined = undefined;
					if (repoLocalPath) {
						uri = Uri.file(repoLocalPath);
					} else if (descriptor.url) {
						uri = Uri.parse(descriptor.url);
						uri = uri.with({
							scheme: Schemes.Virtual,
							authority: encodeAuthority<GitHubAuthorityMetadata>('github'),
							path: uri.path,
						});
					}
					if (uri) {
						foundRepo = await this.container.git.getOrOpenRepository(uri, { closeOnOpen: true });
					}
				}*/
			}

			if (foundRepo != null) {
				workspaceRepositoriesByName.set(descriptor.name, { descriptor: descriptor, repository: foundRepo });
			}
		}

		return workspaceRepositoriesByName;
	}

	async saveAsCodeWorkspaceFile(workspaceId: string): Promise<void> {
		const workspace = this.getCloudWorkspace(workspaceId) ?? this.getLocalWorkspace(workspaceId);
		if (workspace == null) return;

		const repoDescriptors = await workspace.getRepositoryDescriptors();
		if (repoDescriptors == null) return;

		const workspaceRepositoriesByName = await workspace.getRepositoriesByName();

		if (workspaceRepositoriesByName.size === 0) {
			void window.showErrorMessage('No repositories could be found in this workspace.', { modal: true });
			return;
		}

		const workspaceFolderPaths: string[] = [];
		for (const repoMatch of workspaceRepositoriesByName.values()) {
			const repo = repoMatch.repository;
			if (!repo.virtual) {
				workspaceFolderPaths.push(repo.uri.fsPath);
			}
		}

		if (workspaceFolderPaths.length < repoDescriptors.length) {
			const confirmation = await window.showWarningMessage(
				`Some repositories in this workspace could not be located locally. Do you want to continue?`,
				{ modal: true },
				{ title: 'Continue' },
				{ title: 'Cancel', isCloseAffordance: true },
			);
			if (confirmation == null || confirmation.title == 'Cancel') return;
		}

		// Have the user choose a name and location for the new workspace file
		const newWorkspaceUri = await window.showSaveDialog({
			defaultUri: Uri.file(`${workspace.name}.code-workspace`),
			filters: {
				'Code Workspace': ['code-workspace'],
			},
			title: 'Choose a location for the new code workspace file',
		});

		if (newWorkspaceUri == null) return;

		const newWorkspaceSyncSetting = await window.showInformationMessage(
			'Would you like to sync your new workspace file with its cloud workspace?',
			{ modal: true },
			{ title: 'Always', option: WorkspaceSyncSetting.Always },
			{ title: 'Never', option: WorkspaceSyncSetting.Never },
			{ title: 'Ask every time', option: WorkspaceSyncSetting.Ask },
		);

		const created = await this._workspacesPathProvider.writeCodeWorkspaceFile(
			newWorkspaceUri,
			workspaceFolderPaths,
			{
				workspaceId: workspaceId,
				workspaceSyncSetting: newWorkspaceSyncSetting?.option ?? WorkspaceSyncSetting.Never,
			},
		);

		if (!created) {
			void window.showErrorMessage('Could not create the new workspace file. Check logs for details');
			return;
		}

		workspace.setLocalPath(newWorkspaceUri.fsPath);

		const open = await window.showInformationMessage(
			`Workspace file created for ${workspace.name}. Would you like to open it now?`,
			{ modal: true },
			{ title: 'Open in New Window', location: OpenWorkspaceLocation.NewWindow },
			{ title: 'Open in Current Window', location: OpenWorkspaceLocation.CurrentWindow },
			{ title: 'Cancel', isCloseAffordance: true },
		);

		if (open == null || open.title == 'Cancel') return;

		void this.openCodeWorkspaceFile(workspaceId, { location: open.location });
	}

	async changeCurrentCodeWorkspaceSyncSetting(): Promise<void> {
		if (
			workspace.workspaceFile == null ||
			this._currentWorkspaceId == null ||
			this._currentWorkspaceSyncSetting == null
		) {
			return;
		}

		let syncOptions = [
			{ title: 'Always', option: WorkspaceSyncSetting.Always },
			{ title: 'Never', option: WorkspaceSyncSetting.Never },
			{ title: 'Ask every time', option: WorkspaceSyncSetting.Ask },
		];
		syncOptions = syncOptions.filter(s => s.option !== this._currentWorkspaceSyncSetting);

		// Show a quickpick without the current sync setting as an option
		const newWorkspaceSyncOption = await window.showQuickPick(
			syncOptions.map(s => s.title),
			{
				placeHolder: 'Choose a new sync setting for this workspace',
			},
		);
		if (newWorkspaceSyncOption == null) return;

		const newWorkspaceSyncSetting = syncOptions.find(s => s.title === newWorkspaceSyncOption)?.option;
		if (newWorkspaceSyncSetting == null) return;

		const updated = await this._workspacesPathProvider.updateCodeWorkspaceFileSettings(workspace.workspaceFile, {
			workspaceSyncSetting: newWorkspaceSyncSetting,
		});
		if (!updated) return;
		this._currentWorkspaceSyncSetting = newWorkspaceSyncSetting;
	}

	async openCodeWorkspaceFile(workspaceId: string, options?: { location?: OpenWorkspaceLocation }): Promise<void> {
		const workspace = this.getCloudWorkspace(workspaceId) ?? this.getLocalWorkspace(workspaceId);
		if (workspace == null) return;
		if (workspace.localPath == null) {
			const create = await window.showInformationMessage(
				`The workspace file for ${workspace.name} has not been created. Would you like to create it now?`,
				{ modal: true },
				{ title: 'Create' },
				{ title: 'Cancel', isCloseAffordance: true },
			);

			if (create == null || create.title == 'Cancel') return;
			return void this.saveAsCodeWorkspaceFile(workspaceId);
		}

		let openLocation =
			options?.location === OpenWorkspaceLocation.CurrentWindow
				? OpenWorkspaceLocation.CurrentWindow
				: OpenWorkspaceLocation.NewWindow;
		if (!options?.location) {
			const openLocationChoice = await window.showInformationMessage(
				`How would you like to open the workspace file for ${workspace.name}?`,
				{ modal: true },
				{ title: 'Open in New Window', location: OpenWorkspaceLocation.NewWindow },
				{ title: 'Open in Current Window', location: OpenWorkspaceLocation.CurrentWindow },
				{ title: 'Cancel', isCloseAffordance: true },
			);

			if (openLocationChoice == null || openLocationChoice.title == 'Cancel') return;
			openLocation = openLocationChoice.location ?? OpenWorkspaceLocation.NewWindow;
		}

		if (!(await this._workspacesPathProvider.confirmCloudWorkspaceCodeWorkspaceFilePath(workspace.id))) {
			await this._workspacesPathProvider.removeCloudWorkspaceCodeWorkspaceFilePath(workspace.id);
			workspace.setLocalPath(undefined);
			const locateChoice = await window.showInformationMessage(
				`The workspace file for ${workspace.name} could not be found. Would you like to locate it now?`,
				{ modal: true },
				{ title: 'Locate' },
				{ title: 'Cancel', isCloseAffordance: true },
			);

			if (locateChoice?.title !== 'Locate') return;
			const newPath = (
				await window.showOpenDialog({
					defaultUri: Uri.file(workspace.localPath),
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					filters: {
						'Code Workspace': ['code-workspace'],
					},
					title: 'Locate the workspace file',
				})
			)?.[0]?.fsPath;

			if (newPath == null) return;

			await this._workspacesPathProvider.writeCloudWorkspaceCodeWorkspaceFilePathToMap(workspace.id, newPath);
			workspace.setLocalPath(newPath);
		}

		openWorkspace(Uri.file(workspace.localPath), { location: openLocation });
	}

	private async getMappedPathForCloudWorkspaceRepoDescriptor(
		descriptor: CloudWorkspaceRepositoryDescriptor,
	): Promise<string | undefined> {
		let repoLocalPath = await this.getCloudWorkspaceRepoPath(descriptor.workspaceId, descriptor.id);
		if (repoLocalPath == null) {
			repoLocalPath = (
				await this.container.repositoryPathMapping.getLocalRepoPaths({
					remoteUrl: descriptor.url,
					repoInfo: {
						repoName: descriptor.name,
						provider: descriptor.provider,
						owner: descriptor.provider_organization_id,
					},
				})
			)?.[0];
		}

		return repoLocalPath;
	}
}

function getRemoteDescriptor(remote: GitRemote): RemoteDescriptor | undefined {
	if (remote.provider?.owner == null) return undefined;
	const remoteRepoName = remote.provider.path.split('/').pop();
	if (remoteRepoName == null) return undefined;
	return {
		provider: remote.provider.id.toLowerCase(),
		owner: remote.provider.owner.toLowerCase(),
		repoName: remoteRepoName.toLowerCase(),
		url: remote.provider.url({ type: RemoteResourceType.Repo }),
	};
}

// TODO: Add back in once we think through virtual repository support a bit more.
/* function encodeAuthority<T>(scheme: string, metadata?: T): string {
	return `${scheme}${metadata != null ? `+${encodeUtf8Hex(JSON.stringify(metadata))}` : ''}`;
} */
