import type { AuthenticationSession, CancellationToken } from 'vscode';
import { window } from 'vscode';
import { HostingIntegrationId } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { Issue, SearchedIssue } from '../../../git/models/issue';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	SearchedPullRequest,
} from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { getSettledValue } from '../../../system/promise';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import { HostingIntegration } from '../integration';
import type {
	AzureOrganizationDescriptor,
	AzureProjectDescriptor,
	AzureProjectInputDescriptor,
	AzureRemoteRepositoryDescriptor,
	AzureRepositoryDescriptor,
} from './azure/models';
import type { ProviderPullRequest } from './models';
import { fromProviderIssue, fromProviderPullRequest, providersMetadata } from './models';

const metadata = providersMetadata[HostingIntegrationId.AzureDevOps];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

export class AzureDevOpsIntegration extends HostingIntegration<
	HostingIntegrationId.AzureDevOps,
	AzureRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = HostingIntegrationId.AzureDevOps;
	protected readonly key = this.id;
	readonly name: string = 'Azure DevOps';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://dev.azure.com';
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount({
		accessToken,
	}: AuthenticationSession): Promise<Account | undefined> {
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const api = await this.getProvidersApi();
			const user = await api.getCurrentUser(this.id, { accessToken: accessToken });
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

			const resources = await api.getAzureResourcesForUser(account.id, { accessToken: accessToken });
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
						api.getAzureProjectsForResource(resource.name, { accessToken: accessToken }),
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
			const resourceProjects = this._projects!.get(`${accessToken}:${resource.id}`);
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
					await api.getReposForAzureProject(project.resourceName, project.name, {
						accessToken: accessToken,
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

	protected override async mergeProviderPullRequest(
		{ accessToken }: AuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		if (pr.refs == null || pr.project == null) return false;

		try {
			const merged = await api.mergePullRequest(this.id, pr, {
				...options,
				accessToken: accessToken,
			});
			return merged;
		} catch (ex) {
			void this.showMergeErrorMessage(ex);
			return false;
		}
	}

	private async showMergeErrorMessage(ex: Error) {
		await window.showErrorMessage(
			`${ex.message}. Check branch policies, and ensure you have the necessary permissions to merge the pull request.`,
		);
	}

	protected override async getProviderAccountForCommit(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_ref: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
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

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.azure)?.getIssueOrPullRequest(this, accessToken, repo.owner, repo.name, id, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderIssue(
		session: AuthenticationSession,
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

		return (await this.container.azure)?.getIssue(this, session.accessToken, matchingProject, id, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForBranch(this, accessToken, repo.owner, repo.name, branch, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderPullRequestForCommit(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_ref: string,
	): Promise<PullRequest | undefined> {
		return Promise.resolve(undefined);
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
	): Promise<SearchedPullRequest[] | undefined> {
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
			await api.getPullRequestsForAzureProjects(projectInputs, {
				accessToken: session.accessToken,
				assigneeLogins: [user.username],
			})
		)?.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
		const authoredPrs = (
			await api.getPullRequestsForAzureProjects(projectInputs, {
				accessToken: session.accessToken,
				authorLogin: user.username,
			})
		)?.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
		const prsById = new Map<string, SearchedPullRequest>();
		for (const pr of authoredPrs ?? []) {
			prsById.set(pr.id, { pullRequest: pr, reasons: ['authored'] });
		}

		for (const pr of assignedPrs ?? []) {
			const existing = prsById.get(pr.id);
			if (existing != null) {
				existing.reasons.push('assigned');
			} else {
				prsById.set(pr.id, { pullRequest: pr, reasons: ['assigned'] });
			}
		}

		return Array.from(prsById.values());
	}

	protected override async searchProviderMyIssues(
		session: AuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<SearchedIssue[] | undefined> {
		const api = await this.getProvidersApi();

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		const projects = await this.getProviderProjectsForResources(session, orgs);
		if (projects == null || projects.length === 0) return undefined;

		const assignedIssues = (
			await Promise.all(
				projects.map(async p => {
					const issuesResponse = (
						await api.getIssuesForAzureProject(p.resourceName, p.name, {
							accessToken: session.accessToken,
							assigneeLogins: [user.username!],
						})
					).values;
					return issuesResponse.map(i => fromProviderIssue(i, this, { project: p }));
				}),
			)
		).flat();
		const authoredIssues = (
			await Promise.all(
				projects.map(async p => {
					const issuesResponse = (
						await api.getIssuesForAzureProject(p.resourceName, p.name, {
							accessToken: session.accessToken,
							authorLogin: user.username!,
						})
					).values;
					return issuesResponse.map(i => fromProviderIssue(i, this, { project: p }));
				}),
			)
		).flat();
		// TODO: Add mentioned issues
		const issuesById = new Map<string, SearchedIssue>();

		for (const issue of authoredIssues ?? []) {
			issuesById.set(issue.id, { issue: issue, reasons: ['authored'] });
		}

		for (const issue of assignedIssues ?? []) {
			const existing = issuesById.get(issue.id);
			if (existing != null) {
				existing.reasons.push('assigned');
			} else {
				issuesById.set(issue.id, { issue: issue, reasons: ['assigned'] });
			}
		}

		return Array.from(issuesById.values());
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
}

const azureCloudDomainRegex = /^dev\.azure\.com$|\bvisualstudio\.com$/i;
export function isAzureCloudDomain(domain: string | undefined): boolean {
	return domain != null && azureCloudDomainRegex.test(domain);
}
