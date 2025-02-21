import type { AuthenticationSession, CancellationToken } from 'vscode';
import { md5 } from '@env/crypto';
import { HostingIntegrationId } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { ProviderAuthenticationSession } from '../authentication/models';
import { HostingIntegration } from '../integration';
import type {
	BitbucketRemoteRepositoryDescriptor,
	BitbucketRepositoryDescriptor,
	BitbucketWorkspaceDescriptor,
} from './bitbucket/models';
import type { ProviderPullRequest } from './models';
import { fromProviderPullRequest, providersMetadata } from './models';

const metadata = providersMetadata[HostingIntegrationId.Bitbucket];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

export class BitbucketIntegration extends HostingIntegration<
	HostingIntegrationId.Bitbucket,
	BitbucketRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = HostingIntegrationId.Bitbucket;
	protected readonly key = this.id;
	readonly name: string = 'Bitbucket';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.bitbucket.org/2.0';
	}

	protected override async mergeProviderPullRequest(
		_session: AuthenticationSession,
		_pr: PullRequest,
		_options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		return Promise.resolve(false);
	}

	protected override async getProviderAccountForCommit(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_ref: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderAccountForEmail(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_email: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderDefaultBranch(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		id: string,
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.bitbucket)?.getIssueOrPullRequest(
			this,
			accessToken,
			repo.owner,
			repo.name,
			id,
			this.apiBaseUrl,
			{
				type: type,
			},
		);
	}

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_id: string,
	): Promise<Issue | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.bitbucket)?.getPullRequestForBranch(
			this,
			accessToken,
			repo.owner,
			repo.name,
			branch,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderPullRequestForCommit(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_ref: string,
	): Promise<PullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
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

	private _workspaces: Map<string, BitbucketWorkspaceDescriptor[] | undefined> | undefined;
	private async getProviderResourcesForUser(
		session: AuthenticationSession,
		force: boolean = false,
	): Promise<BitbucketWorkspaceDescriptor[] | undefined> {
		this._workspaces ??= new Map<string, BitbucketWorkspaceDescriptor[] | undefined>();
		const { accessToken } = session;
		const cachedResources = this._workspaces.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const account = await this.getProviderCurrentAccount(session);
			if (account?.id == null) return undefined;

			const resources = await api.getBitbucketResourcesForUser(account.id, { accessToken: accessToken });
			this._workspaces.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._workspaces.get(accessToken);
	}

	private async getProviderProjectsForResources(
		{ accessToken }: AuthenticationSession,
		resources: BitbucketWorkspaceDescriptor[],
		force: boolean = false,
	): Promise<BitbucketRemoteRepositoryDescriptor[] | undefined> {
		const repositories = new Map<string, BitbucketRemoteRepositoryDescriptor[] | undefined>();
		let resourcesWithoutRepositories: BitbucketWorkspaceDescriptor[] = [];
		if (force) {
			resourcesWithoutRepositories = resources;
		} else {
			for (const resource of resources) {
				const resourceKey = `${accessToken}:${resource.id}`;
				const cachedRepositories = repositories.get(resourceKey);
				if (cachedRepositories == null) {
					resourcesWithoutRepositories.push(resource);
				}
			}
		}

		if (resourcesWithoutRepositories.length > 0) {
			const api = await this.container.bitbucket;
			if (api == null) return undefined;
			await Promise.allSettled(
				resourcesWithoutRepositories.map(async resource => {
					const resourceRepos = await api.getRepositoriesForWorkspace(this, accessToken, resource.slug, {
						baseUrl: this.apiBaseUrl,
					});

					if (resourceRepos == null) return undefined;
					repositories.set(
						`${accessToken}:${resource.id}`,
						resourceRepos.map(r => ({
							id: `${r.owner}/${r.name}`,
							resourceId: r.owner,
							owner: r.owner,
							name: r.name,
							key: `${r.owner}/${r.name}`,
						})),
					);
				}),
			);
		}

		return resources.reduce<BitbucketRemoteRepositoryDescriptor[]>((resultRepos, resource) => {
			const resourceRepos = repositories.get(`${accessToken}:${resource.id}`);
			if (resourceRepos != null) {
				resultRepos.push(...resourceRepos);
			}
			return resultRepos;
		}, []);
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: BitbucketRepositoryDescriptor[],
	): Promise<PullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		if (repos != null) {
			// TODO: implement repos version
			return undefined;
		}

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const workspaces = await this.getProviderResourcesForUser(session);
		if (workspaces == null || workspaces.length === 0) return undefined;

		const allBitbucketRepos = await this.getProviderProjectsForResources(session, workspaces);
		if (allBitbucketRepos == null || allBitbucketRepos.length === 0) return undefined;

		const prs = await api.getPullRequestsForRepos(
			HostingIntegrationId.Bitbucket,
			allBitbucketRepos.map(repo => ({ namespace: repo.owner, name: repo.name })),
			{
				accessToken: session.accessToken,
			},
		);
		return prs.values.map(pr => this.fromBitbucketProviderPullRequest(pr));
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: BitbucketRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		return Promise.resolve(undefined);
	}

	private fromBitbucketProviderPullRequest(
		remotePullRequest: ProviderPullRequest,
		//		repoDescriptors: BitbucketRemoteRepositoryDescriptor[],
	): PullRequest {
		remotePullRequest.graphQLId = remotePullRequest.id;
		return fromProviderPullRequest(remotePullRequest, this);
	}

	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const accountStorageKey = md5(this._session.accessToken);

		const storedAccount = this.container.storage.get(`bitbucket:${accountStorageKey}:account`);
		const storedWorkspaces = this.container.storage.get(`bitbucket:${accountStorageKey}:workspaces`);

		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;
		let workspaces = storedWorkspaces?.data?.map(o => ({ ...o }));

		if (storedAccount == null) {
			account = await this.getProviderCurrentAccount(this._session);
			if (account != null) {
				// Clear all other stored workspaces and repositories and accounts when our session changes
				await this.container.storage.deleteWithPrefix('bitbucket');
				await this.container.storage.store(`bitbucket:${accountStorageKey}:account`, {
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

		if (storedWorkspaces == null) {
			workspaces = await this.getProviderResourcesForUser(this._session, true);
			await this.container.storage.store(`bitbucket:${accountStorageKey}:workspaces`, {
				v: 1,
				timestamp: Date.now(),
				data: workspaces,
			});
		}
		this._workspaces ??= new Map<string, BitbucketWorkspaceDescriptor[] | undefined>();
		this._workspaces.set(this._session.accessToken, workspaces);
	}

	protected override providerOnDisconnect(): void {
		this._accounts = undefined;
		this._workspaces = undefined;
	}
}

const bitbucketCloudDomainRegex = /^bitbucket\.org$/i;
export function isBitbucketCloudDomain(domain: string | undefined): boolean {
	return domain != null && bitbucketCloudDomainRegex.test(domain);
}
