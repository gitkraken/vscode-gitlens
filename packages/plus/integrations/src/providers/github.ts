import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { getGitHubNoReplyAddressParts } from '@gitlens/git/remotes/github.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { Emitter } from '@gitlens/utils/event.js';
import { batch } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { GitHubIntegrationIds } from './github/github.utils.js';
import { getGitHubPullRequestIdentityFromMaybeUrl } from './github/github.utils.js';
import type { ProviderHierarchyResult, ProviderOrganization, ProviderRepository } from './models.js';
import { providersMetadata } from './models.js';
import type { ProvidersApi } from './providersApi.js';

const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
const authProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: metadata.id,
	scopes: metadata.scopes,
});

const cloudEnterpriseMetadata = providersMetadata[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise];
const cloudEnterpriseAuthProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: cloudEnterpriseMetadata.id,
	scopes: cloudEnterpriseMetadata.scopes,
});

export type GitHubRepositoryDescriptor = RepositoryDescriptor;

/** How many per-login SSH signing-key lookups to run concurrently, to avoid a request burst that trips rate limiting. */
const sshSigningKeyResolveBatchSize = 10;

abstract class GitHubIntegrationBase<ID extends GitHubIntegrationIds> extends GitHostIntegration<
	ID,
	GitHubRepositoryDescriptor
> {
	protected abstract get apiBaseUrl(): string;

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		return (await this.authenticationService.apis.github)?.getAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderAccountForEmail(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.authenticationService.apis.github)?.getAccountForEmail(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			email,
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderSshSigningKeysForEmails(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		emails: string[],
	): Promise<Map<string, string[]>> {
		const result = new Map<string, string[]>();

		const api = await this.authenticationService.apis.github;
		if (api == null) return result;

		const token = toTokenWithInfo(this.id, session);

		// Resolve each email to a login: GitHub noreply addresses encode it locally; the rest are resolved in a single
		// batched GraphQL request rather than one round-trip per email.
		const loginByEmail = new Map<string, string>();
		const toResolve: string[] = [];
		for (const email of emails) {
			const login = getGitHubNoReplyAddressParts(email)?.login;
			if (login != null) {
				loginByEmail.set(email.toLowerCase(), login);
			} else {
				toResolve.push(email);
			}
		}

		if (toResolve.length) {
			const resolved = await api.getAccountsForEmails(this, token, toResolve, { baseUrl: this.apiBaseUrl });
			for (const [emailLower, login] of resolved) {
				loginByEmail.set(emailLower, login);
			}
		}

		// Fetch signing keys once per distinct login (REST has no batch endpoint), in bounded batches rather than firing
		// all lookups at once, to avoid a request burst that could trip secondary rate limiting. Then map keys to each email.
		const keysByLogin = new Map<string, string[]>();
		await batch([...new Set(loginByEmail.values())], sshSigningKeyResolveBatchSize, async login => {
			const keys = await api.getUserSshSigningKeys(this, token, login, { baseUrl: this.apiBaseUrl });
			keysByLogin.set(
				login,
				keys.map(k => k.key),
			);
		});

		for (const [emailLower, login] of loginByEmail) {
			result.set(emailLower, keysByLogin.get(login) ?? []);
		}

		return result;
	}

	protected override async getProviderDefaultBranch(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return (await this.authenticationService.apis.github)?.getDefaultBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		{ id }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.authenticationService.apis.github)?.getIssueOrPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		return (await this.authenticationService.apis.github)?.getIssue(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
				includeBody: true,
			},
		);
	}

	protected override async getProviderPullRequest(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.github)?.getPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			parseInt(id, 10),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const { include, ...opts } = options ?? {};

		const toGitHubPullRequestState = (await import(/* webpackChunkName: "integrations" */ './github/models.js'))
			.toGitHubPullRequestState;
		return (await this.authenticationService.apis.github)?.getPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			{
				...opts,
				include: include?.map(s => toGitHubPullRequestState(s)),
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.github)?.getPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.authenticationService.apis.github)?.getRepositoryMetadata(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		const api = await this.getProvidersApi();
		const result = await api.getGitHubOrgsForCurrentUser(toTokenWithInfo(this.id, session), {
			baseUrl: this.apiBaseUrl,
		});
		return {
			values: result.values.map(o => ({
				id: o.id,
				name: o.username,
				url: `https://${this.domain}/${o.username}`,
			})),
			...(result.truncated ? { truncated: true } : {}),
		};
	}

	protected override async getProviderRepositoriesForOrg(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		return api.getReposForOrg(toTokenWithInfo(this.id, session), org, {
			baseUrl: this.apiBaseUrl,
			cursor: options?.cursor,
		});
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		silent?: boolean,
		state?: PullRequestStateFilter,
	): Promise<PullRequest[] | undefined> {
		return (await this.authenticationService.apis.github)?.searchMyPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				silent: silent,
				state: state,
			},
			cancellation,
		);
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		return (await this.authenticationService.apis.github)?.searchMyIssues(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				includeBody: true,
			},
			cancellation,
		);
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
	): Promise<PullRequest[] | undefined> {
		return (await this.authenticationService.apis.github)?.searchPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				search: searchQuery,
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
	}

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const id = pr.nodeId;
		const headRefSha = pr.refs?.head?.sha;
		if (id == null || headRefSha == null) return false;
		return (
			(await this.authenticationService.apis.github)?.mergePullRequest(
				this,
				toTokenWithInfo(this.id, session),
				id,
				headRefSha,
				{
					mergeMethod: options?.mergeMethod,
					baseUrl: this.apiBaseUrl,
				},
			) ?? false
		);
	}

	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
		options?: { avatarSize?: number },
	): Promise<Account | undefined> {
		return (await this.authenticationService.apis.github)?.getCurrentAccount(
			this,
			toTokenWithInfo(this.id, session),
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override getProviderPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return getGitHubPullRequestIdentityFromMaybeUrl(search, this.id);
	}
}

export class GitHubIntegration extends GitHubIntegrationBase<GitCloudHostIntegrationId.GitHub> {
	readonly authProvider = authProvider;
	readonly id = GitCloudHostIntegrationId.GitHub;
	protected readonly key = this.id;
	readonly name: string = 'GitHub';
	get domain(): string {
		return metadata.domain;
	}

	protected override get apiBaseUrl(): string {
		return 'https://api.github.com';
	}

	override access(): Promise<boolean> {
		// Always allow GitHub cloud integration access
		return Promise.resolve(true);
	}

	// This is a special case for GitHub because we use VSCode's GitHub session, and it can be disconnected
	// outside of the extension.
	override async refresh(): Promise<void> {
		const authProvider = await this.authenticationService.get(this.authProvider.id);
		const session = await authProvider.getSession(this.authProviderDescriptor);
		if (session == null && this.maybeConnected) {
			void this.disconnect({ silent: true });
		} else {
			if (session?.accessToken !== this._session?.accessToken) {
				this._session = undefined;
			}
			super.refresh();
		}
	}
}

export class GitHubEnterpriseIntegration extends GitHubIntegrationBase<GitSelfManagedHostIntegrationId.CloudGitHubEnterprise> {
	readonly authProvider = cloudEnterpriseAuthProvider;
	readonly id = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
	protected readonly key;
	readonly name = 'GitHub Enterprise';
	get domain(): string {
		return this._domain;
	}

	protected override get apiBaseUrl(): string {
		return `https://${this._domain}/api/v3`;
	}

	constructor(
		ctx: IntegrationServiceContext,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
	) {
		super(ctx, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}` as const;
	}
}
