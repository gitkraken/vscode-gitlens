import type { HttpsProxyAgent } from 'https-proxy-agent';
import { Disposable, Uri, window } from 'vscode';
import { fetch, getProxyAgent, RequestInit, Response } from '@env/fetch';
import { isWeb } from '@env/platform';
import { configuration, CustomRemoteType } from '../../configuration';
import type { Container } from '../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ProviderFetchError,
	ProviderRequestClientError,
	ProviderRequestNotFoundError,
	ProviderRequestRateLimitError,
} from '../../errors';
import { Account, DefaultBranch, IssueOrPullRequest, IssueOrPullRequestType, PullRequest } from '../../git/models';
import type { RichRemoteProvider } from '../../git/remotes/provider';
import { LogCorrelationContext, Logger, LogLevel } from '../../logger';
import { debug } from '../../system/decorators/log';
import { Stopwatch } from '../../system/stopwatch';
import { equalsIgnoreCase } from '../../system/string';
import {
	GitLabCommit,
	GitLabIssue,
	GitLabMergeRequest,
	GitLabMergeRequestREST,
	GitLabMergeRequestState,
	GitLabUser,
} from './models';

export class GitLabApi implements Disposable {
	private _disposable: Disposable | undefined;
	private _projectIds = new Map<string, Promise<string | undefined>>();

	constructor(_container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'proxy') || configuration.changed(e, 'remotes')) {
					this._projectIds.clear();
					this._proxyAgents.clear();
					this._ignoreSSLErrors.clear();
				}
			}),
			configuration.onDidChangeAny(e => {
				if (e.affectsConfiguration('http.proxy') || e.affectsConfiguration('http.proxyStrictSSL')) {
					this._projectIds.clear();
					this._proxyAgents.clear();
				}
			}),
		);
	}

	dispose(): void {
		this._disposable?.dispose();
	}

	private _proxyAgents = new Map<string, HttpsProxyAgent | null | undefined>();
	private getProxyAgent(provider: RichRemoteProvider): HttpsProxyAgent | undefined {
		if (isWeb) return undefined;

		let proxyAgent = this._proxyAgents.get(provider.id);
		if (proxyAgent === undefined) {
			const ignoreSSLErrors = this.getIgnoreSSLErrors(provider);
			proxyAgent = getProxyAgent(ignoreSSLErrors === true || ignoreSSLErrors === 'force' ? false : undefined);
			this._proxyAgents.set(provider.id, proxyAgent ?? null);
		}

		return proxyAgent ?? undefined;
	}

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	private getIgnoreSSLErrors(provider: RichRemoteProvider): boolean | 'force' {
		if (isWeb) return false;

		let ignoreSSLErrors = this._ignoreSSLErrors.get(provider.id);
		if (ignoreSSLErrors === undefined) {
			const cfg = configuration
				.get('remotes')
				?.find(remote => remote.type === CustomRemoteType.GitLab && remote.domain === provider.domain);
			ignoreSSLErrors = cfg?.ignoreSSLErrors ?? false;
			this._ignoreSSLErrors.set(provider.id, ignoreSSLErrors);
		}

		return ignoreSSLErrors;
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
		const cc = Logger.getCorrelationContext();

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

			throw this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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

			throw this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(provider, token, options?.baseUrl, query, {
				fullPath: `${owner}/${repo}`,
			});

			const defaultBranch = rsp?.data?.project?.repository?.rootRef ?? undefined;
			if (defaultBranch == null) return undefined;

			return {
				provider: provider,
				name: defaultBranch,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(provider, token, options?.baseUrl, query, {
				fullPath: `${owner}/${repo}`,
				iid: String(number),
			});

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

			throw this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(provider, token, options?.baseUrl, query, {
				fullPath: `${owner}/${repo}`,
				branches: [branch],
				state: options?.include,
			});

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
				GitLabMergeRequest.fromState(pr.state),
				new Date(pr.updatedAt),
				// TODO@eamodio this isn't right, but GitLab doesn't seem to provide a closedAt on merge requests in GraphQL
				pr.state !== GitLabMergeRequestState.CLOSED ? undefined : new Date(pr.updatedAt),
				pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
			);
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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

			return GitLabMergeRequestREST.from(mrs[0], provider);
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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
			const rsp = await this.graphql<QueryResult>(provider, token, options?.baseUrl, query, {
				search: search,
			});

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

			this.handleException(ex, provider, cc);
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
		const cc = Logger.getCorrelationContext();

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
			const rsp = await this.graphql<QueryResult>(provider, token, baseUrl, query, {
				fullPath: `${group}/${repo}`,
			});

			const gid = rsp?.data?.project?.id;
			if (gid == null) return undefined;

			const match = /gid:\/\/gitlab\/Project\/([0-9]+)\b/.exec(gid);
			if (match == null) return undefined;

			const projectId = match[1];

			if (cc != null) {
				cc.exitDetails = `\u2022 projectId=${projectId}`;
			}
			return projectId;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			this.handleException(ex, provider, cc);
			return undefined;
		}
	}

	private async graphql<T>(
		provider: RichRemoteProvider,
		token: string,
		baseUrl: string | undefined,
		query: string,
		variables: { [key: string]: any },
	): Promise<T | undefined> {
		let rsp: Response;
		try {
			const stopwatch =
				Logger.logLevel === LogLevel.Debug || Logger.isDebugging
					? new Stopwatch(`[GITLAB] POST ${baseUrl}`, { log: false })
					: undefined;

			const agent = this.getProxyAgent(provider);
			const ignoreSSLErrors = this.getIgnoreSSLErrors(provider);
			let previousRejectUnauthorized;

			try {
				if (ignoreSSLErrors === 'force') {
					previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
					process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
				}

				rsp = await fetch(`${baseUrl ?? 'https://gitlab.com/api'}/graphql`, {
					method: 'POST',
					headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
					agent: agent as any,
					body: JSON.stringify({ query: query, variables: variables }),
				});

				if (rsp.ok) {
					const data: T | { errors: { message: string }[] } = await rsp.json();

					if ('errors' in data) throw new ProviderFetchError('GitLab', rsp, data.errors);
					return data;
				}

				throw new ProviderFetchError('GitLab', rsp);
			} finally {
				if (ignoreSSLErrors === 'force') {
					process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
				}

				const match = /(^[^({\n]+)/.exec(query);
				const message = ` ${match?.[1].trim() ?? query}`;

				stopwatch?.stop({ message: message });
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError) {
				this.handleRequestError(ex, token);
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
		options?: { method: RequestInit['method'] } & Record<string, unknown>,
	): Promise<T> {
		const url = `${baseUrl ?? 'https://gitlab.com/api'}/${route}`;

		let rsp: Response;
		try {
			const stopwatch =
				Logger.logLevel === LogLevel.Debug || Logger.isDebugging
					? new Stopwatch(`[GITLAB] ${options?.method ?? 'GET'} ${url}`, { log: false })
					: undefined;

			const agent = this.getProxyAgent(provider);
			const ignoreSSLErrors = this.getIgnoreSSLErrors(provider);
			let previousRejectUnauthorized;

			try {
				if (ignoreSSLErrors === 'force') {
					previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
					process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
				}

				rsp = await fetch(url, {
					headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
					agent: agent as any,
					...options,
				});

				if (rsp.ok) {
					const data: T = await rsp.json();
					return data;
				}

				throw new ProviderFetchError('GitLab', rsp);
			} finally {
				if (ignoreSSLErrors === 'force') {
					process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
				}

				stopwatch?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError) {
				this.handleRequestError(ex, token);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitLab request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(ex: ProviderFetchError, token: string): void {
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
				if (ex.response != null) {
					void window.showErrorMessage(
						'GitLab failed to respond and might be experiencing issues. Please visit the [GitLab status page](https://status.gitlab.com/) for more information.',
						'OK',
					);
				}
				return;
			case 502: // Bad Gateway
				// GitHub seems to return this status code for timeouts
				if (ex.message.includes('timeout')) {
					void window.showErrorMessage('GitLab request timed out');
					return;
				}
				break;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new ProviderRequestClientError(ex);
				break;
		}

		if (Logger.isDebugging) {
			void window.showErrorMessage(
				`GitLab request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}

	private handleException(ex: Error, provider: RichRemoteProvider, cc: LogCorrelationContext | undefined): Error {
		Logger.error(ex, cc);
		debugger;

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
