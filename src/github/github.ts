'use strict';
import { Octokit } from '@octokit/core';
import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';
import type { Endpoints, OctokitResponse, RequestParameters } from '@octokit/types';
import fetch from '@env/fetch';
import { isWeb } from '@env/platform';
import { AuthenticationError, AuthenticationErrorReason, ProviderRequestError } from '../errors';
import {
	type DefaultBranch,
	type IssueOrPullRequest,
	type IssueOrPullRequestType,
	PullRequest,
	PullRequestState,
} from '../git/models';
import type { Account } from '../git/models/author';
import type { RichRemoteProvider } from '../git/remotes/provider';
import { LogCorrelationContext, Logger, LogLevel } from '../logger';
import { debug, Stopwatch } from '../system';

export class GitHubApi {
	@debug<GitHubApi['getAccountForCommit']>({ args: { 0: p => p.name, 1: '<token>' } })
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

		interface QueryResult {
			repository:
				| {
						object:
							| {
									author?: {
										name: string | null;
										email: string | null;
										avatarUrl: string;
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getAccountForCommit(
	$owner: String!
	$repo: String!
	$ref: GitObjectID!
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		object(oid: $ref) {
			... on Commit {
				author {
					name
					email
					avatarUrl(size: $avatarSize)
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				...options,
				owner: owner,
				repo: repo,
				ref: ref,
			});

			const author = rsp?.repository?.object?.author;
			if (author == null) return undefined;

			return {
				provider: provider,
				name: author.name ?? undefined,
				email: author.email ?? undefined,
				avatarUrl: author.avatarUrl,
			};
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	@debug<GitHubApi['getAccountForEmail']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getAccountForEmail(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		email: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const cc = Logger.getCorrelationContext();

		interface QueryResult {
			search:
				| {
						nodes:
							| {
									name: string | null;
									email: string | null;
									avatarUrl: string;
							  }[]
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getAccountForEmail(
	$emailQuery: String!
	$avatarSize: Int
) {
	search(type: USER, query: $emailQuery, first: 1) {
		nodes {
			... on User {
				name
				email
				avatarUrl(size: $avatarSize)
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				...options,
				owner: owner,
				repo: repo,
				emailQuery: `in:email ${email}`,
			});

			const author = rsp?.search?.nodes?.[0];
			if (author == null) return undefined;

			return {
				provider: provider,
				name: author.name ?? undefined,
				email: author.email ?? undefined,
				avatarUrl: author.avatarUrl,
			};
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	@debug<GitHubApi['getDefaultBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
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
			repository: {
				defaultBranchRef: {
					name: string;
				} | null;
			} | null;
		}

		try {
			const query = `query getDefaultBranch(
	$owner: String!
	$repo: String!
) {
	repository(name: $repo, owner: $owner) {
		defaultBranchRef {
			name
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				...options,
				owner: owner,
				repo: repo,
			});

			const defaultBranch = rsp?.repository?.defaultBranchRef?.name ?? undefined;
			if (defaultBranch == null) return undefined;

			return {
				provider: provider,
				name: defaultBranch,
			};
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	@debug<GitHubApi['getIssueOrPullRequest']>({ args: { 0: p => p.name, 1: '<token>' } })
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
			repository?: { issueOrPullRequest?: GitHubIssueOrPullRequest };
		}

		try {
			const query = `query getIssueOrPullRequest(
		$owner: String!
		$repo: String!
		$number: Int!
	) {
		repository(name: $repo, owner: $owner) {
			issueOrPullRequest(number: $number) {
				__typename
				... on Issue {
					createdAt
					closed
					closedAt
					title
					url
				}
				... on PullRequest {
					createdAt
					closed
					closedAt
					title
					url
				}
			}
		}
	}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				...options,
				owner: owner,
				repo: repo,
				number: number,
			});

			const issue = rsp?.repository?.issueOrPullRequest;
			if (issue == null) return undefined;

			return {
				provider: provider,
				type: issue.type,
				id: String(number),
				date: new Date(issue.createdAt),
				title: issue.title,
				closed: issue.closed,
				closedDate: issue.closedAt == null ? undefined : new Date(issue.closedAt),
				url: issue.url,
			};
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	@debug<GitHubApi['getPullRequestForBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getPullRequestForBranch(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			include?: GitHubPullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		interface QueryResult {
			repository:
				| {
						refs: {
							nodes: {
								associatedPullRequests?: {
									nodes?: GitHubPullRequest[];
								};
							}[];
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getPullRequestForBranch(
	$owner: String!
	$repo: String!
	$branch: String!
	$limit: Int!
	$include: [PullRequestState!]
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		refs(query: $branch, refPrefix: "refs/heads/", first: 1) {
			nodes {
				associatedPullRequests(first: $limit, orderBy: {field: UPDATED_AT, direction: DESC}, states: $include) {
					nodes {
						author {
							login
							avatarUrl(size: $avatarSize)
							url
						}
						permalink
						number
						title
						state
						updatedAt
						closedAt
						mergedAt
						repository {
							isFork
							owner {
								login
							}
						}
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				...options,
				owner: owner,
				repo: repo,
				branch: branch,
				// Since GitHub sort doesn't seem to really work, look for a max of 10 PRs and then sort them ourselves
				limit: 10,
			});

			// If the pr is not from a fork, keep it e.g. show root pr's on forks, otherwise, ensure the repo owners match
			const prs = rsp?.repository?.refs.nodes[0]?.associatedPullRequests?.nodes?.filter(
				pr => !pr.repository.isFork || pr.repository.owner.login === owner,
			);
			if (prs == null || prs.length === 0) return undefined;

			if (prs.length > 1) {
				prs.sort(
					(a, b) =>
						(a.repository.owner.login === owner ? -1 : 1) - (b.repository.owner.login === owner ? -1 : 1) ||
						(a.state === 'OPEN' ? -1 : 1) - (b.state === 'OPEN' ? -1 : 1) ||
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
			}

			return GitHubPullRequest.from(prs[0], provider);
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	@debug<GitHubApi['getPullRequestForCommit']>({ args: { 0: p => p.name, 1: '<token>' } })
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

		interface QueryResult {
			repository:
				| {
						object?: {
							associatedPullRequests?: {
								nodes?: GitHubPullRequest[];
							};
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getPullRequestForCommit(
	$owner: String!
	$repo: String!
	$ref: GitObjectID!
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		object(oid: $ref) {
			... on Commit {
				associatedPullRequests(first: 2, orderBy: {field: UPDATED_AT, direction: DESC}) {
					nodes {
						author {
							login
							avatarUrl(size: $avatarSize)
							url
						}
						permalink
						number
						title
						state
						updatedAt
						closedAt
						mergedAt
						repository {
							isFork
							owner {
								login
							}
						}
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				...options,
				owner: owner,
				repo: repo,
				ref: ref,
			});

			// If the pr is not from a fork, keep it e.g. show root pr's on forks, otherwise, ensure the repo owners match
			const prs = rsp?.repository?.object?.associatedPullRequests?.nodes?.filter(
				pr => !pr.repository.isFork || pr.repository.owner.login === owner,
			);
			if (prs == null || prs.length === 0) return undefined;

			if (prs.length > 1) {
				prs.sort(
					(a, b) =>
						(a.repository.owner.login === owner ? -1 : 1) - (b.repository.owner.login === owner ? -1 : 1) ||
						(a.state === 'OPEN' ? -1 : 1) - (b.state === 'OPEN' ? -1 : 1) ||
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
			}

			return GitHubPullRequest.from(prs[0], provider);
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	private _octokits = new Map<string, Octokit>();
	private octokit(token: string, options?: ConstructorParameters<typeof Octokit>[0]): Octokit {
		let octokit = this._octokits.get(token);
		if (octokit == null) {
			let defaults;
			if (isWeb) {
				function fetchCore(url: string, options: { headers?: Record<string, string> }) {
					if (options.headers != null) {
						// Strip out the user-agent (since it causes warnings in a webworker)
						const { 'user-agent': userAgent, ...headers } = options.headers;
						if (userAgent) {
							options.headers = headers;
						}
					}
					return fetch(url, options);
				}

				defaults = Octokit.defaults({
					auth: `token ${token}`,
					request: { fetch: fetchCore },
				});
			} else {
				defaults = Octokit.defaults({ auth: `token ${token}` });
			}

			octokit = new defaults(options);
			this._octokits.set(token, octokit);

			if (Logger.logLevel === LogLevel.Debug || Logger.isDebugging) {
				octokit.hook.wrap('request', async (request, options) => {
					const stopwatch = new Stopwatch(`[GITHUB] ${options.method} ${options.url}`, { log: false });
					try {
						return await request(options);
					} finally {
						let message;
						try {
							if (typeof options.query === 'string') {
								const match = /(^[^({\n]+)/.exec(options.query);
								message = ` ${match?.[1].trim() ?? options.query}`;
							}
						} catch {}
						stopwatch.stop({ message: message });
					}
				});
			}
		}

		return octokit;
	}

	private async graphql<T>(
		token: string,
		query: string,
		variables: { [key: string]: any },
		cc?: LogCorrelationContext,
	): Promise<T | undefined> {
		try {
			return await this.octokit(token).graphql<T>(query, variables);
		} catch (ex) {
			debugger;
			throw this.handleRequestErrors(ex, cc);
		}
	}

	private async request<R extends string>(
		token: string,
		route: keyof Endpoints | R,
		options?: R extends keyof Endpoints ? Endpoints[R]['parameters'] & RequestParameters : RequestParameters,
	): Promise<R extends keyof Endpoints ? Endpoints[R]['response'] : OctokitResponse<unknown>> {
		try {
			return (await this.octokit(token).request<R>(route, options)) as any;
		} catch (ex) {
			this.handleRequestErrors(ex);
			throw ex;
		}
	}

	private handleRequestErrors(
		ex: unknown | RequestError | GraphqlResponseError<any>,
		cc?: LogCorrelationContext,
	): unknown {
		Logger.error(ex, cc);
		debugger;

		if (ex instanceof RequestError) {
			switch (ex.status) {
				case 401:
					return new AuthenticationError('github', AuthenticationErrorReason.Unauthorized, ex);
				case 403:
					return new AuthenticationError('github', AuthenticationErrorReason.Forbidden, ex);
				case 500:
					if (ex.response != null) {
						// TODO@eamodio: Handle GitHub down errors
					}
					break;
				default:
					if (ex.status >= 400 && ex.status <= 500) return new ProviderRequestError(ex);
					break;
			}

			return ex;
		}

		if (ex instanceof GraphqlResponseError && ex.errors?.[0]?.type === 'FORBIDDEN') {
			return new AuthenticationError('github', AuthenticationErrorReason.Forbidden, ex);
		}

		return ex;
	}
}

interface GitHubIssueOrPullRequest {
	type: IssueOrPullRequestType;
	number: number;
	createdAt: string;
	closed: boolean;
	closedAt: string | null;
	title: string;
	url: string;
}

type GitHubPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

interface GitHubPullRequest {
	author: {
		login: string;
		avatarUrl: string;
		url: string;
	};
	permalink: string;
	number: number;
	title: string;
	state: GitHubPullRequestState;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	repository: {
		isFork: boolean;
		owner: {
			login: string;
		};
	};
}

export namespace GitHubPullRequest {
	export function from(pr: GitHubPullRequest, provider: RichRemoteProvider): PullRequest {
		return new PullRequest(
			provider,
			{
				name: pr.author.login,
				avatarUrl: pr.author.avatarUrl,
				url: pr.author.url,
			},
			String(pr.number),
			pr.title,
			pr.permalink,
			fromState(pr.state),
			new Date(pr.updatedAt),
			pr.closedAt == null ? undefined : new Date(pr.closedAt),
			pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		);
	}

	export function fromState(state: GitHubPullRequestState): PullRequestState {
		return state === 'MERGED'
			? PullRequestState.Merged
			: state === 'CLOSED'
			? PullRequestState.Closed
			: PullRequestState.Open;
	}

	export function toState(state: PullRequestState): GitHubPullRequestState {
		return state === PullRequestState.Merged ? 'MERGED' : state === PullRequestState.Closed ? 'CLOSED' : 'OPEN';
	}
}
