import type { AuthenticationSession, CancellationToken, EventEmitter } from 'vscode';
import { window } from 'vscode';
import { GitSelfManagedHostIntegrationId } from '../../../constants.integrations';
import type { Container } from '../../../container';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { getSettledValue } from '../../../system/promise';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService';
import type { IntegrationConnectionChangeEvent } from '../integrationService';
import { GitHostIntegration } from '../models/gitHostIntegration';
import type { IntegrationKey } from '../models/integration';
import type {
	AzureOrganizationDescriptor,
	AzureProjectDescriptor,
	AzureRemoteRepositoryDescriptor,
	AzureRepositoryDescriptor,
} from './azure/models';
import { convertTokentoPAT } from './azureDevOps';
import type { ProviderPullRequest } from './models';
import { fromProviderPullRequest, providersMetadata } from './models';
import type { ProvidersApi } from './providersApi';

const serverMetadata = providersMetadata[GitSelfManagedHostIntegrationId.AzureDevOpsServer];
const serverAuthProvider = Object.freeze({ id: serverMetadata.id, scopes: serverMetadata.scopes });

export class AzureDevOpsServerIntegration extends GitHostIntegration<
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	AzureRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = serverAuthProvider;
	readonly id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	protected readonly key: IntegrationKey<GitSelfManagedHostIntegrationId.AzureDevOpsServer>;
	readonly name: string = 'Azure DevOps Server';

	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: EventEmitter<IntegrationConnectionChangeEvent>,
		readonly domain: string,
	) {
		super(container, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}`;
	}

	protected get apiBaseUrl(): string {
		const protocol = this._session?.protocol ?? 'https:';
		return `${protocol}//${this.domain}`;
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount({
		accessToken,
	}: AuthenticationSession): Promise<Account | undefined> {
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const azure = await this.container.azure;
			const user = azure ? await azure.getCurrentUser(this, accessToken, this.apiBaseUrl) : undefined;
			this._accounts.set(
				accessToken,
				user
					? {
							provider: this,
							id: user.id,
							name: user.name ?? undefined,
							email: user.email ?? undefined,
							avatarUrl: user.avatarUrl ?? undefined,
							username: user.username ?? undefined,
						}
					: undefined,
			);
		}

		return this._accounts.get(accessToken);
	}

	protected override async mergeProviderPullRequest(
		{ accessToken: _accessToken }: AuthenticationSession,
		_pr: PullRequest,
		_options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		if (_pr.refs == null || _pr.project == null) return false;

		try {
			const merged = await api.mergePullRequest(this.id, _pr, {
				..._options,
				accessToken: convertTokentoPAT(_accessToken),
				isPAT: true,
				baseUrl: this.apiBaseUrl,
			});
			return merged;
		} catch (ex) {
			void window.showErrorMessage(
				`${ex.message}. Check branch policies, and ensure you have the necessary permissions to merge the pull request.`,
			);
			return false;
		}
	}

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<UnidentifiedAuthor | undefined> {
		return (await this.container.azure)?.getAccountForCommit(
			this,
			accessToken,
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
			options,
		);
	}

	protected override async getProviderAccountForEmail(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_email: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	private _organizations: Map<string, AzureOrganizationDescriptor[] | undefined> | undefined;
	private async getProviderResourcesForUser(
		session: AuthenticationSession,
		force: boolean = false,
	): Promise<AzureOrganizationDescriptor[] | undefined> {
		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		const { accessToken } = session;

		const cachedResources = this._organizations.get(accessToken);
		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const account = await this.getProviderCurrentAccount(session);
			if (account?.id == null) return undefined;

			// Now we can use the updated providers API that calls getCollectionsForUser for Azure DevOps Server
			const resources = await api.getAzureResourcesForUser(account.id, this.id, {
				accessToken: convertTokentoPAT(accessToken),
				baseUrl: this.apiBaseUrl,
				isPAT: true,
			});
			this._organizations.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._organizations.get(accessToken);
	}

	private _projects: Map<string, AzureProjectDescriptor[] | undefined> | undefined;
	private async getProviderProjectsForResources(
		{ accessToken }: AuthenticationSession,
		resources: AzureOrganizationDescriptor[],
		force: boolean = false,
	): Promise<AzureProjectDescriptor[] | undefined> {
		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();

		let resourcesWithoutProjects = [];
		if (force) {
			resourcesWithoutProjects = resources;
		} else {
			for (const resource of resources) {
				const resourceKey = `${accessToken}:${resource.id}`;
				const cachedProjects = this._projects.get(resourceKey);
				if (cachedProjects == null) {
					resourcesWithoutProjects.push(resource);
				}
			}
		}

		if (resourcesWithoutProjects.length > 0) {
			const api = await this.getProvidersApi();
			const azureProjects = (
				await Promise.allSettled(
					resourcesWithoutProjects.map(resource =>
						api.getAzureProjectsForResource(resource.name, this.id, {
							accessToken: convertTokentoPAT(accessToken),
							isPAT: true,
							baseUrl: this.apiBaseUrl,
						}),
					),
				)
			)
				.map(r => getSettledValue(r)?.values)
				.flat()
				.filter(p => p != null);

			for (const resource of resourcesWithoutProjects) {
				const projects = azureProjects?.filter(p => p.namespace === resource.name);
				if (projects != null) {
					this._projects.set(
						`${accessToken}:${resource.id}`,
						projects.map(p => ({
							id: p.id,
							name: p.name,
							resourceId: resource.id,
							resourceName: resource.name,
							key: p.id,
						})),
					);
				}
			}
		}

		return resources.reduce<AzureProjectDescriptor[]>((projects, resource) => {
			const resourceKey = `${accessToken}:${resource.id}`;
			const resourceProjects = this._projects!.get(resourceKey);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, []);
	}

	private async getRepoDescriptorsForProjects(
		session: AuthenticationSession,
		projects: AzureProjectDescriptor[],
	): Promise<Map<string, AzureRemoteRepositoryDescriptor[] | undefined>> {
		const descriptors = new Map<string, AzureRemoteRepositoryDescriptor[] | undefined>();
		if (projects.length === 0) return descriptors;

		const api = await this.getProvidersApi();
		const { accessToken } = session;
		await Promise.all(
			projects.map(async project => {
				const repos = (
					await api.getReposForAzureProject(project.resourceName, project.name, this.id, {
						accessToken: convertTokentoPAT(accessToken),
						isPAT: true,
						baseUrl: this.apiBaseUrl,
					})
				)?.values;
				if (repos != null && repos.length > 0) {
					descriptors.set(
						project.id,
						repos.map(r => ({
							id: r.id,
							nodeId: r.graphQLId ?? undefined,
							resourceName: project.resourceName,
							name: r.name,
							projectName: project.name,
							url: r.webUrl ?? undefined,
							cloneUrlHttps: r.httpsUrl ?? undefined,
							cloneUrlSsh: r.sshUrl ?? undefined,
							key: r.id,
						})),
					);
				}
			}),
		);

		return descriptors;
	}

	private fromAzureProviderPullRequest(
		azurePullRequest: ProviderPullRequest,
		repoDescriptors: AzureRemoteRepositoryDescriptor[],
		projectDescriptors: AzureProjectDescriptor[],
	): PullRequest {
		const baseRepoDescriptor = repoDescriptors.find(r => r.name === azurePullRequest.repository.name);
		const headRepoDescriptor =
			azurePullRequest.headRepository != null
				? repoDescriptors.find(r => r.name === azurePullRequest.headRepository!.name)
				: undefined;
		let project: AzureProjectDescriptor | undefined;
		if (baseRepoDescriptor != null) {
			azurePullRequest.repository.remoteInfo = {
				...azurePullRequest.repository.remoteInfo,
				cloneUrlHTTPS: baseRepoDescriptor.cloneUrlHttps ?? '',
				cloneUrlSSH: baseRepoDescriptor.cloneUrlSsh ?? '',
			};
		}

		if (headRepoDescriptor != null) {
			azurePullRequest.headRepository = {
				...azurePullRequest.headRepository,
				id: azurePullRequest.headRepository?.id ?? headRepoDescriptor.id,
				name: azurePullRequest.headRepository?.name ?? headRepoDescriptor.name,
				owner: {
					login: azurePullRequest.headRepository?.owner.login ?? headRepoDescriptor.resourceName,
				},
				remoteInfo: {
					...azurePullRequest.headRepository?.remoteInfo,
					cloneUrlHTTPS: headRepoDescriptor.cloneUrlHttps ?? '',
					cloneUrlSSH: headRepoDescriptor.cloneUrlSsh ?? '',
				},
			};
		}

		if (baseRepoDescriptor?.projectName != null) {
			project = projectDescriptors.find(p => p.name === baseRepoDescriptor.projectName);
		}
		return fromProviderPullRequest(azurePullRequest, this, { project: project });
	}

	protected override async getProviderDefaultBranch(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		id: string,
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.azure)?.getIssueOrPullRequest(this, accessToken, repo.owner, repo.name, id, {
			baseUrl: this.apiBaseUrl,
			type: type,
		});
	}

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_project: any,
		_id: string,
	): Promise<any> {
		// TODO: Implement Azure DevOps Server issue retrieval
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForBranch(this, accessToken, repo.owner, repo.name, branch, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForCommit(
			this,
			accessToken,
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyPullRequests(
		session: AuthenticationSession,
		repos?: AzureRepositoryDescriptor[],
	): Promise<PullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		if (repos != null) {
			// TODO: implement repos version
			return undefined;
		}

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		const projects = await this.getProviderProjectsForResources(session, orgs);
		if (projects == null || projects.length === 0) return undefined;

		const repoDescriptors = Array.from(
			((await this.getRepoDescriptorsForProjects(session, projects)) ?? new Map()).values(),
		)
			.filter(r => r != null)
			.flat();

		const projectInputs = projects.map(p => ({ namespace: p.resourceName, project: p.name }));
		const assignedPrs = (
			await api.getPullRequestsForAzureProjects(projectInputs, this.id, {
				accessToken: convertTokentoPAT(session.accessToken),
				isPAT: true,
				assigneeLogins: [user.username],
				baseUrl: this.apiBaseUrl,
			})
		)?.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
		const authoredPrs = (
			await api.getPullRequestsForAzureProjects(projectInputs, this.id, {
				accessToken: convertTokentoPAT(session.accessToken),
				isPAT: true,
				authorLogin: user.username,
				baseUrl: this.apiBaseUrl,
			})
		)?.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
		const prsById = new Map<string, PullRequest>();
		for (const pr of authoredPrs ?? []) {
			// Only include open pull requests
			if (pr.state === 'opened') {
				prsById.set(pr.id, pr);
			}
		}

		for (const pr of assignedPrs ?? []) {
			// Only include open pull requests
			if (pr.state === 'opened') {
				const existing = prsById.get(pr.id);
				if (existing == null) {
					prsById.set(pr.id, pr);
				}
			}
		}

		return Array.from(prsById.values());
	}

	protected override providerOnDisconnect(): void {
		this._organizations = undefined;
		this._projects = undefined;
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		// TODO: Implement Azure DevOps Server issue search
		return Promise.resolve(undefined);
	}
}
