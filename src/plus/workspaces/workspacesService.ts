import type { Disposable } from 'vscode';
import { Uri, window } from 'vscode';
import { encodeUtf8Hex } from '@env/hex';
import { getSupportedWorkspacesPathProvider } from '@env/providers';
import { Schemes } from '../../constants';
import type { Container } from '../../container';
import { RemoteResourceType } from '../../git/models/remoteResource';
import type { Repository } from '../../git/models/repository';
import { showRepositoryPicker } from '../../quickpicks/repositoryPicker';
import { SubscriptionState } from '../../subscription';
import { openWorkspace, OpenWorkspaceLocation } from '../../system/utils';
import type { GitHubAuthorityMetadata } from '../remotehub';
import type { ServerConnection } from '../subscription/serverConnection';
import type {
	AddWorkspaceRepoDescriptor,
	CloudWorkspaceData,
	CloudWorkspaceProviderType,
	CloudWorkspaceRepositoryDescriptor,
	GetCloudWorkspaceRepositoriesResponse,
	GetWorkspacesResponse,
	LoadCloudWorkspacesResponse,
	LoadLocalWorkspacesResponse,
	LocalWorkspaceData,
	LocalWorkspaceRepositoryDescriptor,
	WorkspaceRepositoriesByName,
	WorkspacesResponse,
} from './models';
import {
	CloudWorkspaceProviderInputType,
	cloudWorkspaceProviderInputTypeToRemoteProviderId,
	cloudWorkspaceProviderTypeToRemoteProviderId,
	GKCloudWorkspace,
	GKLocalWorkspace,
	WorkspaceType,
} from './models';
import { WorkspacesApi } from './workspacesApi';
import type { WorkspacesPathProvider } from './workspacesPathProvider';

export class WorkspacesService implements Disposable {
	private _cloudWorkspaces: GKCloudWorkspace[] | undefined = undefined;
	private _localWorkspaces: GKLocalWorkspace[] | undefined = undefined;
	private _workspacesApi: WorkspacesApi;
	private _workspacesPathProvider: WorkspacesPathProvider;

	// TODO@ramint Add error handling/logging when this is used.
	private readonly _getCloudWorkspaceRepos: (workspaceId: string) => Promise<GetCloudWorkspaceRepositoriesResponse> =
		async (workspaceId: string) => {
			try {
				const workspaceRepos = await this._workspacesApi.getWorkspaceRepositories(workspaceId);
				return {
					repositories: workspaceRepos?.data?.project?.provider_data?.repositories?.nodes ?? [],
					repositoriesInfo: undefined,
				};
			} catch {
				return {
					repositories: undefined,
					repositoriesInfo: 'Failed to load repositories for this workspace.',
				};
			}
		};

	constructor(private readonly container: Container, private readonly server: ServerConnection) {
		this._workspacesApi = new WorkspacesApi(this.container, this.server);
		this._workspacesPathProvider = getSupportedWorkspacesPathProvider();
	}

	dispose(): void {}

	private async loadCloudWorkspaces(excludeRepositories: boolean = false): Promise<LoadCloudWorkspacesResponse> {
		const subscription = await this.container.subscription.getSubscription();
		if (subscription?.account == null) {
			return {
				cloudWorkspaces: undefined,
				cloudWorkspaceInfo: 'Please sign in to use cloud workspaces.',
			};
		}

		const cloudWorkspaces: GKCloudWorkspace[] = [];
		let workspaces: CloudWorkspaceData[] | undefined;
		try {
			const workspaceResponse: WorkspacesResponse | undefined = excludeRepositories
				? await this._workspacesApi.getWorkspaces()
				: await this._workspacesApi.getWorkspacesWithRepos();
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
				if (!isPlusEnabled && workspace.organization?.id) {
					filteredSharedWorkspaceCount += 1;
					continue;
				}

				let repositories: CloudWorkspaceRepositoryDescriptor[] | undefined =
					workspace.provider_data?.repositories?.nodes;
				if (repositories == null && !excludeRepositories) {
					repositories = [];
				}

				cloudWorkspaces.push(
					new GKCloudWorkspace(
						workspace.id,
						workspace.name,
						workspace.organization?.id,
						workspace.provider as CloudWorkspaceProviderType,
						this._getCloudWorkspaceRepos,
						repositories,
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
		const localWorkspaces: GKLocalWorkspace[] = [];
		const workspaceFileData: LocalWorkspaceData =
			(await this._workspacesPathProvider.getLocalWorkspaceData())?.workspaces || {};
		for (const workspace of Object.values(workspaceFileData)) {
			localWorkspaces.push(
				new GKLocalWorkspace(
					workspace.localId,
					workspace.name,
					workspace.repositories.map(repositoryPath => ({
						localPath: repositoryPath.localPath,
						name: repositoryPath.localPath.split(/[\\/]/).pop() ?? 'unknown',
					})),
				),
			);
		}

		return {
			localWorkspaces: localWorkspaces,
			localWorkspaceInfo: undefined,
		};
	}

	private getCloudWorkspace(workspaceId: string): GKCloudWorkspace | undefined {
		return this._cloudWorkspaces?.find(workspace => workspace.id === workspaceId);
	}

	private getLocalWorkspace(workspaceId: string): GKLocalWorkspace | undefined {
		return this._localWorkspaces?.find(workspace => workspace.id === workspaceId);
	}

	async getWorkspaces(options?: {
		excludeCloudRepositories?: boolean;
		resetCloudWorkspaces?: boolean;
		resetLocalWorkspaces?: boolean;
	}): Promise<GetWorkspacesResponse> {
		const getWorkspacesResponse: GetWorkspacesResponse = {
			cloudWorkspaces: [],
			localWorkspaces: [],
			cloudWorkspaceInfo: undefined,
			localWorkspaceInfo: undefined,
		};

		if (this._cloudWorkspaces == null || options?.resetCloudWorkspaces) {
			const loadCloudWorkspacesResponse = await this.loadCloudWorkspaces(options?.excludeCloudRepositories);
			this._cloudWorkspaces = loadCloudWorkspacesResponse.cloudWorkspaces;
			getWorkspacesResponse.cloudWorkspaceInfo = loadCloudWorkspacesResponse.cloudWorkspaceInfo;
		}

		if (this._localWorkspaces == null || options?.resetLocalWorkspaces) {
			const loadLocalWorkspacesResponse = await this.loadLocalWorkspaces();
			this._localWorkspaces = loadLocalWorkspacesResponse.localWorkspaces;
			getWorkspacesResponse.localWorkspaceInfo = loadLocalWorkspacesResponse.localWorkspaceInfo;
		}

		getWorkspacesResponse.cloudWorkspaces = this._cloudWorkspaces ?? [];
		getWorkspacesResponse.localWorkspaces = this._localWorkspaces ?? [];

		return getWorkspacesResponse;
	}

	resetWorkspaces() {
		this._cloudWorkspaces = undefined;
		this._localWorkspaces = undefined;
	}

	async getCloudWorkspaceRepoPath(cloudWorkspaceId: string, repoId: string): Promise<string | undefined> {
		return this._workspacesPathProvider.getCloudWorkspaceRepoPath(cloudWorkspaceId, repoId);
	}

	async updateCloudWorkspaceRepoLocalPath(workspaceId: string, repoId: string, localPath: string): Promise<void> {
		await this._workspacesPathProvider.writeCloudWorkspaceDiskPathToMap(workspaceId, repoId, localPath);
	}

	async locateWorkspaceRepo(repoName: string, workspaceId?: string) {
		const repoLocatedUri = (
			await window.showOpenDialog({
				title: `Choose a location for ${repoName}`,
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
			})
		)?.[0];

		if (repoLocatedUri == null) {
			return;
		}

		const repo = await this.container.git.getOrOpenRepository(repoLocatedUri, {
			closeOnOpen: true,
			detectNested: false,
		});

		if (repo == null) {
			return;
		}

		const remoteUrls: string[] = [];
		for (const remote of await repo.getRemotes()) {
			const remoteUrl = remote.provider?.url({ type: RemoteResourceType.Repo });
			if (remoteUrl != null) {
				remoteUrls.push(remoteUrl);
			}
		}

		for (const remoteUrl of remoteUrls) {
			await this.container.path.writeLocalRepoPath({ remoteUrl: remoteUrl }, repoLocatedUri.path);
		}

		if (workspaceId != null) {
			let workspaceRepo = this.getCloudWorkspace(workspaceId)?.getRepository(repo.name);
			if (workspaceRepo == null) {
				workspaceRepo = this.getCloudWorkspace(workspaceId)?.getRepository(repoName);
			}
			if (workspaceRepo != null) {
				await this.container.path.writeLocalRepoPath(
					{
						remoteUrl: workspaceRepo.url,
						repoInfo: {
							provider: workspaceRepo.provider,
							owner: workspaceRepo.provider_organization_id,
							repoName: workspaceRepo.name,
						},
					},
					repoLocatedUri.path,
				);
				await this.updateCloudWorkspaceRepoLocalPath(workspaceId, workspaceRepo.id, repoLocatedUri.path);
			}
		}
	}

	async createCloudWorkspace(): Promise<void> {
		const input = window.createInputBox();
		input.title = 'Create Cloud Workspace';
		const quickpick = window.createQuickPick();
		quickpick.title = 'Create Cloud Workspace';
		const quickpickLabelToProviderType: { [label: string]: CloudWorkspaceProviderInputType } = {
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
		let workspaceDescription = '';
		let workspaceProvider: CloudWorkspaceProviderInputType | undefined;
		let hostUrl: string | undefined;
		let azureOrganizationName: string | undefined;
		let azureProjectName: string | undefined;
		const matchingProviderRepos: Repository[] = [];
		let includeReposResponse;
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

			workspaceDescription = await new Promise<string>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve('')),
					input.onDidAccept(() => {
						const value = input.value.trim();
						resolve(value || '');
					}),
				);

				input.value = '';
				input.title = 'Create Workspace';
				input.placeholder = 'Please enter a description for the new workspace';
				input.prompt = 'Enter your workspace description';
				input.show();
			});

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

			if (workspaceProvider != null) {
				for (const repo of this.container.git.openRepositories) {
					const matchingRemotes = await repo.getRemotes({
						filter: r =>
							r.provider?.id === cloudWorkspaceProviderInputTypeToRemoteProviderId[workspaceProvider!],
					});
					if (matchingRemotes.length) {
						matchingProviderRepos.push(repo);
					}
				}

				if (matchingProviderRepos.length) {
					includeReposResponse = await window.showInformationMessage(
						'Would you like to include your open repositories in the workspace?',
						{ modal: true },
						{ title: 'Yes' },
						{ title: 'No', isCloseAffordance: true },
					);
				}
			}
		} finally {
			input.dispose();
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}

		const options = {
			name: workspaceName,
			description: workspaceDescription,
			provider: workspaceProvider,
			hostUrl: hostUrl,
			azureOrganizationName: azureOrganizationName,
			azureProjectName: azureProjectName,
		};

		let createdProjectData: CloudWorkspaceData | null | undefined;
		try {
			const response = await this._workspacesApi.createWorkspace(options);
			createdProjectData = response?.data?.create_project;
		} catch {
			return;
		}

		if (createdProjectData != null) {
			// Add the new workspace to cloud workspaces
			if (this._cloudWorkspaces == null) {
				this._cloudWorkspaces = [];
			}

			this._cloudWorkspaces?.push(
				new GKCloudWorkspace(
					createdProjectData.id,
					createdProjectData.name,
					createdProjectData.organization?.id,
					createdProjectData.provider as CloudWorkspaceProviderType,
					this._getCloudWorkspaceRepos,
					[],
				),
			);

			const newWorkspace = this.getCloudWorkspace(createdProjectData.id);
			if (newWorkspace != null && includeReposResponse?.title === 'Yes') {
				const repoInputs: AddWorkspaceRepoDescriptor[] = [];
				for (const repo of matchingProviderRepos) {
					const remote = (await repo.getRemote('origin')) || (await repo.getRemotes())?.[0];
					const remoteOwnerAndName = remote?.provider?.path?.split('/') || remote?.path?.split('/');
					if (remoteOwnerAndName == null || remoteOwnerAndName.length !== 2) continue;
					repoInputs.push({ owner: remoteOwnerAndName[0], repoName: remoteOwnerAndName[1] });
				}

				if (repoInputs.length) {
					let newRepoDescriptors: CloudWorkspaceRepositoryDescriptor[] = [];
					try {
						const response = await this._workspacesApi.addReposToWorkspace(newWorkspace.id, repoInputs);
						if (response?.data.add_repositories_to_project == null) return;
						newRepoDescriptors = Object.values(
							response.data.add_repositories_to_project.provider_data,
						) as CloudWorkspaceRepositoryDescriptor[];
					} catch {
						return;
					}

					if (newRepoDescriptors.length === 0) return;
					newWorkspace.addRepositories(newRepoDescriptors);
					for (const repo of matchingProviderRepos) {
						if (!repo.uri.fsPath) continue;
						const remoteUrls: string[] = [];
						for (const remote of await repo.getRemotes()) {
							const remoteUrl = remote.provider?.url({ type: RemoteResourceType.Repo });
							if (remoteUrl != null) {
								remoteUrls.push(remoteUrl);
							}
						}

						for (const remoteUrl of remoteUrls) {
							await this.container.path.writeLocalRepoPath({ remoteUrl: remoteUrl }, repo.uri.fsPath);
						}

						const repoDescriptor = newWorkspace.getRepository(repo.name);
						if (repoDescriptor == null) continue;

						await this._workspacesPathProvider.writeCloudWorkspaceDiskPathToMap(
							newWorkspace.id,
							repoDescriptor.id,
							repo.uri.fsPath,
						);
					}
				}
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
		} catch {}
	}

	async addCloudWorkspaceRepo(workspaceId: string) {
		const workspace = this.getCloudWorkspace(workspaceId);
		if (workspace == null) return;

		const matchingProviderRepos = [];
		for (const repo of this.container.git.openRepositories) {
			const matchingRemotes = await repo.getRemotes({
				filter: r => r.provider?.id === cloudWorkspaceProviderTypeToRemoteProviderId[workspace.provider],
			});
			if (matchingRemotes.length) {
				matchingProviderRepos.push(repo);
			}
		}

		if (!matchingProviderRepos.length) {
			void window.showInformationMessage(`No open repositories found for provider ${workspace.provider}`);
			return;
		}

		const pick = await showRepositoryPicker(
			'Add Repository to Workspace',
			'Choose which repository to add to the workspace',
			matchingProviderRepos,
		);
		if (pick?.item == null) return;

		const repoPath = pick.repoPath;
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return;

		const remote = (await repo.getRemote('origin')) || (await repo.getRemotes())?.[0];
		const remoteOwnerAndName = remote?.provider?.path?.split('/') || remote?.path?.split('/');
		if (remoteOwnerAndName == null || remoteOwnerAndName.length !== 2) return;

		let newRepoDescriptors: CloudWorkspaceRepositoryDescriptor[] = [];
		try {
			const response = await this._workspacesApi.addReposToWorkspace(workspaceId, [
				{ owner: remoteOwnerAndName[0], repoName: remoteOwnerAndName[1] },
			]);

			if (response?.data.add_repositories_to_project == null) return;
			newRepoDescriptors = Object.values(
				response.data.add_repositories_to_project.provider_data,
			) as CloudWorkspaceRepositoryDescriptor[];
		} catch {
			return;
		}

		if (newRepoDescriptors.length === 0) return;

		workspace.addRepositories(newRepoDescriptors);
		if (repo.uri.fsPath) {
			const remoteUrls: string[] = [];
			for (const remote of await repo.getRemotes()) {
				const remoteUrl = remote.provider?.url({ type: RemoteResourceType.Repo });
				if (remoteUrl != null) {
					remoteUrls.push(remoteUrl);
				}
			}

			for (const remoteUrl of remoteUrls) {
				await this.container.path.writeLocalRepoPath({ remoteUrl: remoteUrl }, repo.uri.fsPath);
			}

			await this._workspacesPathProvider.writeCloudWorkspaceDiskPathToMap(
				workspaceId,
				newRepoDescriptors[0].id,
				repo.uri.fsPath,
			);
		}
	}

	async removeCloudWorkspaceRepo(workspaceId: string, repoName: string) {
		const workspace = this.getCloudWorkspace(workspaceId);
		if (workspace == null) return;

		const repo = workspace.getRepository(repoName);
		if (repo == null) return;

		const confirmation = await window.showWarningMessage(
			`Are you sure you want to remove ${repoName} from this workspace? This cannot be undone.`,
			{ modal: true },
			{ title: 'Confirm' },
			{ title: 'Cancel', isCloseAffordance: true },
		);
		if (confirmation == null || confirmation.title == 'Cancel') return;
		try {
			const response = await this._workspacesApi.removeReposFromWorkspace(workspaceId, [
				{ owner: repo.provider_organization_id, repoName: repo.name },
			]);

			if (response?.data.remove_repositories_from_project == null) return;

			workspace.removeRepositories([repoName]);
		} catch {}
	}

	async resolveWorkspaceRepositoriesByName(
		workspaceId: string,
		workspaceType: WorkspaceType,
	): Promise<WorkspaceRepositoriesByName> {
		const workspaceRepositoriesByName: WorkspaceRepositoriesByName = new Map<string, Repository>();
		const workspace: GKCloudWorkspace | GKLocalWorkspace | undefined =
			workspaceType === WorkspaceType.Cloud
				? this.getCloudWorkspace(workspaceId)
				: this.getLocalWorkspace(workspaceId);

		if (workspace?.repositories == null) return workspaceRepositoriesByName;
		for (const repository of workspace.repositories) {
			const currentRepositories = this.container.git.repositories;
			let repo: Repository | undefined = undefined;
			let repoId: string | undefined = undefined;
			let repoLocalPath: string | undefined = undefined;
			let repoRemoteUrl: string | undefined = undefined;
			let repoName: string | undefined = undefined;
			let repoProvider: string | undefined = undefined;
			let repoOwner: string | undefined = undefined;
			if (workspaceType === WorkspaceType.Local) {
				repoLocalPath = (repository as LocalWorkspaceRepositoryDescriptor).localPath;
				// repo name in this case is the last part of the path after splitting from the path separator
				repoName = (repository as LocalWorkspaceRepositoryDescriptor).name;
				for (const currentRepository of currentRepositories) {
					if (currentRepository.path.replaceAll('\\', '/') === repoLocalPath.replaceAll('\\', '/')) {
						repo = currentRepository;
					}
				}
			} else if (workspaceType === WorkspaceType.Cloud) {
				repoId = (repository as CloudWorkspaceRepositoryDescriptor).id;
				repoLocalPath = await this.getCloudWorkspaceRepoPath(workspaceId, repoId);
				repoRemoteUrl = (repository as CloudWorkspaceRepositoryDescriptor).url;
				repoName = (repository as CloudWorkspaceRepositoryDescriptor).name;
				repoProvider = (repository as CloudWorkspaceRepositoryDescriptor).provider;
				repoOwner = (repository as CloudWorkspaceRepositoryDescriptor).provider_organization_id;

				if (repoLocalPath == null) {
					const repoLocalPaths = await this.container.path.getLocalRepoPaths({
						remoteUrl: repoRemoteUrl,
						repoInfo: {
							repoName: repoName,
							provider: repoProvider,
							owner: repoOwner,
						},
					});

					// TODO@ramint: The user should be able to choose which path to use if multiple available
					if (repoLocalPaths.length > 0) {
						repoLocalPath = repoLocalPaths[0];
					}
				}

				for (const currentRepository of currentRepositories) {
					if (
						repoLocalPath != null &&
						currentRepository.path.replaceAll('\\', '/') === repoLocalPath.replaceAll('\\', '/')
					) {
						repo = currentRepository;
					}
				}
			}

			if (!repo) {
				let uri: Uri | undefined = undefined;
				if (repoLocalPath) {
					uri = Uri.file(repoLocalPath);
				} else if (repoRemoteUrl) {
					uri = Uri.parse(repoRemoteUrl);
					uri = uri.with({
						scheme: Schemes.Virtual,
						authority: encodeAuthority<GitHubAuthorityMetadata>('github'),
						path: uri.path,
					});
				}
				if (uri) {
					repo = await this.container.git.getOrOpenRepository(uri, { closeOnOpen: true });
				}
			}

			if (!repoName || !repo) {
				continue;
			}

			workspaceRepositoriesByName.set(repoName, repo);
		}

		return workspaceRepositoriesByName;
	}

	async saveAsCodeWorkspaceFile(
		workspaceId: string,
		workspaceType: WorkspaceType,
		options?: { open?: boolean },
	): Promise<void> {
		const workspace: GKCloudWorkspace | GKLocalWorkspace | undefined =
			workspaceType === WorkspaceType.Cloud
				? this.getCloudWorkspace(workspaceId)
				: this.getLocalWorkspace(workspaceId);

		if (workspace?.repositories == null) return;

		const workspaceRepositoriesByName = await this.resolveWorkspaceRepositoriesByName(workspaceId, workspaceType);

		if (workspaceRepositoriesByName.size === 0) {
			void window.showErrorMessage('No repositories could be found in this workspace.', { modal: true });
			return;
		}

		const workspaceFolderPaths: string[] = [];
		for (const repo of workspaceRepositoriesByName.values()) {
			if (!repo.virtual && repo.path != null) {
				workspaceFolderPaths.push(repo.path);
			}
		}

		if (workspaceFolderPaths.length < workspace.repositories.length) {
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

		const created = await this._workspacesPathProvider.writeCodeWorkspaceFile(
			newWorkspaceUri,
			workspaceFolderPaths,
		);

		if (!created) {
			void window.showErrorMessage('Could not create the new workspace file. Check logs for details');
			return;
		}

		if (options?.open) {
			openWorkspace(newWorkspaceUri, { location: OpenWorkspaceLocation.NewWindow });
		}
	}
}

function encodeAuthority<T>(scheme: string, metadata?: T): string {
	return `${scheme}${metadata != null ? `+${encodeUtf8Hex(JSON.stringify(metadata))}` : ''}`;
}
