import type { RequestInit, Response } from '@env/fetch';
import { fetch, getProxyAgent, wrapForForcedInsecureSSL } from '@env/fetch';
import { isWeb } from '@env/platform';
import type { HttpsProxyAgent } from 'https-proxy-agent';
import type { CancellationToken, Disposable } from 'vscode';
import { Uri, window } from 'vscode';
import type { Container } from '../../../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	CancellationError,
	ProviderFetchError,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '../../../../errors';
import type { Account } from '../../../../git/models/author';
import type { DefaultBranch } from '../../../../git/models/defaultBranch';
import type { IssueOrPullRequest } from '../../../../git/models/issue';
import { PullRequest } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import type { RepositoryMetadata } from '../../../../git/models/repositoryMetadata';
import {
	showIntegrationRequestFailed500WarningMessage,
	showIntegrationRequestTimedOutWarningMessage,
} from '../../../../messages';
import { debug } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import type { LogScope } from '../../../../system/logger.scope';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import { maybeStopWatch } from '../../../../system/stopwatch';
import { equalsIgnoreCase } from '../../../../system/string';
import { configuration } from '../../../../system/vscode/configuration';
import type {
	GitLabCommit,
	GitLabIssue,
	GitLabMergeRequest,
	GitLabMergeRequestREST,
	GitLabMergeRequestState,
	GitLabProjectREST,
	GitLabUser,
} from './models';
import { fromGitLabMergeRequestREST, fromGitLabMergeRequestState } from './models';

// drop it as soon as we switch to @gitkraken/providers-api
const gitlabUserIdPrefix = 'gid://gitlab/User/';
function buildGitLabUserId(id: string | undefined): string | undefined {
	return id?.startsWith(gitlabUserIdPrefix) ? id.substring(gitlabUserIdPrefix.length) : id;
}

export class GitLabApi implements Disposable {
	private readonly _disposable: Disposable;
	private _projectIds = new Map<string, Promise<string | undefined>>();

	constructor(_container: Container) {
		this._disposable = configuration.onDidChangeAny(e => {
			if (
				configuration.changedCore(e, ['http.proxy', 'http.proxyStrictSSL']) ||
				configuration.changed(e, ['proxy', 'remotes'])
			) {
				this.resetCaches();
			}
		});
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private resetCaches(): void {
		this._projectIds.clear();
		this._proxyAgents.clear();
	}

	private _proxyAgents = new Map<string, HttpsProxyAgent | null | undefined>();
	private getProxyAgent(provider: Provider): HttpsProxyAgent | undefined {
		if (isWeb) return undefined;

		let proxyAgent = this._proxyAgents.get(provider.id);
		if (proxyAgent === undefined) {
			const ignoreSSLErrors = provider.getIgnoreSSLErrors();
			proxyAgent = getProxyAgent(ignoreSSLErrors === true || ignoreSSLErrors === 'force' ? false : undefined);
			this._proxyAgents.set(provider.id, proxyAgent ?? null);
		}

		return proxyAgent ?? undefined;
	}

	@debug<GitLabApi['getAccountForCommit']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getAccountForCommit(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
		cancellation?: CancellationToken,
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const projectId = await this.getProjectId(provider, token, owner, repo, options?.baseUrl, cancellation);
		if (!projectId) return undefined;

		try {
			const commit = await this.request<GitLabCommit>(
				provider,
				token,
				options?.baseUrl,
				`v4/projects/${projectId}/repository/commits/${ref}?stats=false`,
				{
					method: 'GET',
					// ...options,
				},
				cancellation,
				scope,
			);

			let user: GitLabUser | undefined;

			const users = await this.findUser(provider, token, commit.author_name, options);
			for (const u of users) {
				if (u.name === commit.author_name || (u.publicEmail && u.publicEmail === commit.author_email)) {
					user = u;
					if (u.state === 'active') break;
				} else if (
					equalsIgnoreCase(u.name, commit.author_name) ||
					(u.publicEmail && equalsIgnoreCase(u.publicEmail, commit.author_email))
				) {
					user = u;
				}
			}

			if (user == null) return undefined;

			// If the avatarUrl is a relative URL, make it absolute using the webUrl (assuming the webUrl is the root URL with the username tacked on)
			if (user.avatarUrl && !/^([a-zA-Z][\w+.-]+):/.test(user.avatarUrl)) {
				user.avatarUrl = Uri.joinPath(Uri.parse(user.webUrl), '..', user.avatarUrl).toString();
			}

			return {
				provider: provider,
				id: String(user.id),
				name: user.name || undefined,
				email: commit.author_email || undefined,
				avatarUrl: user.avatarUrl || undefined,
				username: user.username || undefined,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getAccountForEmail']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getAccountForEmail(
		provider: Provider,
		token: string,
		_owner: string,
		_repo: string,
		email: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		try {
			const [user] = await this.findUser(provider, token, email, options);
			if (user == null) return undefined;

			return {
				provider: provider,
				id: String(user.id),
				name: user.name || undefined,
				email: user.publicEmail || undefined,
				avatarUrl: user.avatarUrl || undefined,
				username: user.username || undefined,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getDefaultBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getDefaultBranch(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		options?: {
			baseUrl?: string;
		},
		cancellation?: CancellationToken,
	): Promise<DefaultBranch | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			data: {
				project:
					| {
							repository: { rootRef: string } | null | undefined;
					  }
					| null
					| undefined;
			};
		}

		try {
			const query = `query getDefaultBranch(
	$fullPath: ID!
) {
	project(fullPath: $fullPath) {
		repository {
			rootRef
		}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				options?.baseUrl,
				query,
				{
					fullPath: `${owner}/${repo}`,
				},
				cancellation,
				scope,
			);

			const defaultBranch = rsp?.data?.project?.repository?.rootRef ?? undefined;
			if (defaultBranch == null) return undefined;

			return {
				provider: provider,
				name: defaultBranch,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getIssueOrPullRequest']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getIssueOrPullRequest(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
		},
		cancellation?: CancellationToken,
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			data: {
				project: {
					mergeRequest: GitLabMergeRequest | null;
					issue: GitLabIssue | null;
				} | null;
			};
		}

		try {
			const query = `query getIssueOrMergeRequest(
	$fullPath: ID!
	$iid: String!
) {
	project(fullPath: $fullPath) {
		mergeRequest(iid: $iid) {
			author {
				id
				name
				avatarUrl
				webUrl
			}
			iid
			title
			description
			state
			createdAt
			updatedAt
			mergedAt
			webUrl
		}
		issue(iid: $iid) {
			author {
				id
				name
				avatarUrl
				webUrl
			}
			iid
			title
			description
			state
			createdAt
			updatedAt
			closedAt
			webUrl
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				options?.baseUrl,
				query,
				{
					fullPath: `${owner}/${repo}`,
					iid: String(number),
				},
				cancellation,
				scope,
			);

			if (rsp?.data?.project?.issue != null) {
				const issue = rsp.data.project.issue;
				return {
					provider: provider,
					type: 'issue',
					id: issue.iid,
					nodeId: undefined,
					createdDate: new Date(issue.createdAt),
					updatedDate: new Date(issue.updatedAt),
					title: issue.title,
					closed: issue.state === 'closed',
					closedDate: issue.closedAt == null ? undefined : new Date(issue.closedAt),
					url: issue.webUrl,
					state: issue.state === 'locked' ? 'closed' : issue.state,
				};
			}

			if (rsp?.data?.project?.mergeRequest != null) {
				const mergeRequest = rsp.data.project.mergeRequest;
				return {
					provider: provider,
					type: 'pullrequest',
					id: mergeRequest.iid,
					nodeId: undefined,
					createdDate: new Date(mergeRequest.createdAt),
					updatedDate: new Date(mergeRequest.updatedAt),
					title: mergeRequest.title,
					closed: mergeRequest.state === 'closed',
					// TODO@eamodio this isn't right, but GitLab doesn't seem to provide a closedAt on merge requests in GraphQL
					closedDate: mergeRequest.state === 'closed' ? new Date(mergeRequest.updatedAt) : undefined,
					url: mergeRequest.webUrl,
					state: mergeRequest.state === 'locked' ? 'closed' : mergeRequest.state,
				};
			}

			return undefined;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getPullRequestForBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getPullRequestForBranch(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			include?: GitLabMergeRequestState[];
		},
		cancellation?: CancellationToken,
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			data: {
				project: {
					mergeRequests?: {
						nodes: GitLabMergeRequest[];
					} | null;
					opened?: {
						nodes: GitLabMergeRequest[];
					} | null;
					closed?: {
						nodes: GitLabMergeRequest[];
					} | null;
					merged?: {
						nodes: GitLabMergeRequest[];
					} | null;
				} | null;
			};
		}

		try {
			const fragment = `
			nodes {
				iid
				author {
					id
					name
					avatarUrl
					webUrl
				}
				title
				description
				state
				createdAt
				updatedAt
				mergedAt
				webUrl
			}`;

			const query = `query getMergeRequestForBranch(
	$fullPath: ID!
	$branches: [String!]
) {
	project(fullPath: $fullPath) {
		${
			options?.include == null
				? `mergeRequests(sourceBranches: $branches sort: UPDATED_DESC first: 1) {
			${fragment}
		}`
				: ''
		}
		${
			options?.include?.includes('opened')
				? `opened: mergeRequests(sourceBranches: $branches state: opened sort: UPDATED_DESC first: 1) {
			${fragment}
		}`
				: ''
		}
		${
			options?.include?.includes('merged')
				? `merged: mergeRequests(sourceBranches: $branches state: merged sort: UPDATED_DESC first: 1) {
			${fragment}
		}`
				: ''
		}
		${
			options?.include?.includes('closed')
				? `closed: mergeRequests(sourceBranches: $branches state: closed sort: UPDATED_DESC first: 1) {
			${fragment}
		}`
				: ''
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				options?.baseUrl,
				query,
				{
					fullPath: `${owner}/${repo}`,
					branches: [branch],
					state: options?.include,
				},
				cancellation,
				scope,
			);

			let pr: GitLabMergeRequest | undefined;

			if (options?.include == null) {
				pr = rsp?.data?.project?.mergeRequests?.nodes?.[0];
			} else {
				for (const state of options.include) {
					let mr;
					if (state === 'opened') {
						mr = rsp?.data?.project?.opened?.nodes?.[0];
					} else if (state === 'merged') {
						mr = rsp?.data?.project?.merged?.nodes?.[0];
					} else if (state === 'closed') {
						mr = rsp?.data?.project?.closed?.nodes?.[0];
					}

					if (mr != null && (pr == null || new Date(mr.updatedAt) > new Date(pr.updatedAt))) {
						pr = mr;
					}
				}
			}

			if (pr == null) return undefined;

			return new PullRequest(
				provider,
				{
					id: buildGitLabUserId(pr.author?.id) ?? '',
					name: pr.author?.name ?? 'Unknown',
					avatarUrl: pr.author?.avatarUrl ?? '',
					url: pr.author?.webUrl ?? '',
				},
				String(pr.iid),
				undefined,
				pr.title,
				pr.webUrl,
				{ owner: owner, repo: repo },
				fromGitLabMergeRequestState(pr.state),
				new Date(pr.createdAt),
				new Date(pr.updatedAt),
				// TODO@eamodio this isn't right, but GitLab doesn't seem to provide a closedAt on merge requests in GraphQL
				pr.state !== 'closed' ? undefined : new Date(pr.updatedAt),
				pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
			);
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getPullRequestForCommit']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getPullRequestForCommit(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
		cancellation?: CancellationToken,
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const projectId = await this.getProjectId(provider, token, owner, repo, options?.baseUrl, cancellation);
		if (!projectId) return undefined;

		try {
			const mrs = await this.request<GitLabMergeRequestREST[]>(
				provider,
				token,
				options?.baseUrl,
				`v4/projects/${projectId}/repository/commits/${ref}/merge_requests`,
				{
					method: 'GET',
					// ...options,
				},
				cancellation,
				scope,
			);
			if (mrs == null || mrs.length === 0) return undefined;

			if (mrs.length > 1) {
				mrs.sort(
					(a, b) =>
						(a.state === 'opened' ? -1 : 1) - (b.state === 'opened' ? -1 : 1) ||
						new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
				);
			}

			return fromGitLabMergeRequestREST(mrs[0], provider, { owner: owner, repo: repo });
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getRepositoryMetadata']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getRepositoryMetadata(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		options?: {
			baseUrl?: string;
		},
		cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		const scope = getLogScope();

		const projectId = await this.getProjectId(provider, token, owner, repo, options?.baseUrl, cancellation);
		if (!projectId) return undefined;

		try {
			const proj = await this.request<GitLabProjectREST>(
				provider,
				token,
				options?.baseUrl,
				`v4/projects/${projectId}`,
				{
					method: 'GET',
					// ...options,
				},
				cancellation,
				scope,
			);
			if (proj == null) return undefined;

			return {
				provider: provider,
				owner: proj.namespace.full_path,
				name: proj.path,
				isFork: proj.forked_from_project != null,
				parent:
					proj.forked_from_project != null
						? {
								owner: proj.forked_from_project.namespace.full_path,
								name: proj.forked_from_project.path,
						  }
						: undefined,
			} satisfies RepositoryMetadata;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	private async findUser(
		provider: Provider,
		token: string,
		search: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
		cancellation?: CancellationToken,
	): Promise<GitLabUser[]> {
		const scope = getLogScope();

		interface QueryResult {
			data: {
				users: {
					nodes: {
						id: string;
						name: string;
						username: string;
						publicEmail?: string;
						state: string;
						avatarUrl: string;
						webUrl: string;
					}[];
				};
			};
		}

		try {
			const query = `query findUser(
$search: String!
) {
	users(search: $search) {
		nodes {
			id
			name
			username,
			publicEmail,
			state
			avatarUrl
			webUrl
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				options?.baseUrl,
				query,
				{
					search: search,
				},
				cancellation,
				scope,
			);

			const matches = rsp?.data?.users?.nodes;
			if (matches == null || matches.length === 0) return [];

			const users: GitLabUser[] = [];

			for (const user of matches) {
				const match = /gid:\/\/gitlab\/User\/([0-9]+)\b/.exec(user.id);
				if (match == null) continue;

				users.push({
					id: parseInt(match[1], 10),
					name: user.name,
					username: user.username,
					publicEmail: user.publicEmail || undefined,
					state: user.state,
					avatarUrl: user.avatarUrl,
					webUrl: user.webUrl,
				});
			}

			return users;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			this.handleException(ex, provider, scope);
			return [];
		}
	}

	getProjectId(
		provider: Provider,
		token: string,
		group: string,
		repo: string,
		baseUrl: string | undefined,
		cancellation: CancellationToken | undefined,
	): Promise<string | undefined> {
		const key = `${token}|${group}/${repo}`;

		let projectId = this._projectIds.get(key);
		if (projectId == null) {
			projectId = this.getProjectIdCore(provider, token, group, repo, baseUrl, cancellation);
			this._projectIds.set(key, projectId);
		}

		return projectId;
	}

	private async getProjectIdCore(
		provider: Provider,
		token: string,
		group: string,
		repo: string,
		baseUrl: string | undefined,
		cancellation: CancellationToken | undefined,
	): Promise<string | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			data: { project: { id: string } };
		}

		try {
			const query = `query getProjectId(
	$fullPath: ID!
) {
	project(fullPath: $fullPath) {
		id
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				baseUrl,
				query,
				{
					fullPath: `${group}/${repo}`,
				},
				cancellation,
				scope,
			);

			const gid = rsp?.data?.project?.id;
			if (gid == null) return undefined;

			const match = /gid:\/\/gitlab\/Project\/([0-9]+)\b/.exec(gid);
			if (match == null) return undefined;

			const projectId = match[1];

			setLogScopeExit(scope, ` \u2022 projectId=${projectId}`);
			return projectId;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			this.handleException(ex, provider, scope);
			return undefined;
		}
	}

	private async graphql<T extends object>(
		provider: Provider,
		token: string,
		baseUrl: string | undefined,
		query: string,
		variables: Record<string, any>,
		cancellation: CancellationToken | undefined,
		scope: LogScope | undefined,
	): Promise<T | undefined> {
		let rsp: Response;
		try {
			const sw = maybeStopWatch(`[GITLAB] POST ${baseUrl}`, { log: false });
			const agent = this.getProxyAgent(provider);

			try {
				let aborter: AbortController | undefined;
				if (cancellation != null) {
					if (cancellation.isCancellationRequested) throw new CancellationError();

					aborter = new AbortController();
					cancellation.onCancellationRequested(() => aborter!.abort());
				}

				rsp = await wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					fetch(`${baseUrl ?? 'https://gitlab.com/api'}/graphql`, {
						method: 'POST',
						headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
						agent: agent,
						signal: aborter?.signal,
						body: JSON.stringify({ query: query, variables: variables }),
					}),
				);

				if (rsp.ok) {
					const data: T | { errors: { message: string }[] } = await rsp.json();

					if ('errors' in data) throw new ProviderFetchError('GitLab', rsp, data.errors);
					return data;
				}

				throw new ProviderFetchError('GitLab', rsp);
			} finally {
				const match = /(^[^({\n]+)/.exec(query);
				const message = ` ${match?.[1].trim() ?? query}`;

				sw?.stop({ message: message });
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError || ex.name === 'AbortError') {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitLab request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private async request<T>(
		provider: Provider,
		token: string,
		baseUrl: string | undefined,
		route: string,
		options: { method: RequestInit['method'] } & Record<string, unknown>,
		cancellation: CancellationToken | undefined,
		scope: LogScope | undefined,
	): Promise<T> {
		const url = `${baseUrl ?? 'https://gitlab.com/api'}/${route}`;

		let rsp: Response;
		try {
			const sw = maybeStopWatch(`[GITLAB] ${options?.method ?? 'GET'} ${url}`, { log: false });
			const agent = this.getProxyAgent(provider);

			try {
				let aborter: AbortController | undefined;
				if (cancellation != null) {
					if (cancellation.isCancellationRequested) throw new CancellationError();

					aborter = new AbortController();
					cancellation.onCancellationRequested(() => aborter!.abort());
				}

				rsp = await wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					fetch(url, {
						headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
						agent: agent,
						signal: aborter?.signal,
						...options,
					}),
				);

				if (rsp.ok) {
					const data: T = await rsp.json();
					return data;
				}

				throw new ProviderFetchError('GitLab', rsp);
			} finally {
				sw?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError || ex.name === 'AbortError') {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitLab request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(
		provider: Provider | undefined,
		token: string,
		ex: ProviderFetchError | (Error & { name: 'AbortError' }),
		scope: LogScope | undefined,
	): void {
		if (ex.name === 'AbortError' || !(ex instanceof ProviderFetchError)) throw new CancellationError(ex);

		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new RequestNotFoundError(ex);
			// case 429: //Too Many Requests
			case 401: // Unauthorized
				throw new AuthenticationError('gitlab', AuthenticationErrorReason.Unauthorized, ex);
			case 403: // Forbidden
				if (ex.message.includes('rate limit exceeded')) {
					let resetAt: number | undefined;

					const reset = ex.response?.headers?.get('x-ratelimit-reset');
					if (reset != null) {
						resetAt = parseInt(reset, 10);
						if (Number.isNaN(resetAt)) {
							resetAt = undefined;
						}
					}

					throw new RequestRateLimitError(ex, token, resetAt);
				}
				throw new AuthenticationError('gitlab', AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				Logger.error(ex, scope);
				if (ex.response != null) {
					provider?.trackRequestException();
					void showIntegrationRequestFailed500WarningMessage(
						`${provider?.name ?? 'GitLab'} failed to respond and might be experiencing issues.${
							provider == null || provider.id === 'gitlab'
								? ' Please visit the [GitLab status page](https://status.gitlab.com) for more information.'
								: ''
						}`,
					);
				}
				return;
			case 502: // Bad Gateway
				Logger.error(ex, scope);
				// GitHub seems to return this status code for timeouts
				if (ex.message.includes('timeout')) {
					provider?.trackRequestException();
					void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'GitLab');
					return;
				}
				break;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new RequestClientError(ex);
				break;
		}

		Logger.error(ex, scope);
		if (Logger.isDebugging) {
			void window.showErrorMessage(
				`GitLab request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}

	private handleException(ex: Error, provider: Provider, scope: LogScope | undefined): Error {
		Logger.error(ex, scope);
		// debugger;

		if (ex instanceof AuthenticationError) {
			void this.showAuthenticationErrorMessage(ex, provider);
		}
		return ex;
	}

	private async showAuthenticationErrorMessage(ex: AuthenticationError, provider: Provider) {
		if (ex.reason === AuthenticationErrorReason.Unauthorized || ex.reason === AuthenticationErrorReason.Forbidden) {
			const confirm = 'Reauthenticate';
			const result = await window.showErrorMessage(
				`${ex.message}. Would you like to try reauthenticating${
					ex.reason === AuthenticationErrorReason.Forbidden ? ' to provide additional access' : ''
				}?`,
				confirm,
			);

			if (result === confirm) {
				await provider.reauthenticate();
				this.resetCaches();
			}
		} else {
			void window.showErrorMessage(ex.message);
		}
	}
}
