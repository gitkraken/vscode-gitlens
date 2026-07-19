import type { Account, CommitAuthor, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { TokenInfo, TokenWithInfo } from '../../authentication/models.js';
import type { IntegrationServiceContext } from '../../context.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ProviderFetchError,
	RequestClientError,
	RequestNotFoundError,
} from '../../errors.js';
import type { ProviderApiConfig } from '../apiConfig.js';
import { baseProviderApiConfig } from '../apiConfig.js';
import type { BitbucketServerCommit, BitbucketServerPullRequest } from '../bitbucket-server/models.js';
import { normalizeBitbucketServerPullRequest } from '../bitbucket-server/models.js';
import { fromProviderPullRequest } from '../models.js';
import type { BitbucketCommit, BitbucketIssue, BitbucketPullRequest, BitbucketRepository } from './models.js';
import {
	bitbucketIssueStateToState,
	fromBitbucketIssue,
	fromBitbucketPullRequest,
	parseRawBitbucketAuthor,
} from './models.js';

export class BitbucketApi implements Disposable {
	private readonly _disposable: Disposable | undefined;

	constructor(private readonly config: ProviderApiConfig) {
		this._disposable = config.onConfigChanged?.(() => this.resetCaches());
	}

	dispose(): void {
		this._disposable?.dispose();
	}

	private resetCaches(): void {}

	@trace({
		args: (provider, token, owner, repo, branch, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			branch: branch,
			baseUrl: baseUrl,
		}),
	})
	public async getPullRequestForBranch(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		branch: string,
		baseUrl: string,
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		const response = await this.request<{
			values: BitbucketPullRequest[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`repositories/${owner}/${repo}/pullrequests?q=source.branch.name="${branch}"&fields=%2Bvalues.reviewers,%2Bvalues.participants`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}
		return fromBitbucketPullRequest(response.values[0], provider);
	}

	@trace({
		args: (provider, token, owner, repo, branch, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			branch: branch,
			baseUrl: baseUrl,
		}),
	})
	public async getServerPullRequestForBranch(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		branch: string,
		baseUrl: string,
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		const response = await this.request<{
			values: BitbucketServerPullRequest[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`projects/${owner}/repos/${repo}/pull-requests?at=refs/heads/${branch}&direction=OUTGOING&state=ALL`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}

		const providersPr = normalizeBitbucketServerPullRequest(response.values[0]);
		const gitlensPr = fromProviderPullRequest(providersPr, provider);
		return gitlensPr;
	}

	@trace({
		args: (provider, token, userUuid, owner, repo, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			userUuid: userUuid,
			owner: owner,
			repo: repo,
			baseUrl: baseUrl,
		}),
	})
	async getUsersIssuesForRepo(
		provider: Provider,
		token: TokenWithInfo,
		userUuid: string,
		owner: string,
		repo: string,
		baseUrl: string,
	): Promise<Issue[] | undefined> {
		const scope = getScopedLogger();
		const query = encodeURIComponent(`assignee.uuid="${userUuid}" OR reporter.uuid="${userUuid}"`);

		const response = await this.request<{
			values: BitbucketIssue[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`repositories/${owner}/${repo}/issues?q=${query}`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}
		return response.values.map(issue => fromBitbucketIssue(issue, provider));
	}

	@trace({
		args: (provider, token, owner, repo, id, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			id: id,
			baseUrl: baseUrl,
		}),
	})
	async getIssue(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		id: string,
		baseUrl: string,
	): Promise<Issue | undefined> {
		const scope = getScopedLogger();

		try {
			const response = await this.request<BitbucketIssue>(
				provider,
				token,
				baseUrl,
				`repositories/${owner}/${repo}/issues/${id}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (response) {
				return fromBitbucketIssue(response, provider);
			}
			return undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo, id, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			id: id,
			baseUrl: baseUrl,
		}),
	})
	public async getIssueOrPullRequest(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		id: string,
		baseUrl: string,
		options?: {
			type?: IssueOrPullRequestType;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getScopedLogger();

		if (options?.type === undefined || options?.type === 'pullrequest') {
			try {
				const prResponse = await this.request<BitbucketPullRequest>(
					provider,
					token,
					baseUrl,
					`repositories/${owner}/${repo}/pullrequests/${id}?fields=%2Bvalues.reviewers,%2Bvalues.participants`,
					{
						method: 'GET',
					},
					scope,
				);

				if (prResponse) {
					return fromBitbucketPullRequest(prResponse, provider);
				}
			} catch (ex) {
				if (ex.original?.status !== 404) {
					scope?.error(ex);
					return undefined;
				}
			}
		}

		if (options?.type === undefined || options?.type === 'issue') {
			try {
				const issueResponse = await this.request<BitbucketIssue>(
					provider,
					token,
					baseUrl,
					`repositories/${owner}/${repo}/issues/${id}`,
					{
						method: 'GET',
					},
					scope,
				);

				if (issueResponse) {
					return {
						id: issueResponse.id.toString(),
						type: 'issue',
						nodeId: issueResponse.id.toString(),
						provider: provider,
						createdDate: new Date(issueResponse.created_on),
						updatedDate: new Date(issueResponse.updated_on),
						state: bitbucketIssueStateToState(issueResponse.state),
						closed: issueResponse.state === 'closed',
						title: issueResponse.title,
						url: issueResponse.links.html.href,
					};
				}
			} catch (ex) {
				scope?.error(ex);
				return undefined;
			}
		}

		return undefined;
	}

	@trace({
		args: (provider, token, owner, repo, id, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			id: id,
			baseUrl: baseUrl,
		}),
	})
	public async getServerPullRequestById(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		id: string,
		baseUrl: string,
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getScopedLogger();

		try {
			const prResponse = await this.request<BitbucketServerPullRequest>(
				provider,
				token,
				baseUrl,
				`projects/${owner}/repos/${repo}/pull-requests/${id}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (prResponse) {
				const providersPr = normalizeBitbucketServerPullRequest(prResponse);
				const gitlensPr = fromProviderPullRequest(providersPr, provider);
				return gitlensPr;
			}
		} catch (ex) {
			if (ex.original?.status !== 404) {
				scope?.error(ex);
				return undefined;
			}
		}

		return undefined;
	}

	@trace({
		args: (provider, token, workspace) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			workspace: workspace,
		}),
	})
	async getRepositoriesForWorkspace(
		provider: Provider,
		token: TokenWithInfo,
		workspace: string,
		options: {
			baseUrl: string;
		},
	): Promise<RepositoryMetadata[] | undefined> {
		const scope = getScopedLogger();

		try {
			interface BitbucketRepositoriesResponse {
				size: number;
				page: number;
				pagelen: number;
				next?: string;
				previous?: string;
				values: BitbucketRepository[];
			}

			const response = await this.request<BitbucketRepositoriesResponse>(
				provider,
				token,
				options.baseUrl,
				`repositories/${workspace}?role=contributor&fields=%2Bvalues.parent.workspace`, // field=+<field> must be encoded as field=%2B<field>
				{
					method: 'GET',
				},
				scope,
			);

			if (response) {
				return response.values.map(repo => {
					return {
						provider: provider,
						owner: repo.workspace.slug,
						name: repo.slug,
						isFork: Boolean(repo.parent),
						parent: repo.parent
							? {
									owner: repo.parent.workspace.slug,
									name: repo.parent.slug,
								}
							: undefined,
					};
				});
			}
			return undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getRepositoryMetadata(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		options: {
			baseUrl: string;
		},
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		const scope = getScopedLogger();

		try {
			const response = await this.getRepository(
				provider,
				token,
				owner,
				repo,
				options.baseUrl,
				scope,
				cancellation,
			);
			if (response == null) return undefined;

			let parent: RepositoryMetadata['parent'];
			if (response.parent != null) {
				// Derive the parent from `full_name` ("owner/repo") rather than `parent.workspace`, which is a
				// requested field expansion Bitbucket doesn't always honor (an unexpanded parent would otherwise
				// throw and null out the whole result).
				// `full_name` is "owner/repo"; only report a parent when both parts are present so a malformed
				// value doesn't produce a parent with an undefined owner/name while `isFork` stays true.
				const [parentOwner, parentName] = response.parent.full_name.split('/');
				if (parentOwner && parentName) {
					parent = { owner: parentOwner, name: parentName };
				}
			}

			return {
				provider: provider,
				owner: response.workspace.slug,
				name: response.slug,
				isFork: response.parent != null,
				parent: parent,
			} satisfies RepositoryMetadata;
		} catch (ex) {
			// Cancellations and 404s are expected outcomes for a probe; don't log them as errors.
			if (!isCancellationError(ex) && !(ex instanceof RequestNotFoundError)) {
				scope?.error(ex);
			}
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getDefaultBranch(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		options: {
			baseUrl: string;
		},
		cancellation?: AbortSignal,
	): Promise<DefaultBranch | undefined> {
		const scope = getScopedLogger();

		try {
			const response = await this.getRepository(
				provider,
				token,
				owner,
				repo,
				options.baseUrl,
				scope,
				cancellation,
			);
			const name = response?.mainbranch?.name;
			if (name == null) return undefined;

			return { provider: provider, name: name } satisfies DefaultBranch;
		} catch (ex) {
			// Cancellations and 404s are expected outcomes for a probe; don't log them as errors.
			if (!isCancellationError(ex) && !(ex instanceof RequestNotFoundError)) {
				scope?.error(ex);
			}
			return undefined;
		}
	}

	private getRepository(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		baseUrl: string,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal,
	): Promise<BitbucketRepository | undefined> {
		return this.request<BitbucketRepository>(
			provider,
			token,
			baseUrl,
			`repositories/${owner}/${repo}`,
			{ method: 'GET' },
			scope,
			cancellation,
		);
	}

	@trace({
		args: (provider, token, owner, repo, rev, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
			baseUrl: baseUrl,
		}),
	})
	async getServerPullRequestForCommit(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		rev: string,
		baseUrl: string,
		_options?: {
			avatarSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		try {
			const response = await this.request<{ values: BitbucketServerPullRequest[] }>(
				provider,
				token,
				baseUrl,
				`projects/${owner}/repos/${repo}/commits/${rev}/pull-requests`, //?fields=${fieldsParam}`,
				{
					method: 'GET',
				},
				scope,
				cancellation,
			);
			const prResponse = response?.values?.reduce<BitbucketServerPullRequest | undefined>(
				(acc, pr) => (!acc || pr.updatedDate > acc.updatedDate ? pr : acc),
				undefined,
			);
			if (!prResponse) return undefined;

			const providersPr = normalizeBitbucketServerPullRequest(prResponse);
			const gitlensPr = fromProviderPullRequest(providersPr, provider);
			return gitlensPr;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo, rev, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
			baseUrl: baseUrl,
		}),
	})
	async getPullRequestForCommit(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		rev: string,
		baseUrl: string,
		_options?: {
			avatarSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		try {
			const fields = [
				'+values.*',
				'+values.destination.repository',
				'+values.destination.branch.*',
				'+values.destination.commit.*',
				'+values.source.repository.*',
				'+values.source.branch.*',
				'+values.source.commit.*',
			];
			const fieldsParam = encodeURIComponent(fields.join(','));
			const response = await this.request<{ values: BitbucketPullRequest[] }>(
				provider,
				token,
				baseUrl,
				`repositories/${owner}/${repo}/commit/${rev}/pullrequests?fields=${fieldsParam}`,
				{
					method: 'GET',
				},
				scope,
				cancellation,
			);
			const pr = response?.values?.reduce<BitbucketPullRequest | undefined>(
				(acc, pr) => (!acc || pr.updated_on > acc.updated_on ? pr : acc),
				undefined,
			);
			if (!pr) return undefined;
			return fromBitbucketPullRequest(pr, provider);
		} catch (ex) {
			if (ex.original instanceof ProviderFetchError) {
				const json = await ex.original.response.json();
				if (json?.error === 'Invalid or unknown installation') {
					// TODO: In future get it on to home as an warning on the integration itself "this integration has issues"
					// even user suppresses the message it's still visible with some capacity. It's a broader thing to get other errors.
					const commitWebUrl = `https://bitbucket.org/${owner}/${repo}/commits/${rev}`;
					this.config.onBitbucketCommitLinksAppMissing?.(commitWebUrl);
					return undefined;
				}
			}

			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo, rev, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
			baseUrl: baseUrl,
		}),
	})
	async getAccountForCommit(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		rev: string,
		baseUrl: string,
		_options?: {
			avatarSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<Account | UnidentifiedAuthor | undefined> {
		const scope = getScopedLogger();

		try {
			const commit = await this.request<BitbucketCommit>(
				provider,
				token,
				baseUrl,
				`repositories/${owner}/${repo}/commit/${rev}`,
				{
					method: 'GET',
				},
				scope,
				cancellation,
			);
			if (!commit) {
				return undefined;
			}

			const { name, email } = parseRawBitbucketAuthor(commit.author.raw);
			const commitAuthor: CommitAuthor = {
				provider: provider,
				id: commit.author.user?.account_id,
				username: commit.author.user?.nickname,
				name: commit.author.user?.display_name || name,
				email: email,
				avatarUrl: commit.author.user?.links?.avatar?.href,
			};
			if (commitAuthor.id != null && commitAuthor.username != null) {
				return {
					...commitAuthor,
					id: commitAuthor.id,
				} satisfies Account;
			}
			return {
				...commitAuthor,
				id: undefined,
				username: undefined,
			} satisfies UnidentifiedAuthor;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@trace({
		args: (provider, token, owner, repo, rev, baseUrl) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
			baseUrl: baseUrl,
		}),
	})
	async getServerAccountForCommit(
		provider: Provider,
		token: TokenWithInfo,
		owner: string,
		repo: string,
		rev: string,
		baseUrl: string,
		_options?: {
			avatarSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<Account | UnidentifiedAuthor | undefined> {
		const scope = getScopedLogger();

		try {
			const commit = await this.request<BitbucketServerCommit>(
				provider,
				token,
				baseUrl,
				`projects/${owner}/repos/${repo}/commits/${rev}`,
				{
					method: 'GET',
				},
				scope,
				cancellation,
			);
			if (!commit?.author) {
				return undefined;
			}
			if (commit.author.id != null) {
				return {
					provider: provider,
					id: commit.author.id.toString(),
					username: commit.author.name,
					name: commit.author.name,
					email: commit.author.emailAddress,
					avatarUrl: commit.author?.avatarUrl,
				} satisfies Account;
			}
			return {
				provider: provider,
				id: undefined,
				username: undefined,
				name: commit.author.name,
				email: commit.author.emailAddress,
				avatarUrl: undefined,
			} satisfies UnidentifiedAuthor;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	private async request<T>(
		provider: Provider,
		token: TokenWithInfo,
		baseUrl: string,
		route: string,
		options?: { method: RequestInit['method'] } & Record<string, unknown>,
		scope?: ScopedLogger | undefined,
		cancellation?: AbortSignal | undefined,
	): Promise<T | undefined> {
		const { accessToken, ...tokenInfo } = token;
		const url = `${baseUrl}/${route}`;

		let rsp: Response;
		try {
			const sw = maybeStopWatch(`[BITBUCKET] ${options?.method ?? 'GET'} ${url}`, { log: { onlyExit: true } });

			try {
				if (cancellation?.aborted) throw new CancellationError();

				rsp = await this.config.wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					this.config.fetch(url, {
						headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
						signal: cancellation,
						...options,
					}),
				);

				if (rsp.ok) {
					return (await rsp.json()) as T;
				}

				throw new ProviderFetchError('Bitbucket', rsp);
			} finally {
				sw?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError || ex.name === 'AbortError') {
				this.handleRequestError(provider, tokenInfo, ex, scope);
			} else if (Logger.isDebugging) {
				this.config.onError?.(`Bitbucket request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(
		provider: Provider | undefined,
		tokenInfo: TokenInfo,
		ex: ProviderFetchError | (Error & { name: 'AbortError' }),
		scope: ScopedLogger | undefined,
	): void {
		if (ex.name === 'AbortError' || !(ex instanceof ProviderFetchError)) throw new CancellationError(ex);

		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new RequestNotFoundError(ex);
			case 401: // Unauthorized
				throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Unauthorized, ex);
			case 403: // Forbidden
				// TODO: Learn the Bitbucket API docs and put it in order:
				// 	if (ex.message.includes('rate limit')) {
				// 		let resetAt: number | undefined;

				// 		const reset = ex.response?.headers?.get('x-ratelimit-reset');
				// 		if (reset != null) {
				// 			resetAt = parseInt(reset, 10);
				// 			if (Number.isNaN(resetAt)) {
				// 				resetAt = undefined;
				// 			}
				// 		}

				// 		throw new RequestRateLimitError(ex, token, resetAt);
				// 	}
				throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				scope?.error(ex);
				if (ex.response != null) {
					provider?.trackRequestException();
					this.config.onRequestFailed?.(
						`${provider?.name ?? 'Bitbucket'} failed to respond and might be experiencing issues.${
							provider == null || provider.id === 'bitbucket'
								? ' Please visit the [Bitbucket status page](https://bitbucket.status.atlassian.com/) for more information.'
								: ''
						}`,
					);
				}
				return;
			case 502: // Bad Gateway
				scope?.error(ex);
				// TODO: Learn the Bitbucket API docs and put it in order:
				// if (ex.message.includes('timeout')) {
				// 	provider?.trackRequestException();
				// 	void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'Bitbucket');
				// 	return;
				// }
				break;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new RequestClientError(ex);
				break;
		}

		scope?.error(ex);
		if (Logger.isDebugging) {
			this.config.onError?.(
				`Bitbucket request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}
}

/** Wires a {@link BitbucketApi} from the full runtime context, mapping `ctx` down to the narrow config. */
export function createBitbucketApi(ctx: IntegrationServiceContext): BitbucketApi {
	const config: ProviderApiConfig = {
		...baseProviderApiConfig(ctx),
		onBitbucketCommitLinksAppMissing: revLink => ctx.hooks?.ui?.onBitbucketCommitLinksAppMissing?.(revLink),
	};

	return new BitbucketApi(config);
}
