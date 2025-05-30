import { Octokit } from '@octokit/core';
import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';
import type { Endpoints, OctokitResponse, RequestParameters } from '@octokit/types';
import type { HttpsProxyAgent } from 'https-proxy-agent';
import type { Disposable, Event } from 'vscode';
import { EventEmitter, Uri, window } from 'vscode';
import { fetch, getProxyAgent, wrapForForcedInsecureSSL } from '@env/fetch';
import { isWeb } from '@env/platform';
import type { CoreConfiguration } from '../../constants';
import type { Container } from '../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ProviderRequestClientError,
	ProviderRequestNotFoundError,
	ProviderRequestRateLimitError,
} from '../../errors';
import type { PagedResult } from '../../git/gitProvider';
import { RepositoryVisibility } from '../../git/gitProvider';
import type { Account } from '../../git/models/author';
import type { DefaultBranch } from '../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../git/models/issue';
import type { PullRequest, SearchedPullRequest } from '../../git/models/pullRequest';
import { isSha } from '../../git/models/reference';
import type { GitUser } from '../../git/models/user';
import { getGitHubNoReplyAddressParts } from '../../git/remotes/github';
import type { RichRemoteProvider } from '../../git/remotes/richRemoteProvider';
import {
	showIntegrationRequestFailed500WarningMessage,
	showIntegrationRequestTimedOutWarningMessage,
} from '../../messages';
import { uniqueBy } from '../../system/array';
import { configuration } from '../../system/configuration';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { LogLevel } from '../../system/logger.constants';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import { Stopwatch } from '../../system/stopwatch';
import { base64 } from '../../system/string';
import type { Version } from '../../system/version';
import { fromString, satisfies } from '../../system/version';
import type {
	GitHubBlame,
	GitHubBlameRange,
	GitHubBranch,
	GitHubCommit,
	GitHubCommitRef,
	GitHubContributor,
	GitHubDetailedPullRequest,
	GitHubIssueDetailed,
	GitHubIssueOrPullRequest,
	GitHubPagedResult,
	GitHubPageInfo,
	GitHubPullRequest,
	GitHubPullRequestState,
	GitHubTag,
} from './models';
import { fromGitHubIssueDetailed, fromGitHubPullRequest, fromGitHubPullRequestDetailed } from './models';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
const emptyBlameResult: GitHubBlame = Object.freeze({ ranges: [] });

const prNodeProperties = `
assignees(first: 10) {
	nodes {
		login
		avatarUrl
		url
	}
}
author {
	login
	avatarUrl
	url
}
baseRefName
baseRefOid
baseRepository {
	name
	owner {
		login
	}
	url
}
checksUrl
isDraft
isCrossRepository
isReadByViewer
headRefName
headRefOid
headRepository {
	name
	owner {
		login
	}
	url
}
permalink
number
title
state
additions
deletions
updatedAt
closedAt
mergeable
mergedAt
mergedBy {
	login
}
repository {
	isFork
	owner {
		login
	}
}
repository {
	isFork
	owner {
		login
	}
}
reviewDecision
reviewRequests(first: 10) {
	nodes {
		asCodeOwner
		id
		requestedReviewer {
			... on User {
				login
				avatarUrl
				url
			}
		}
	}
}
totalCommentsCount
`;

const issueNodeProperties = `
... on Issue {
	assignees(first: 100) {
		nodes {
			login
			url
			avatarUrl
		}
	}
	author {
		login
		avatarUrl
		url
	}
	comments {
	  totalCount
	}
	number
	title
	url
	createdAt
	closedAt
	closed
	updatedAt
	labels(first: 20) {
		nodes {
			color
			name
		}
	}
	reactions(content: THUMBS_UP) {
	  totalCount
	}
	repository {
		name
		owner {
			login
		}
	}
}
`;

export class GitHubApi implements Disposable {
	private readonly _onDidReauthenticate = new EventEmitter<void>();
	get onDidReauthenticate(): Event<void> {
		return this._onDidReauthenticate.event;
	}

	private readonly _disposable: Disposable;

	constructor(_container: Container) {
		this._disposable = configuration.onDidChangeAny(e => {
			if (
				configuration.changedAny<CoreConfiguration>(e, ['http.proxy', 'http.proxyStrictSSL']) ||
				configuration.changed(e, ['outputLevel', 'proxy'])
			) {
				this.resetCaches();
			}
		});
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private resetCaches(): void {
		this._proxyAgent = null;
		this._octokits.clear();
		this._enterpriseVersions.clear();
	}

	private _proxyAgent: HttpsProxyAgent | null | undefined = null;
	private get proxyAgent(): HttpsProxyAgent | undefined {
		if (isWeb) return undefined;

		if (this._proxyAgent === null) {
			this._proxyAgent = getProxyAgent();
		}
		return this._proxyAgent;
	}

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
		const scope = getLogScope();

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

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);

			const author = rsp?.repository?.object?.author;
			if (author == null) return undefined;

			return {
				provider: provider,
				name: author.name ?? undefined,
				email: author.email ?? undefined,
				// If we are GitHub Enterprise, we may need to convert the avatar URL since it might require authentication
				avatarUrl:
					!author.avatarUrl || isGitHubDotCom(options)
						? author.avatarUrl ?? undefined
						: author.email && options?.baseUrl != null
						? await this.createEnterpriseAvatarUrl(
								provider,
								token,
								options.baseUrl,
								author.email,
								options.avatarSize,
						  )
						: undefined,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
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
		const scope = getLogScope();

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

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					emailQuery: `in:email ${email}`,
				},
				scope,
			);

			const author = rsp?.search?.nodes?.[0];
			if (author == null) return undefined;

			return {
				provider: provider,
				name: author.name ?? undefined,
				email: author.email ?? undefined,
				// If we are GitHub Enterprise, we may need to convert the avatar URL since it might require authentication
				avatarUrl:
					!author.avatarUrl || isGitHubDotCom(options)
						? author.avatarUrl ?? undefined
						: author.email && options?.baseUrl != null
						? await this.createEnterpriseAvatarUrl(
								provider,
								token,
								options.baseUrl,
								author.email,
								options.avatarSize,
						  )
						: undefined,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
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
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						defaultBranchRef: { name: string } | null | undefined;
				  }
				| null
				| undefined;
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

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
				},
				scope,
			);

			const defaultBranch = rsp?.repository?.defaultBranchRef?.name ?? undefined;
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
		const scope = getLogScope();

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

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					number: number,
				},
				scope,
			);

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
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
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
		const scope = getLogScope();

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

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					branch: branch,
					// Since GitHub sort doesn't seem to really work, look for a max of 10 PRs and then sort them ourselves
					limit: 10,
				},
				scope,
			);

			// If the pr is not from a fork, keep it e.g. show root pr's on forks, otherwise, ensure the repo owners match
			const prs = rsp?.repository?.refs.nodes[0]?.associatedPullRequests?.nodes?.filter(
				pr => pr != null && (!pr.repository.isFork || pr.repository.owner.login === owner),
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

			return fromGitHubPullRequest(prs[0], provider);
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
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
		const scope = getLogScope();

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

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);

			// If the pr is not from a fork, keep it e.g. show root pr's on forks, otherwise, ensure the repo owners match
			const prs = rsp?.repository?.object?.associatedPullRequests?.nodes?.filter(
				pr => pr != null && (!pr.repository.isFork || pr.repository.owner.login === owner),
			);
			if (prs == null || prs.length === 0) return undefined;

			if (prs.length > 1) {
				prs.sort(
					(a, b) =>
						(a.repository.owner.login === owner ? -1 : 1) - (b.repository.owner.login === owner ? -1 : 1) ||
						(a.state === 'MERGED' ? -1 : 1) - (b.state === 'MERGED' ? -1 : 1) ||
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
			}

			return fromGitHubPullRequest(prs[0], provider);
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@debug<GitHubApi['getBlame']>({ args: { 0: '<token>' } })
	async getBlame(token: string, owner: string, repo: string, ref: string, path: string): Promise<GitHubBlame> {
		const scope = getLogScope();

		interface QueryResult {
			viewer: { name: string };
			repository:
				| {
						object: {
							blame: {
								ranges: GitHubBlameRange[];
							};
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getBlameRanges(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String!
) {
	viewer { name }
	repository(owner: $owner, name: $repo) {
		object(expression: $ref) {
			...on Commit {
				blame(path: $path) {
					ranges {
						startingLine
						endingLine
						commit {
							oid
							parents(first: 3) { nodes { oid } }
							message
							additions
							changedFiles
							deletions
							author {
								avatarUrl
								date
								email
								name
							}
							committer {
								date
								email
								name
							}
						}
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					path: path,
				},
				scope,
			);
			if (rsp == null) return emptyBlameResult;

			const ranges = rsp.repository?.object?.blame?.ranges;
			if (ranges == null || ranges.length === 0) return { ranges: [], viewer: rsp.viewer?.name };

			return { ranges: ranges, viewer: rsp.viewer?.name };
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return emptyBlameResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getBranches']>({ args: { 0: '<token>' } })
	async getBranches(
		token: string,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubBranch>> {
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						refs: {
							pageInfo: {
								endCursor: string;
								hasNextPage: boolean;
							};
							nodes: GitHubBranch[];
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getBranches(
	$owner: String!
	$repo: String!
	$branchQuery: String
	$cursor: String
	$limit: Int = 100
) {
	repository(owner: $owner, name: $repo) {
		refs(query: $branchQuery, refPrefix: "refs/heads/", first: $limit, after: $cursor) {
			pageInfo {
				endCursor
				hasNextPage
			}
			nodes {
				name
				target {
					oid
					...on Commit {
						authoredDate
						committedDate
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					branchQuery: options?.query,
					cursor: options?.cursor,
					limit: Math.min(100, options?.limit ?? 100),
				},
				scope,
			);
			if (rsp == null) return emptyPagedResult;

			const refs = rsp.repository?.refs;
			if (refs == null) return emptyPagedResult;

			return {
				paging: {
					cursor: refs.pageInfo.endCursor,
					more: refs.pageInfo.hasNextPage,
				},
				values: refs.nodes,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getCommit']>({ args: { 0: '<token>' } })
	async getCommit(
		token: string,
		owner: string,
		repo: string,
		ref: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined> {
		const scope = getLogScope();

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /repos/{owner}/{repo}/commits/{ref}',
				{
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);

			const result = rsp?.data;
			if (result == null) return undefined;

			const { commit } = result;
			return {
				oid: result.sha,
				parents: { nodes: result.parents.map(p => ({ oid: p.sha })) },
				message: commit.message,
				additions: result.stats?.additions,
				changedFiles: result.files?.length,
				deletions: result.stats?.deletions,
				author: {
					avatarUrl: result.author?.avatar_url ?? undefined,
					date: commit.author?.date ?? new Date().toString(),
					email: commit.author?.email ?? undefined,
					name: commit.author?.name ?? '',
				},
				committer: {
					date: commit.committer?.date ?? new Date().toString(),
					email: commit.committer?.email ?? undefined,
					name: commit.committer?.name ?? '',
				},
				files: result.files,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}

		// const results = await this.getCommits(token, owner, repo, ref, { limit: 1 });
		// if (results.values.length === 0) return undefined;

		// return { ...results.values[0], viewer: results.viewer };
	}

	@debug<GitHubApi['getCommitForFile']>({ args: { 0: '<token>' } })
	async getCommitForFile(
		token: string,
		owner: string,
		repo: string,
		ref: string,
		path: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined> {
		if (isSha(ref)) return this.getCommit(token, owner, repo, ref);

		// TODO: optimize this -- only need to get the sha for the ref
		const results = await this.getCommits(token, owner, repo, ref, { limit: 1, path: path });
		if (results.values.length === 0) return undefined;

		const commit = await this.getCommit(token, owner, repo, results.values[0].oid);
		return { ...(commit ?? results.values[0]), viewer: results.viewer };
	}

	@debug<GitHubApi['getCommitBranches']>({ args: { 0: '<token>' } })
	async getCommitBranches(token: string, owner: string, repo: string, ref: string, date: Date): Promise<string[]> {
		const scope = getLogScope();

		interface QueryResult {
			repository: {
				refs: {
					nodes: {
						name: string;
						target: {
							history: {
								nodes: { oid: string }[];
							};
						};
					}[];
				};
			};
		}

		try {
			const query = `query getCommitBranches(
	$owner: String!
	$repo: String!
	$since: GitTimestamp!
	$until: GitTimestamp!
) {
	repository(owner: $owner, name: $repo) {
		refs(first: 20, refPrefix: "refs/heads/") {
			nodes {
				name
				target {
					... on Commit {
						history(first: 3, since: $since until: $until) {
							nodes { oid }
						}
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					since: date.toISOString(),
					until: date.toISOString(),
				},
				scope,
			);

			const nodes = rsp?.repository?.refs?.nodes;
			if (nodes == null) return [];

			const branches = [];

			for (const branch of nodes) {
				for (const commit of branch.target.history.nodes) {
					if (commit.oid === ref) {
						branches.push(branch.name);
						break;
					}
				}
			}

			return branches;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getCommitCount']>({ args: { 0: '<token>' } })
	async getCommitCount(token: string, owner: string, repo: string, ref: string): Promise<number | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			repository: {
				ref: {
					target: {
						history: { totalCount: number };
					};
				};
			};
		}

		try {
			const query = `query getCommitCount(
	$owner: String!
	$repo: String!
	$ref: String!
) {
	repository(owner: $owner, name: $repo) {
		ref(qualifiedName: $ref) {
			target {
				... on Commit {
					history(first: 1) {
						totalCount
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);

			const count = rsp?.repository?.ref?.target.history.totalCount;
			return count;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getCommitOnBranch']>({ args: { 0: '<token>' } })
	async getCommitOnBranch(
		token: string,
		owner: string,
		repo: string,
		branch: string,
		ref: string,
		date: Date,
	): Promise<string[]> {
		const scope = getLogScope();

		interface QueryResult {
			repository: {
				ref: {
					target: {
						history: {
							nodes: { oid: string }[];
						};
					};
				};
			};
		}
		try {
			const query = `query getCommitOnBranch(
	$owner: String!
	$repo: String!
	$ref: String!
	$since: GitTimestamp!
	$until: GitTimestamp!
) {
	repository(owner: $owner, name: $repo) {
		ref(qualifiedName: $ref) {
			target {
				... on Commit {
					history(first: 3, since: $since until: $until) {
						nodes { oid }
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: `refs/heads/${branch}`,
					since: date.toISOString(),
					until: date.toISOString(),
				},
				scope,
			);

			const nodes = rsp?.repository?.ref.target.history.nodes;
			if (nodes == null) return [];

			const branches = [];

			for (const commit of nodes) {
				if (commit.oid === ref) {
					branches.push(branch);
					break;
				}
			}

			return branches;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getCommits']>({ args: { 0: '<token>' } })
	async getCommits(
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			all?: boolean;
			authors?: GitUser[];
			before?: string;
			limit?: number;
			path?: string;
			since?: string | Date;
			until?: string | Date;
		},
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }> {
		const scope = getLogScope();

		if (options?.limit === 1 && options?.path == null) {
			return this.getCommitsCoreSingle(token, owner, repo, ref);
		}

		interface QueryResult {
			viewer: { name: string };
			repository:
				| {
						object:
							| {
									history: {
										pageInfo: GitHubPageInfo;
										nodes: GitHubCommit[];
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommits(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String
	$author: CommitAuthor
	$after: String
	$before: String
	$limit: Int = 100
	$since: GitTimestamp
	$until: GitTimestamp
) {
	viewer { name }
	repository(name: $repo, owner: $owner) {
		object(expression: $ref) {
			... on Commit {
				history(first: $limit, author: $author, path: $path, after: $after, before: $before, since: $since, until: $until) {
					pageInfo {
						startCursor
						endCursor
						hasNextPage
						hasPreviousPage
					}
					nodes {
						... on Commit {
							oid
							message
							parents(first: 3) { nodes { oid } }
							additions
							changedFiles
							deletions
							author {
								avatarUrl
								date
								email
								name
							}
							committer {
								 date
								 email
								 name
							 }
						}
					}
				}
			}
		}
	}
}`;

			let authors: { id?: string; emails?: string[] } | undefined;
			if (options?.authors != null) {
				if (options.authors.length === 1) {
					const [author] = options.authors;
					authors = {
						id: author.id,
						emails: author.email ? [author.email] : undefined,
					};
				} else {
					const emails = options.authors.filter(a => a.email).map(a => a.email!);
					authors = emails.length ? { emails: emails } : undefined;
				}
			}

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					after: options?.after,
					before: options?.before,
					path: options?.path,
					author: authors,
					limit: Math.min(100, options?.limit ?? 100),
					since: typeof options?.since === 'string' ? options?.since : options?.since?.toISOString(),
					until: typeof options?.until === 'string' ? options?.until : options?.until?.toISOString(),
				},
				scope,
			);
			const history = rsp?.repository?.object?.history;
			if (history == null) return emptyPagedResult;

			return {
				paging:
					history.pageInfo.endCursor != null
						? {
								cursor: history.pageInfo.endCursor ?? undefined,
								more: history.pageInfo.hasNextPage,
						  }
						: undefined,
				values: history.nodes,
				viewer: rsp?.viewer.name,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	private async getCommitsCoreSingle(
		token: string,
		owner: string,
		repo: string,
		ref: string,
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }> {
		const scope = getLogScope();

		interface QueryResult {
			viewer: { name: string };
			repository: { object: GitHubCommit } | null | undefined;
		}

		try {
			const query = `query getCommit(
	$owner: String!
	$repo: String!
	$ref: String!
) {
	viewer { name }
	repository(name: $repo owner: $owner) {
		object(expression: $ref) {
			...on Commit {
				oid
				parents(first: 3) { nodes { oid } }
				message
				additions
				changedFiles
				deletions
				author {
					avatarUrl
					date
					email
					name
				}
				committer {
					date
					email
					name
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);
			if (rsp == null) return emptyPagedResult;

			const commit = rsp.repository?.object;
			return commit != null ? { values: [commit], viewer: rsp.viewer.name } : emptyPagedResult;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getCommitRefs']>({ args: { 0: '<token>' } })
	async getCommitRefs(
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			before?: string;
			first?: number;
			last?: number;
			path?: string;
			since?: string;
			until?: string;
		},
	): Promise<GitHubPagedResult<GitHubCommitRef> | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						object:
							| {
									history: {
										pageInfo: GitHubPageInfo;
										totalCount: number;
										nodes: GitHubCommitRef[];
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommitRefs(
	$owner: String!
	$repo: String!
	$ref: String!
	$after: String
	$before: String
	$first: Int
	$last: Int
	$path: String
	$since: GitTimestamp
	$until: GitTimestamp
) {
	repository(name: $repo, owner: $owner) {
		object(expression: $ref) {
			... on Commit {
				history(first: $first, last: $last, path: $path, since: $since, until: $until, after: $after, before: $before) {
					pageInfo { startCursor, endCursor, hasNextPage, hasPreviousPage }
					totalCount
					nodes { oid }
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					path: options?.path,
					first: options?.first,
					last: options?.last,
					after: options?.after,
					before: options?.before,
					since: options?.since,
					until: options?.until,
				},
				scope,
			);
			const history = rsp?.repository?.object?.history;
			if (history == null) return undefined;

			return {
				pageInfo: history.pageInfo,
				totalCount: history.totalCount,
				values: history.nodes,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getNextCommitRefs']>({ args: { 0: '<token>' } })
	async getNextCommitRefs(
		token: string,
		owner: string,
		repo: string,
		ref: string,
		path: string,
		sha: string,
	): Promise<string[]> {
		// Get the commit date of the current commit
		const commitDate = await this.getCommitDate(token, owner, repo, sha);
		if (commitDate == null) return [];

		// Get a resultset (just need the cursor and totals), to get the page info we need to construct a cursor to page backwards
		let result = await this.getCommitRefs(token, owner, repo, ref, { path: path, first: 1, since: commitDate });
		if (result == null) return [];

		// Construct a cursor to allow use to walk backwards in time (starting at the tip going back in time until the commit date)
		const cursor = `${result.pageInfo.startCursor!.split(' ', 1)[0]} ${result.totalCount}`;

		let last;
		[, last] = cursor.split(' ', 2);
		// We can't ask for more commits than are left in the cursor (but try to get more to be safe, since the date isn't exact enough)
		last = Math.min(parseInt(last, 10), 5);

		// Get the set of refs before the cursor
		result = await this.getCommitRefs(token, owner, repo, ref, { path: path, last: last, before: cursor });
		if (result == null) return [];

		const nexts: string[] = [];

		for (const { oid } of result.values) {
			if (oid === sha) break;

			nexts.push(oid);
		}

		return nexts.reverse();
	}

	private async getCommitDate(token: string, owner: string, repo: string, sha: string): Promise<string | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						object: { committer: { date: string } } | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommitDate(
	$owner: String!
	$repo: String!
	$sha: GitObjectID!
) {
	repository(name: $repo, owner: $owner) {
		object(oid: $sha) {
			... on Commit { committer { date } }
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					sha: sha,
				},
				scope,
			);
			const date = rsp?.repository?.object?.committer.date;
			return date;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getContributors']>({ args: { 0: '<token>' } })
	async getContributors(token: string, owner: string, repo: string): Promise<GitHubContributor[]> {
		const scope = getLogScope();

		// TODO@eamodio implement pagination

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /repos/{owner}/{repo}/contributors',
				{
					owner: owner,
					repo: repo,
					per_page: 100,
				},
				scope,
			);

			const result = rsp?.data;
			if (result == null) return [];

			return rsp.data;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getDefaultBranchName']>({ args: { 0: '<token>' } })
	async getDefaultBranchName(token: string, owner: string, repo: string): Promise<string | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						defaultBranchRef: { name: string } | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getDefaultBranch(
	$owner: String!
	$repo: String!
) {
	repository(owner: $owner, name: $repo) {
		defaultBranchRef {
			name
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
				},
				scope,
			);
			if (rsp == null) return undefined;

			return rsp.repository?.defaultBranchRef?.name ?? undefined;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getCurrentUser']>({ args: { 0: '<token>' } })
	async getCurrentUser(token: string, owner: string, repo: string): Promise<GitUser | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			viewer: {
				name: string;
				email: string;
				login: string;
				id: string;
			};
			repository: { viewerPermission: string } | null | undefined;
		}

		try {
			const query = `query getCurrentUser(
	$owner: String!
	$repo: String!
) {
	viewer { name, email, login, id }
	repository(owner: $owner, name: $repo) { viewerPermission }
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
				},
				scope,
			);
			if (rsp == null) return undefined;

			return {
				name: rsp.viewer?.name,
				email: rsp.viewer?.email,
				username: rsp.viewer?.login,
				id: rsp.viewer?.id,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getRepositoryVisibility']>({ args: { 0: '<token>' } })
	async getRepositoryVisibility(
		token: string,
		owner: string,
		repo: string,
	): Promise<RepositoryVisibility | undefined> {
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getRepositoryVisibility(
	$owner: String!
	$repo: String!
) {
	repository(owner: $owner, name: $repo) {
		visibility
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
				},
				scope,
			);
			if (rsp?.repository?.visibility == null) return undefined;

			return rsp.repository.visibility === 'PUBLIC' ? RepositoryVisibility.Public : RepositoryVisibility.Private;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['getTags']>({ args: { 0: '<token>' } })
	async getTags(
		token: string,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubTag>> {
		const scope = getLogScope();

		interface QueryResult {
			repository:
				| {
						refs: {
							pageInfo: {
								endCursor: string;
								hasNextPage: boolean;
							};
							nodes: GitHubTag[];
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getTags(
	$owner: String!
	$repo: String!
	$tagQuery: String
	$cursor: String
	$limit: Int = 100
) {
	repository(owner: $owner, name: $repo) {
		refs(query: $tagQuery, refPrefix: "refs/tags/", first: $limit, after: $cursor, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
			pageInfo {
				endCursor
				hasNextPage
			}
			nodes {
				name
				target {
					oid
					...on Tag {
						message
						tagger { date }
						target {
					...on Commit {
								oid
						authoredDate
						committedDate
						message
					}
						}
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					tagQuery: options?.query,
					cursor: options?.cursor,
					limit: Math.min(100, options?.limit ?? 100),
				},
				scope,
			);
			if (rsp == null) return emptyPagedResult;

			const refs = rsp.repository?.refs;
			if (refs == null) return emptyPagedResult;

			return {
				paging: {
					cursor: refs.pageInfo.endCursor,
					more: refs.pageInfo.hasNextPage,
				},
				values: refs.nodes,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['resolveReference']>({ args: { 0: '<token>' } })
	async resolveReference(
		token: string,
		owner: string,
		repo: string,
		ref: string,
		path?: string,
	): Promise<string | undefined> {
		const scope = getLogScope();

		try {
			if (!path) {
				interface QueryResult {
					repository: { object: GitHubCommitRef } | null | undefined;
				}

				const query = `query resolveReference(
	$owner: String!
	$repo: String!
	$ref: String!
) {
	repository(owner: $owner, name: $repo) {
		object(expression: $ref) {
			oid
		}
	}
}`;

				const rsp = await this.graphql<QueryResult>(
					undefined,
					token,
					query,
					{
						owner: owner,
						repo: repo,
						ref: ref,
					},
					scope,
				);
				return rsp?.repository?.object?.oid ?? undefined;
			}

			interface QueryResult {
				repository:
					| {
							object: {
								history: {
									nodes: GitHubCommitRef[];
								};
							};
					  }
					| null
					| undefined;
			}

			const query = `query resolveReference(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String!
) {
	repository(owner: $owner, name: $repo) {
		object(expression: $ref) {
			... on Commit {
				history(first: 1, path: $path) {
					nodes { oid }
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					path: path,
				},
				scope,
			);
			return rsp?.repository?.object?.history.nodes?.[0]?.oid ?? undefined;
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['searchCommits']>({ args: { 0: '<token>' } })
	async searchCommits(
		token: string,
		query: string,
		options?: {
			cursor?: string;
			limit?: number;
			order?: 'asc' | 'desc' | undefined;
			sort?: 'author-date' | 'committer-date' | undefined;
		},
	): Promise<GitHubPagedResult<GitHubCommit> | undefined> {
		const scope = getLogScope();

		const limit = Math.min(100, options?.limit ?? 100);

		let page;
		let pageSize;
		let previousCount;
		if (options?.cursor != null) {
			[page, pageSize, previousCount] = options.cursor.split(' ', 3);
			page = parseInt(page, 10);
			// TODO@eamodio need to figure out how allow different page sizes if the limit changes
			pageSize = parseInt(pageSize, 10);
			previousCount = parseInt(previousCount, 10);
		} else {
			page = 1;
			pageSize = limit;
			previousCount = 0;
		}

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /search/commits',
				{
					q: query,
					sort: options?.sort,
					order: options?.order,
					per_page: pageSize,
					page: page,
				},
				scope,
			);

			const data = rsp?.data;
			if (data == null || data.items.length === 0) return undefined;

			const commits = data.items.map<GitHubCommit>(result => ({
				oid: result.sha,
				parents: { nodes: result.parents.map(p => ({ oid: p.sha! })) },
				message: result.commit.message,
				author: {
					avatarUrl: result.author?.avatar_url ?? undefined,
					date: result.commit.author?.date ?? result.commit.author?.date ?? new Date().toString(),
					email: result.author?.email ?? result.commit.author?.email ?? undefined,
					name: result.author?.name ?? result.commit.author?.name ?? '',
				},
				committer: {
					date: result.commit.committer?.date ?? result.committer?.date ?? new Date().toString(),
					email: result.committer?.email ?? result.commit.committer?.email ?? undefined,
					name: result.committer?.name ?? result.commit.committer?.name ?? '',
				},
			}));

			const count = previousCount + data.items.length;
			const hasMore = data.incomplete_results || data.total_count > count;

			return {
				pageInfo: {
					startCursor: `${page} ${pageSize} ${previousCount}`,
					endCursor: hasMore ? `${page + 1} ${pageSize} ${count}` : undefined,
					hasPreviousPage: data.total_count > 0 && page > 1,
					hasNextPage: hasMore,
				},
				totalCount: data.total_count,
				values: commits,
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['searchCommitShas']>({ args: { 0: '<token>' } })
	async searchCommitShas(
		token: string,
		query: string,
		options?: {
			cursor?: string;
			limit?: number;
			order?: 'asc' | 'desc' | undefined;
			sort?: 'author-date' | 'committer-date' | undefined;
		},
	): Promise<GitHubPagedResult<{ sha: string; authorDate: number; committerDate: number }> | undefined> {
		const scope = getLogScope();

		const limit = Math.min(100, options?.limit ?? 100);

		let page;
		let pageSize;
		let previousCount;
		if (options?.cursor != null) {
			[page, pageSize, previousCount] = options.cursor.split(' ', 3);
			page = parseInt(page, 10);
			// TODO@eamodio need to figure out how allow different page sizes if the limit changes
			pageSize = parseInt(pageSize, 10);
			previousCount = parseInt(previousCount, 10);
		} else {
			page = 1;
			pageSize = limit;
			previousCount = 0;
		}

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /search/commits',
				{
					q: query,
					sort: options?.sort,
					order: options?.order,
					per_page: pageSize,
					page: page,
				},
				scope,
			);

			const data = rsp?.data;
			if (data == null || data.items.length === 0) return undefined;

			const count = previousCount + data.items.length;
			const hasMore = data.incomplete_results || data.total_count > count;

			return {
				pageInfo: {
					startCursor: `${page} ${pageSize} ${previousCount}`,
					endCursor: hasMore ? `${page + 1} ${pageSize} ${count}` : undefined,
					hasPreviousPage: data.total_count > 0 && page > 1,
					hasNextPage: hasMore,
				},
				totalCount: data.total_count,
				values: data.items.map(r => ({
					sha: r.sha,
					authorDate: new Date(r.commit.author.date).getTime(),
					committerDate: new Date(r.commit.committer?.date ?? r.commit.author.date).getTime(),
				})),
			};
		} catch (ex) {
			if (ex instanceof ProviderRequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	private _enterpriseVersions = new Map<string, Version | null>();

	@debug<GitHubApi['getEnterpriseVersion']>({ args: { 0: '<token>' } })
	private async getEnterpriseVersion(
		provider: RichRemoteProvider | undefined,
		token: string,
		options?: { baseUrl?: string },
	): Promise<Version | undefined> {
		let version = this._enterpriseVersions.get(token);
		if (version != null) return version;
		if (version === null) return undefined;

		const scope = getLogScope();

		try {
			const rsp = await this.request(provider, token, 'GET /meta', options, scope);
			const v = (rsp?.data as any)?.installed_version as string | null | undefined;
			version = v ? fromString(v) : null;
		} catch (ex) {
			debugger;
			version = null;
		}

		this._enterpriseVersions.set(token, version);
		return version ?? undefined;
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
				defaults = Octokit.defaults({ auth: `token ${token}`, request: { agent: this.proxyAgent } });
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
		provider: RichRemoteProvider | undefined,
		token: string,
		query: string,
		variables: { [key: string]: any },
		scope: LogScope | undefined,
	): Promise<T | undefined> {
		try {
			return await wrapForForcedInsecureSSL(provider?.getIgnoreSSLErrors() ?? false, () =>
				this.octokit(token).graphql<T>(query, variables),
			);
		} catch (ex) {
			if (ex instanceof GraphqlResponseError) {
				switch (ex.errors?.[0]?.type) {
					case 'NOT_FOUND':
						throw new ProviderRequestNotFoundError(ex);
					case 'FORBIDDEN':
						throw new AuthenticationError('github', AuthenticationErrorReason.Forbidden, ex);
					case 'RATE_LIMITED': {
						let resetAt: number | undefined;

						const reset = ex.headers?.['x-ratelimit-reset'];
						if (reset != null) {
							resetAt = parseInt(reset, 10);
							if (Number.isNaN(resetAt)) {
								resetAt = undefined;
							}
						}

						throw new ProviderRequestRateLimitError(ex, token, resetAt);
					}
				}

				if (Logger.isDebugging) {
					void window.showErrorMessage(`GitHub request failed: ${ex.errors?.[0]?.message ?? ex.message}`);
				}
			} else if (ex instanceof RequestError) {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitHub request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private async request<R extends string>(
		provider: RichRemoteProvider | undefined,
		token: string,
		route: keyof Endpoints | R,
		options:
			| (R extends keyof Endpoints ? Endpoints[R]['parameters'] & RequestParameters : RequestParameters)
			| undefined,
		scope: LogScope | undefined,
	): Promise<R extends keyof Endpoints ? Endpoints[R]['response'] : OctokitResponse<unknown>> {
		try {
			return (await wrapForForcedInsecureSSL(provider?.getIgnoreSSLErrors() ?? false, () =>
				this.octokit(token).request<R>(route, options),
			)) as R extends keyof Endpoints ? Endpoints[R]['response'] : OctokitResponse<unknown>;
		} catch (ex) {
			if (ex instanceof RequestError) {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`GitHub request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(
		provider: RichRemoteProvider | undefined,
		token: string,
		ex: RequestError,
		scope: LogScope | undefined,
	): void {
		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new ProviderRequestNotFoundError(ex);
			// case 429: //Too Many Requests
			case 401: // Unauthorized
				throw new AuthenticationError('github', AuthenticationErrorReason.Unauthorized, ex);
			case 403: // Forbidden
				if (ex.message.includes('rate limit')) {
					let resetAt: number | undefined;

					const reset = ex.response?.headers?.['x-ratelimit-reset'];
					if (reset != null) {
						resetAt = parseInt(reset, 10);
						if (Number.isNaN(resetAt)) {
							resetAt = undefined;
						}
					}

					throw new ProviderRequestRateLimitError(ex, token, resetAt);
				}
				throw new AuthenticationError('github', AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				Logger.error(ex, scope);
				if (ex.response != null) {
					provider?.trackRequestException();
					void showIntegrationRequestFailed500WarningMessage(
						`${provider?.name ?? 'GitHub'} failed to respond and might be experiencing issues.${
							!provider?.custom
								? ' Please visit the [GitHub status page](https://githubstatus.com) for more information.'
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
					void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'GitHub');
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
				`GitHub request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}

	private handleException(ex: Error, provider: RichRemoteProvider | undefined, scope: LogScope | undefined): Error {
		Logger.error(ex, scope);
		// debugger;

		if (ex instanceof AuthenticationError) {
			void this.showAuthenticationErrorMessage(ex, provider);
		}
		return ex;
	}

	private async showAuthenticationErrorMessage(ex: AuthenticationError, provider: RichRemoteProvider | undefined) {
		if (ex.reason === AuthenticationErrorReason.Unauthorized || ex.reason === AuthenticationErrorReason.Forbidden) {
			const confirm = 'Reauthenticate';
			const result = await window.showErrorMessage(
				`${ex.message}. Would you like to try reauthenticating${
					ex.reason === AuthenticationErrorReason.Forbidden ? ' to provide additional access' : ''
				}?`,
				confirm,
			);

			if (result === confirm) {
				await provider?.reauthenticate();

				this._onDidReauthenticate.fire();
			}
		} else {
			void window.showErrorMessage(ex.message);
		}
	}

	private async createEnterpriseAvatarUrl(
		provider: RichRemoteProvider | undefined,
		token: string,
		baseUrl: string,
		email: string,
		avatarSize: number | undefined,
	): Promise<string | undefined> {
		avatarSize = avatarSize ?? 16;

		const version = await this.getEnterpriseVersion(provider, token, { baseUrl: baseUrl });
		if (satisfies(version, '>= 3.0.0')) {
			let url: string | undefined;

			const parts = getGitHubNoReplyAddressParts(email);
			if (parts != null) {
				if (Uri.parse(baseUrl).authority === parts.authority) {
					if (parts.userId != null) {
						url = `${baseUrl}/enterprise/avatars/u/${encodeURIComponent(parts.userId)}?s=${avatarSize}`;
					} else if (parts.login != null) {
						url = `${baseUrl}/enterprise/avatars/${encodeURIComponent(parts.login)}?s=${avatarSize}`;
					}
				}
			}

			if (url == null) {
				url = `${baseUrl}/enterprise/avatars/u/e?email=${encodeURIComponent(email)}&s=${avatarSize}`;
			}

			const rsp = await wrapForForcedInsecureSSL(provider?.getIgnoreSSLErrors() ?? false, () =>
				fetch(url!, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }),
			);

			if (rsp.ok) {
				const data = base64(new Uint8Array(await rsp.arrayBuffer()));
				const mimeType = rsp.headers.get('content-type');
				return `data:${mimeType};base64,${data}`;
			}
		}

		// The /u/e endpoint automatically falls back to gravatar if not found
		return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(email)}&s=${avatarSize}`;
	}

	@debug<GitHubApi['searchMyPullRequests']>({ args: { 0: p => p.name, 1: '<token>' } })
	async searchMyPullRequests(
		provider: RichRemoteProvider,
		token: string,
		options?: { search?: string; user?: string; repos?: string[] },
	): Promise<SearchedPullRequest[]> {
		const scope = getLogScope();

		interface SearchResult {
			related: {
				nodes: GitHubDetailedPullRequest[];
			};
			authored: {
				nodes: GitHubDetailedPullRequest[];
			};
			assigned: {
				nodes: GitHubDetailedPullRequest[];
			};
			reviewRequested: {
				nodes: GitHubDetailedPullRequest[];
			};
			mentioned: {
				nodes: GitHubDetailedPullRequest[];
			};
		}
		try {
			const query = `query searchPullRequests(
	$authored: String!
	$assigned: String!
	$reviewRequested: String!
	$mentioned: String!
) {
	authored: search(first: 100, query: $authored, type: ISSUE) {
		nodes {
			...on PullRequest {
				${prNodeProperties}
			}
		}
	}
	assigned: search(first: 100, query: $assigned, type: ISSUE) {
		nodes {
			...on PullRequest {
				${prNodeProperties}
			}
		}
	}
	reviewRequested: search(first: 100, query: $reviewRequested, type: ISSUE) {
		nodes {
			...on PullRequest {
				${prNodeProperties}
			}
		}
	}
	mentioned: search(first: 100, query: $mentioned, type: ISSUE) {
		nodes {
			...on PullRequest {
				${prNodeProperties}
			}
		}
	}
}`;

			let search = options?.search?.trim() ?? '';

			if (options?.user) {
				search += ` user:${options.user}`;
			}

			if (options?.repos != null && options.repos.length > 0) {
				const repo = '  repo:';
				search += `${repo}${options.repos.join(repo)}`;
			}

			const baseFilters = 'is:pr is:open archived:false';
			const resp = await this.graphql<SearchResult>(
				undefined,
				token,
				query,
				{
					authored: `${search} ${baseFilters} author:@me`.trim(),
					assigned: `${search} ${baseFilters} assignee:@me`.trim(),
					reviewRequested: `${search} ${baseFilters} review-requested:@me`.trim(),
					mentioned: `${search} ${baseFilters} mentions:@me`.trim(),
				},
				scope,
			);
			if (resp === undefined) return [];

			function toQueryResult(pr: GitHubDetailedPullRequest, reason?: string): SearchedPullRequest {
				return {
					pullRequest: fromGitHubPullRequestDetailed(pr, provider),
					reasons: reason ? [reason] : [],
				};
			}

			const results: SearchedPullRequest[] = uniqueWithReasons(
				[
					...resp.assigned.nodes.map(pr => toQueryResult(pr, 'assigned')),
					...resp.reviewRequested.nodes.map(pr => toQueryResult(pr, 'review-requested')),
					...resp.mentioned.nodes.map(pr => toQueryResult(pr, 'mentioned')),
					...resp.authored.nodes.map(pr => toQueryResult(pr, 'authored')),
				],
				r => r.pullRequest.url,
			);
			return results;
		} catch (ex) {
			throw this.handleException(ex, undefined, scope);
		}
	}

	@debug<GitHubApi['searchMyIssues']>({ args: { 0: '<token>' } })
	async searchMyIssues(
		provider: RichRemoteProvider,
		token: string,
		options?: { search?: string; user?: string; repos?: string[] },
	): Promise<SearchedIssue[] | undefined> {
		const scope = getLogScope();
		interface SearchResult {
			related: {
				nodes: GitHubIssueDetailed[];
			};
			authored: {
				nodes: GitHubIssueDetailed[];
			};
			assigned: {
				nodes: GitHubIssueDetailed[];
			};
			mentioned: {
				nodes: GitHubIssueDetailed[];
			};
		}

		const query = `query searchIssues(
				$authored: String!
				$assigned: String!
				$mentioned: String!
			) {
				authored: search(first: 100, query: $authored, type: ISSUE) {
					nodes {
						${issueNodeProperties}
					}
				}
				assigned: search(first: 100, query: $assigned, type: ISSUE) {
					nodes {
						${issueNodeProperties}
					}
				}
				mentioned: search(first: 100, query: $mentioned, type: ISSUE) {
					nodes {
						${issueNodeProperties}
					}
				}
			}`;

		let search = options?.search?.trim() ?? '';

		if (options?.user) {
			search += ` user:${options.user}`;
		}

		if (options?.repos != null && options.repos.length > 0) {
			const repo = '  repo:';
			search += `${repo}${options.repos.join(repo)}`;
		}

		const baseFilters = 'type:issue is:open archived:false';
		try {
			const resp = await this.graphql<SearchResult>(
				undefined,
				token,
				query,
				{
					authored: `${search} ${baseFilters} author:@me`.trim(),
					assigned: `${search} ${baseFilters} assignee:@me`.trim(),
					mentioned: `${search} ${baseFilters} mentions:@me`.trim(),
				},
				scope,
			);

			function toQueryResult(issue: GitHubIssueDetailed, reason?: string): SearchedIssue {
				return {
					issue: fromGitHubIssueDetailed(issue, provider),
					reasons: reason ? [reason] : [],
				};
			}

			if (resp === undefined) return [];

			const results: SearchedIssue[] = uniqueWithReasons(
				[
					...resp.assigned.nodes.map(pr => toQueryResult(pr, 'assigned')),
					...resp.mentioned.nodes.map(pr => toQueryResult(pr, 'mentioned')),
					...resp.authored.nodes.map(pr => toQueryResult(pr, 'authored')),
				],
				r => r.issue.url,
			);
			return results;
		} catch (ex) {
			throw this.handleException(ex, undefined, scope);
		}
	}
}

function isGitHubDotCom(options?: { baseUrl?: string }) {
	return options?.baseUrl == null || options.baseUrl === 'https://api.github.com';
}

function uniqueWithReasons<T extends { reasons: string[] }>(items: T[], lookup: (item: T) => unknown): T[] {
	return uniqueBy(items, lookup, (original, current) => {
		if (current.reasons.length !== 0) {
			original.reasons.push(...current.reasons);
		}
		return original;
	});
}
