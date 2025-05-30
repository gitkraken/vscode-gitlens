import type { HttpsProxyAgent } from 'https-proxy-agent';
import type { Disposable } from 'vscode';
import { Uri, window } from 'vscode';
import type { RequestInit, Response } from '@env/fetch';
import { fetch, getProxyAgent, wrapForForcedInsecureSSL } from '@env/fetch';
import { isWeb } from '@env/platform';
import type { CoreConfiguration } from '../../constants';
import type { Container } from '../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ProviderFetchError,
	ProviderRequestClientError,
	ProviderRequestNotFoundError,
	ProviderRequestRateLimitError,
} from '../../errors';
import type { Account } from '../../git/models/author';
import type { DefaultBranch } from '../../git/models/defaultBranch';
import type { IssueOrPullRequest } from '../../git/models/issue';
import { IssueOrPullRequestType } from '../../git/models/issue';
import { PullRequest } from '../../git/models/pullRequest';
import type { RichRemoteProvider } from '../../git/remotes/richRemoteProvider';
import {
	showIntegrationRequestFailed500WarningMessage,
	showIntegrationRequestTimedOutWarningMessage,
} from '../../messages';
import { configuration } from '../../system/configuration';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { LogLevel } from '../../system/logger.constants';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import { Stopwatch } from '../../system/stopwatch';
import { equalsIgnoreCase } from '../../system/string';
import type { GitLabCommit, GitLabIssue, GitLabMergeRequest, GitLabMergeRequestREST, GitLabUser } from './models';
import { fromGitLabMergeRequestREST, fromGitLabMergeRequestState, GitLabMergeRequestState } from './models';

export class GitLabApi implements Disposable {
	private readonly _disposable: Disposable;
	private _projectIds = new Map<string, Promise<string | undefined>>();

	constructor(_container: Container) {
		this._disposable = configuration.onDidChangeAny(e => {
			if (
				configuration.changedAny<CoreConfiguration>(e, ['http.proxy', 'http.proxyStrictSSL']) ||
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
	private getProxyAgent(provider: RichRemoteProvider): HttpsProxyAgent | undefined {
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
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const projectId = await this.getProjectId(provider, token, owner, repo, options?.baseUrl);
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
				name: user.name || undefined,
				email: commit.author_email || undefined,
				avatarUrl: user.avatarUrl || undefined,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getAccountForEmail']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getAccountForEmail(
		provider: RichRemoteProvider,
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
				name: user.name || undefined,
				email: user.publicEmail || undefined,
				avatarUrl: user.avatarUrl || undefined,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getDefaultBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getDefaultBranch(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		options?: {
			baseUrl?: string;
		},
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
				scope,
			);

			const defaultBranch = rsp?.data?.project?.repository?.rootRef ?? undefined;
			if (defaultBranch == null) return undefined;

			return {
				provider: provider,
				name: defaultBranch,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getIssueOrPullRequest']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getIssueOrPullRequest(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
		},
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
				scope,
			);

			if (rsp?.data?.project?.issue != null) {
				const issue = rsp.data.project.issue;
				return {
					provider: provider,
					type: IssueOrPullRequestType.Issue,
					id: issue.iid,
					date: new Date(issue.createdAt),
					title: issue.title,
					closed: issue.state === 'closed',
					closedDate: issue.closedAt == null ? undefined : new Date(issue.closedAt),
					url: issue.webUrl,
				};
			}

			if (rsp?.data?.project?.mergeRequest != null) {
				const mergeRequest = rsp.data.project.mergeRequest;
				return {
					provider: provider,
					type: IssueOrPullRequestType.PullRequest,
					id: mergeRequest.iid,
					date: new Date(mergeRequest.createdAt),
					title: mergeRequest.title,
					closed: mergeRequest.state === 'closed',
					// TODO@eamodio this isn't right, but GitLab doesn't seem to provide a closedAt on merge requests in GraphQL
					closedDate: mergeRequest.state === 'closed' ? new Date(mergeRequest.updatedAt) : undefined,
					url: mergeRequest.webUrl,
				};
			}

			return undefined;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getPullRequestForBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getPullRequestForBranch(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			include?: GitLabMergeRequestState[];
		},
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
			options?.include?.includes(GitLabMergeRequestState.OPEN)
				? `opened: mergeRequests(sourceBranches: $branches state: opened sort: UPDATED_DESC first: 1) {
			${fragment}
		}`
				: ''
		}
		${
			options?.include?.includes(GitLabMergeRequestState.MERGED)
				? `merged: mergeRequests(sourceBranches: $branches state: merged sort: UPDATED_DESC first: 1) {
			${fragment}
		}`
				: ''
		}
		${
			options?.include?.includes(GitLabMergeRequestState.CLOSED)
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
				scope,
			);

			let pr: GitLabMergeRequest | undefined;

			if (options?.include == null) {
				pr = rsp?.data?.project?.mergeRequests?.nodes?.[0];
			} else {
				for (const state of options.include) {
					let mr;
					if (state === GitLabMergeRequestState.OPEN) {
						mr = rsp?.data?.project?.opened?.nodes?.[0];
					} else if (state === GitLabMergeRequestState.MERGED) {
						mr = rsp?.data?.project?.merged?.nodes?.[0];
					} else if (state === GitLabMergeRequestState.CLOSED) {
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
					name: pr.author?.name ?? 'Unknown',
					avatarUrl: pr.author?.avatarUrl ?? '',
					url: pr.author?.webUrl ?? '',
				},
				String(pr.iid),
				pr.title,
				pr.webUrl,
				fromGitLabMergeRequestState(pr.state),
				new Date(pr.updatedAt),
				// TODO@eamodio this isn't right, but GitLab doesn't seem to provide a closedAt on merge requests in GraphQL
				pr.state !== GitLabMergeRequestState.CLOSED ? undefined : new Date(pr.updatedAt),
				pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
			);
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitLabApi['getPullRequestForCommit']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getPullRequestForCommit(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const projectId = await this.getProjectId(provider, token, owner, repo, options?.baseUrl);
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
				scope,
			);
			if (mrs == null || mrs.length === 0) return undefined;

			if (mrs.length > 1) {
				mrs.sort(
					(a, b) =>
						(a.state === GitLabMergeRequestState.OPEN ? -1 : 1) -
							(b.state === GitLabMergeRequestState.OPEN ? -1 : 1) ||
						new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
				);
			}

			return fromGitLabMergeRequestREST(mrs[0], provider);
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	private async findUser(
		provider: RichRemoteProvider,
		token: string,
		search: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
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
			if (ex instanceof ProviderRequestNotFoundError) return [];

			this.handleException(ex, provider, scope);
			return [];
		}
	}

	private getProjectId(
		provider: RichRemoteProvider,
		token: string,
		group: string,
		repo: string,
		baseUrl?: string,
	): Promise<string | undefined> {
		const key = `${token}|${group}/${repo}`;

		let projectId = this._projectIds.get(key);
		if (projectId == null) {
			projectId = this.getProjectIdCore(provider, token, group, repo, baseUrl);
			this._projectIds.set(key, projectId);
		}

		return projectId;
	}

	private async getProjectIdCore(
		provider: RichRemoteProvider,
		token: string,
		group: string,
		repo: string,
		baseUrl?: string,
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
				scope,
			);

			const gid = rsp?.data?.project?.id;
			if (gid == null) return undefined;

			const match = /gid:\/\/gitlab\/Project\/([0-9]+)\b/.exec(gid);
			if (match == null) return undefined;

			const projectId = match[1];

			if (scope != null) {
				scope.exitDetails = `\u2022 projectId=${projectId}`;
			}
			return projectId;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			this.handleException(ex, provider, scope);
			return undefined;
		}
	}

	private async graphql<T extends object>(
		provider: RichRemoteProvider,
		token: string,
		baseUrl: string | undefined,
		query: string,
		variables: { [key: string]: any },
		scope: LogScope | undefined,
	): Promise<T | undefined> {
		let rsp: Response;
		try {
			const stopwatch =
				Logger.logLevel === LogLevel.Debug || Logger.isDebugging
					? new Stopwatch(`[GITLAB] POST ${baseUrl}`, { log: false })
					: undefined;

			const agent = this.getProxyAgent(provider);

			try {
				rsp = await wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					fetch(`${baseUrl ?? 'https://gitlab.com/api'}/graphql`, {
						method: 'POST',
						headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
						agent: agent,
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

				stopwatch?.stop({ message: message });
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError) {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitLab request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private async request<T>(
		provider: RichRemoteProvider,
		token: string,
		baseUrl: string | undefined,
		route: string,
		options: { method: RequestInit['method'] } & Record<string, unknown>,
		scope: LogScope | undefined,
	): Promise<T> {
		const url = `${baseUrl ?? 'https://gitlab.com/api'}/${route}`;

		let rsp: Response;
		try {
			const stopwatch =
				Logger.logLevel === LogLevel.Debug || Logger.isDebugging
					? new Stopwatch(`[GITLAB] ${options?.method ?? 'GET'} ${url}`, { log: false })
					: undefined;

			const agent = this.getProxyAgent(provider);

			try {
				rsp = await wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					fetch(url, {
						headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
						agent: agent,
						...options,
					}),
				);

				if (rsp.ok) {
					const data: T = await rsp.json();
					return data;
				}

				throw new ProviderFetchError('GitLab', rsp);
			} finally {
				stopwatch?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError) {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitLab request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(
		provider: RichRemoteProvider | undefined,
		token: string,
		ex: ProviderFetchError,
		scope: LogScope | undefined,
	): void {
		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new ProviderRequestNotFoundError(ex);
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

					throw new ProviderRequestRateLimitError(ex, token, resetAt);
				}
				throw new AuthenticationError('gitlab', AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				Logger.error(ex, scope);
				if (ex.response != null) {
					provider?.trackRequestException();
					void showIntegrationRequestFailed500WarningMessage(
						`${provider?.name ?? 'GitLab'} failed to respond and might be experiencing issues.${
							!provider?.custom
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
				if (ex.status >= 400 && ex.status < 500) throw new ProviderRequestClientError(ex);
				break;
		}

		Logger.error(ex, scope);
		if (Logger.isDebugging) {
			void window.showErrorMessage(
				`GitLab request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}

	private handleException(ex: Error, provider: RichRemoteProvider, scope: LogScope | undefined): Error {
		Logger.error(ex, scope);
		// debugger;

		if (ex instanceof AuthenticationError) {
			void this.showAuthenticationErrorMessage(ex, provider);
		}
		return ex;
	}

	private async showAuthenticationErrorMessage(ex: AuthenticationError, provider: RichRemoteProvider) {
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
			}
		} else {
			void window.showErrorMessage(ex.message);
		}
	}
}
