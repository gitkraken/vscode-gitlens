import type { AuthenticationSession, CancellationToken, EventEmitter } from 'vscode';
import { window } from 'vscode';
import { base64 } from '@env/base64.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../constants.integrations.js';
import type { Container } from '../../../container.js';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author.js';
import type { DefaultBranch } from '../../../git/models/defaultBranch.js';
import type { Issue, IssueShape } from '../../../git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest.js';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest.js';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata.js';
import { flatSettled } from '../../../system/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationKey } from '../models/integration.js';
import type {
	AzureOrganizationDescriptor,
	AzureProjectDescriptor,
	AzureProjectInputDescriptor,
	AzureRemoteRepositoryDescriptor,
	AzureRepositoryDescriptor,
} from './azure/models.js';
import type { ProviderPullRequest, ProviderRepository } from './models.js';
import { fromProviderIssue, fromProviderPullRequest, providersMetadata } from './models.js';
import type { ProvidersApi } from './providersApi.js';

export abstract class AzureDevOpsIntegrationBase<
	TIntegrationId extends GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	TRepositoryDescriptor extends AzureRepositoryDescriptor = AzureRepositoryDescriptor,
> extends GitHostIntegration<TIntegrationId, TRepositoryDescriptor> {
	protected abstract get apiBaseUrl(): string;
	protected getApiOptions(
		session: ProviderAuthenticationSession,
		doNotConvertToPat: boolean = false,
	): {
		tokenWithInfo: TokenWithInfo<TIntegrationId>;
		options: { isPAT: boolean; baseUrl?: string };
	} {
		const usePat = !doNotConvertToPat;
		const accessToken = usePat ? convertTokentoPAT(session.accessToken) : session.accessToken;
		const tokenWithInfo = toTokenWithInfo<TIntegrationId>(this.id, session, accessToken);
		return {
			tokenWithInfo: tokenWithInfo,
			options: { isPAT: usePat },
		};
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const { accessToken } = session;
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const user = await this._requestForCurrentUser(session);
			this._accounts.set(accessToken, user);
		}

		return this._accounts.get(accessToken);
	}

	protected async _requestForCurrentUser(session: ProviderAuthenticationSession): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo, options } = this.getApiOptions(session, true);
		const user = await api.getCurrentUser(tokenWithInfo, options);
		return user
			? {
					provider: this,
					id: user.id,
					name: user.name ?? undefined,
					email: user.email ?? undefined,
					avatarUrl: user.avatarUrl ?? undefined,
					username: user.username ?? undefined,
				}
			: undefined;
	}

	private _organizations: Map<string, AzureOrganizationDescriptor[] | undefined> | undefined;
	private async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<AzureOrganizationDescriptor[] | undefined> {
		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		const { accessToken } = session;
		const cachedResources = this._organizations.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const account = await this.getProviderCurrentAccount(session);
			if (account?.id == null) return undefined;

			const { tokenWithInfo, options } = this.getApiOptions(session);
			const resources = await api.getAzureResourcesForUser(tokenWithInfo, account.id, options);
			this._organizations.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._organizations.get(accessToken);
	}

	private _projects: Map<string, AzureProjectDescriptor[] | undefined> | undefined;
	private async getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: AzureOrganizationDescriptor[],
		force: boolean = false,
	): Promise<AzureProjectDescriptor[] | undefined> {
		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();
		const { accessToken } = session;

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
			const { tokenWithInfo, options } = this.getApiOptions(session);
			const azureProjects = await flatSettled(
				resourcesWithoutProjects.map(
					async resource =>
						(await api.getAzureProjectsForResource(tokenWithInfo, resource.name, options)).values,
				),
			);

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
			const resourceProjects = this._projects!.get(`${accessToken}:${resource.id}`);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, []);
	}

	private async getRepoDescriptorsForProjects(
		session: ProviderAuthenticationSession,
		projects: AzureProjectDescriptor[],
	): Promise<Map<string, AzureRemoteRepositoryDescriptor[] | undefined>> {
		const descriptors = new Map<string, AzureRemoteRepositoryDescriptor[] | undefined>();
		if (projects.length === 0) return descriptors;

		const api = await this.getProvidersApi();
		const { tokenWithInfo, options } = this.getApiOptions(session);
		await Promise.all(
			projects.map(async project => {
				const repos = (
					await api.getReposForAzureProject(tokenWithInfo, project.resourceName, project.name, options)
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

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		if (pr.refs == null || pr.project == null) return false;

		const { tokenWithInfo, options: apiOptions } = this.getApiOptions(session);

		try {
			const merged = await api.mergePullRequest(tokenWithInfo, pr, {
				...options,
				...apiOptions,
			});
			return merged;
		} catch (ex) {
			void this.showMergeErrorMessage(ex);
			return false;
		}
	}

	protected async showMergeErrorMessage(ex: Error): Promise<void> {
		await window.showErrorMessage(
			`${ex.message}. Check branch policies, and ensure you have the necessary permissions to merge the pull request.`,
		);
	}

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<UnidentifiedAuthor | undefined> {
		return (await this.container.azure)?.getAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
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

	protected override async getProviderDefaultBranch(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		{ id }: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.azure)?.getIssueOrPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			id,
			{
				baseUrl: this.apiBaseUrl,
				type: type,
			},
		);
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		project: AzureProjectInputDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		const projects = await this.getProviderProjectsForResources(session, orgs);
		if (projects == null || projects.length === 0) return undefined;

		const matchingProject = projects.find(p => p.resourceName === project.owner && p.name === project.name);
		if (matchingProject == null) return undefined;

		return (await this.container.azure)?.getIssue(this, toTokenWithInfo(this.id, session), matchingProject, id, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
	}

	public override async getRepoInfo(repo: {
		owner: string;
		name: string;
		project: string;
	}): Promise<ProviderRepository | undefined> {
		const api = await this.getProvidersApi();
		if (this._session == null) return undefined;

		const { tokenWithInfo, options } = this.getApiOptions(this._session);
		return api.getRepo(tokenWithInfo, repo.owner, repo.name, repo.project, options);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
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

		const repoDescriptors = [
			...((await this.getRepoDescriptorsForProjects(session, projects)) ?? new Map()).values(),
		]
			.filter(r => r != null)
			.flat();

		const { tokenWithInfo, options } = this.getApiOptions(session);
		const projectInputs = projects.map(p => ({ namespace: p.resourceName, project: p.name }));
		const assignedPrs = (
			await api.getPullRequestsForAzureProjects(tokenWithInfo, projectInputs, {
				...options,
				assigneeLogins: [user.username],
			})
		)?.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
		const authoredPrs = (
			await api.getPullRequestsForAzureProjects(tokenWithInfo, projectInputs, {
				...options,
				authorLogin: user.username,
			})
		)?.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
		const prsById = new Map<string, PullRequest>();
		for (const pr of authoredPrs ?? []) {
			prsById.set(pr.id, pr);
		}

		for (const pr of assignedPrs ?? []) {
			const existing = prsById.get(pr.id);
			if (existing == null) {
				prsById.set(pr.id, pr);
			}
		}

		return [...prsById.values()];
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		const api = await this.getProvidersApi();

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		const projects = await this.getProviderProjectsForResources(session, orgs);
		if (projects == null || projects.length === 0) return undefined;

		const { tokenWithInfo, options } = this.getApiOptions(session);
		const assignedIssues = await flatSettled(
			projects.map(async p => {
				const issuesResponse = (
					await api.getIssuesForAzureProject(tokenWithInfo, p.resourceName, p.name, {
						...options,
						assigneeLogins: [user.username!],
					})
				).values;
				return issuesResponse.map(i => fromProviderIssue(i, this as any, { project: p }));
			}),
		);
		const authoredIssues = await flatSettled(
			projects.map(async p => {
				const issuesResponse = (
					await api.getIssuesForAzureProject(tokenWithInfo, p.resourceName, p.name, {
						...options,
						authorLogin: user.username!,
					})
				).values;
				return issuesResponse.map(i => fromProviderIssue(i, this as any, { project: p }));
			}),
		);
		// TODO: Add mentioned issues
		const issuesById = new Map<string, IssueShape>();

		for (const issue of authoredIssues ?? []) {
			issuesById.set(issue.id, issue);
		}

		for (const issue of assignedIssues ?? []) {
			const existing = issuesById.get(issue.id);
			if (existing == null) {
				issuesById.set(issue.id, issue);
			}
		}

		return [...issuesById.values()];
	}

	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const storedAccount = this.container.storage.get(`azure:${this._session.accessToken}:account`);
		const storedOrganizations = this.container.storage.get(`azure:${this._session.accessToken}:organizations`);
		const storedProjects = this.container.storage.get(`azure:${this._session.accessToken}:projects`);
		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;
		let organizations = storedOrganizations?.data?.map(o => ({ ...o }));
		let projects = storedProjects?.data?.map(p => ({ ...p }));

		if (storedAccount == null) {
			account = await this.getProviderCurrentAccount(this._session);
			if (account != null) {
				// Clear all other stored organizations and projects and accounts when our session changes
				await this.container.storage.deleteWithPrefix('azure');
				await this.container.storage.store(`azure:${this._session.accessToken}:account`, {
					v: 1,
					timestamp: Date.now(),
					data: {
						id: account.id,
						name: account.name,
						email: account.email,
						avatarUrl: account.avatarUrl,
						username: account.username,
					},
				});
			}
		}

		this._accounts ??= new Map<string, Account | undefined>();
		this._accounts.set(this._session.accessToken, account);

		if (storedOrganizations == null) {
			organizations = await this.getProviderResourcesForUser(this._session, true);
			await this.container.storage.store(`azure:${this._session.accessToken}:organizations`, {
				v: 1,
				timestamp: Date.now(),
				data: organizations,
			});
		}

		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		this._organizations.set(this._session.accessToken, organizations);

		if (storedProjects == null && organizations?.length) {
			projects = await this.getProviderProjectsForResources(this._session, organizations);
			await this.container.storage.store(`azure:${this._session.accessToken}:projects`, {
				v: 1,
				timestamp: Date.now(),
				data: projects,
			});
		}

		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();
		for (const project of projects ?? []) {
			const projectKey = `${this._session.accessToken}:${project.resourceId}`;
			const projects = this._projects.get(projectKey);
			if (projects == null) {
				this._projects.set(projectKey, [project]);
			} else if (!projects.some(p => p.id === project.id)) {
				projects.push(project);
			}
		}
	}

	protected override providerOnDisconnect(): void {
		this._organizations = undefined;
		this._projects = undefined;
		this._accounts = undefined;
	}

	protected fromAzureProviderPullRequest(
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
}

const cloudMetadata = providersMetadata[GitCloudHostIntegrationId.AzureDevOps];
const cloudAuthProvider = Object.freeze({ id: cloudMetadata.id, scopes: cloudMetadata.scopes });

export class AzureDevOpsIntegration extends AzureDevOpsIntegrationBase<GitCloudHostIntegrationId.AzureDevOps> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = cloudAuthProvider;
	readonly id = GitCloudHostIntegrationId.AzureDevOps;
	protected readonly key = this.id;
	readonly name: string = 'Azure DevOps';
	get domain(): string {
		return cloudMetadata.domain;
	}
	protected override get apiBaseUrl(): string {
		return 'https://dev.azure.com';
	}
}

const serverMetadata = providersMetadata[GitSelfManagedHostIntegrationId.AzureDevOpsServer];
const serverAuthProvider = Object.freeze({ id: serverMetadata.id, scopes: serverMetadata.scopes });

export class AzureDevOpsServerIntegration extends AzureDevOpsIntegrationBase<GitSelfManagedHostIntegrationId.AzureDevOpsServer> {
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

	protected override get apiBaseUrl(): string {
		const protocol = this._session?.protocol ?? 'https:';
		return `${protocol}//${this.domain}`;
	}

	protected override getApiOptions(
		session: ProviderAuthenticationSession,
		doNotConvertToPat: boolean = false,
	): {
		tokenWithInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.AzureDevOpsServer>;
		options: { isPAT: boolean; baseUrl?: string };
	} {
		const { options, ...rest } = super.getApiOptions(session, doNotConvertToPat);
		return {
			...rest,
			options: { ...options, baseUrl: this.apiBaseUrl },
		};
	}

	protected override async _requestForCurrentUser(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const azure = await this.container.azure;
		const user = azure
			? await azure.getCurrentUserOnServer(this, toTokenWithInfo(this.id, session), this.apiBaseUrl)
			: undefined;
		return user
			? {
					provider: this,
					id: user.id,
					name: user.name ?? undefined,
					email: user.email ?? undefined,
					avatarUrl: user.avatarUrl ?? undefined,
					username: user.username ?? undefined,
				}
			: undefined;
	}
}

const azureCloudDomainRegex = /^dev\.azure\.com$|\bvisualstudio\.com$/i;
export function isAzureCloudDomain(domain: string | undefined): boolean {
	return domain != null && azureCloudDomainRegex.test(domain);
}

export function convertTokentoPAT(accessToken: string): string {
	return base64(`PAT:${accessToken}`);
}
