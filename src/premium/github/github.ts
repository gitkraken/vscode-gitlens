import { Octokit } from '@octokit/core';
import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';
import type { Endpoints, OctokitResponse, RequestParameters } from '@octokit/types';
import { Event, EventEmitter, window } from 'vscode';
import { fetch } from '@env/fetch';
import { isWeb } from '@env/platform';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ProviderRequestClientError,
	ProviderRequestNotFoundError,
} from '../../errors';
import { PagedResult, RepositoryVisibility } from '../../git/gitProvider';
import {
	type DefaultBranch,
	GitFileIndexStatus,
	GitRevision,
	type GitUser,
	type IssueOrPullRequest,
	type IssueOrPullRequestType,
	PullRequest,
	PullRequestState,
} from '../../git/models';
import type { Account } from '../../git/models/author';
import type { RichRemoteProvider } from '../../git/remotes/provider';
import { LogCorrelationContext, Logger, LogLevel } from '../../logger';
import { debug } from '../../system/decorators/log';
import { Stopwatch } from '../../system/stopwatch';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
const emptyBlameResult: GitHubBlame = Object.freeze({ ranges: [] });

export class GitHubApi {
	private readonly _onDidReauthenticate = new EventEmitter<void>();
	get onDidReauthenticate(): Event<void> {
		return this._onDidReauthenticate.event;
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
			return this.handleException(ex, cc, undefined);
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
			return this.handleException(ex, cc, undefined);
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
			return this.handleException(ex, cc, undefined);
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
			return this.handleException(ex, cc, undefined);
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
			return this.handleException(ex, cc, undefined);
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
			return this.handleException(ex, cc, undefined);
		}
	}

	@debug<GitHubApi['getBlame']>({ args: { 0: '<token>' } })
	async getBlame(token: string, owner: string, repo: string, ref: string, path: string): Promise<GitHubBlame> {
		const cc = Logger.getCorrelationContext();

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
			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				ref: ref,
				path: path,
			});
			if (rsp == null) return emptyBlameResult;

			const ranges = rsp.repository?.object?.blame?.ranges;
			if (ranges == null || ranges.length === 0) return { ranges: [], viewer: rsp.viewer?.name };

			return { ranges: ranges, viewer: rsp.viewer?.name };
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, emptyBlameResult);
		}
	}

	@debug<GitHubApi['getBranches']>({ args: { 0: '<token>' } })
	async getBranches(
		token: string,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubBranch>> {
		const cc = Logger.getCorrelationContext();

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
		refs(query: $branchQuery, refPrefix: "refs/heads/", first: $limit, after: $cursor, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
			pageInfo {
				endCursor
				hasNextPage
			}
			nodes {
				name
				target {
					oid
					commitUrl
					...on Commit {
						authoredDate
						committedDate
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				branchQuery: options?.query,
				cursor: options?.cursor,
				limit: Math.min(100, options?.limit ?? 100),
			});
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
			debugger;
			return this.handleException(ex, cc, emptyPagedResult);
		}
	}

	@debug<GitHubApi['getCommit']>({ args: { 0: '<token>' } })
	async getCommit(
		token: string,
		owner: string,
		repo: string,
		ref: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const rsp = await this.request(token, 'GET /repos/{owner}/{repo}/commits/{ref}', {
				owner: owner,
				repo: repo,
				ref: ref,
			});

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
			debugger;
			return this.handleException(ex, cc, undefined);
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
		if (GitRevision.isSha(ref)) return this.getCommit(token, owner, repo, ref);

		// TODO: optimize this -- only need to get the sha for the ref
		const results = await this.getCommits(token, owner, repo, ref, { limit: 1, path: path });
		if (results.values.length === 0) return undefined;

		const commit = await this.getCommit(token, owner, repo, results.values[0].oid);
		return { ...(commit ?? results.values[0]), viewer: results.viewer };
	}

	@debug<GitHubApi['getCommitBranches']>({ args: { 0: '<token>' } })
	async getCommitBranches(token: string, owner: string, repo: string, ref: string, date: Date): Promise<string[]> {
		const cc = Logger.getCorrelationContext();

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
		refs(first: 20, refPrefix: "refs/heads/", orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
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
			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				since: date.toISOString(),
				until: date.toISOString(),
			});

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
			debugger;
			return this.handleException<string[]>(ex, cc, []);
		}
	}

	@debug<GitHubApi['getCommitCount']>({ args: { 0: '<token>' } })
	async getCommitCount(token: string, owner: string, repo: string, ref: string): Promise<number | undefined> {
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				ref: ref,
			});

			const count = rsp?.repository?.ref?.target.history.totalCount;
			return count;
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
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
		const cc = Logger.getCorrelationContext();

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
			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				ref: `refs/heads/${branch}`,
				since: date.toISOString(),
				until: date.toISOString(),
			});

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
			debugger;
			return this.handleException<string[]>(ex, cc, []);
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
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
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
			});
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
			debugger;
			return this.handleException(ex, cc, emptyPagedResult);
		}
	}

	private async getCommitsCoreSingle(
		token: string,
		owner: string,
		repo: string,
		ref: string,
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }> {
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				ref: ref,
			});
			if (rsp == null) return emptyPagedResult;

			const commit = rsp.repository?.object;
			return commit != null ? { values: [commit], viewer: rsp.viewer.name } : emptyPagedResult;
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, emptyPagedResult);
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
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
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
			});
			const history = rsp?.repository?.object?.history;
			if (history == null) return undefined;

			return {
				pageInfo: history.pageInfo,
				totalCount: history.totalCount,
				values: history.nodes,
			};
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
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
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				sha: sha,
			});
			const date = rsp?.repository?.object?.committer.date;
			return date;
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
		}
	}

	@debug<GitHubApi['getContributors']>({ args: { 0: '<token>' } })
	async getContributors(token: string, owner: string, repo: string): Promise<GitHubContributor[]> {
		const cc = Logger.getCorrelationContext();

		// TODO@eamodio implement pagination

		try {
			const rsp = await this.request(token, 'GET /repos/{owner}/{repo}/contributors', {
				owner: owner,
				repo: repo,
				per_page: 100,
			});

			const result = rsp?.data;
			if (result == null) return [];

			return rsp.data;
		} catch (ex) {
			debugger;
			return this.handleException<GitHubContributor[]>(ex, cc, []);
		}
	}

	@debug<GitHubApi['getDefaultBranchName']>({ args: { 0: '<token>' } })
	async getDefaultBranchName(token: string, owner: string, repo: string): Promise<string | undefined> {
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
			});
			if (rsp == null) return undefined;

			return rsp.repository?.defaultBranchRef?.name ?? undefined;
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
		}
	}

	@debug<GitHubApi['getCurrentUser']>({ args: { 0: '<token>' } })
	async getCurrentUser(token: string, owner: string, repo: string): Promise<GitUser | undefined> {
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
			});
			if (rsp == null) return undefined;

			return {
				name: rsp.viewer?.name,
				email: rsp.viewer?.email,
				username: rsp.viewer?.login,
				id: rsp.viewer?.id,
			};
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
		}
	}

	@debug<GitHubApi['getRepositoryVisibility']>({ args: { 0: '<token>' } })
	async getRepositoryVisibility(
		token: string,
		owner: string,
		repo: string,
	): Promise<RepositoryVisibility | undefined> {
		const cc = Logger.getCorrelationContext();

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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
			});
			if (rsp?.repository?.visibility == null) return undefined;

			return rsp.repository.visibility === 'PUBLIC' ? RepositoryVisibility.Public : RepositoryVisibility.Private;
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
		}
	}

	@debug<GitHubApi['getTags']>({ args: { 0: '<token>' } })
	async getTags(
		token: string,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubTag>> {
		const cc = Logger.getCorrelationContext();

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
					commitUrl
					...on Commit {
						authoredDate
						committedDate
						message
					}
					...on Tag {
						message
						tagger { date }
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				tagQuery: options?.query,
				cursor: options?.cursor,
				limit: Math.min(100, options?.limit ?? 100),
			});
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
			debugger;
			return this.handleException(ex, cc, emptyPagedResult);
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
		const cc = Logger.getCorrelationContext();

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

				const rsp = await this.graphql<QueryResult>(token, query, {
					owner: owner,
					repo: repo,
					ref: ref,
				});
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

			const rsp = await this.graphql<QueryResult>(token, query, {
				owner: owner,
				repo: repo,
				ref: ref,
				path: path,
			});
			return rsp?.repository?.object?.history.nodes?.[0]?.oid ?? undefined;
		} catch (ex) {
			debugger;
			return this.handleException(ex, cc, undefined);
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
		const cc = Logger.getCorrelationContext();

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
			const rsp = await this.request(token, 'GET /search/commits', {
				q: query,
				sort: options?.sort,
				order: options?.order,
				per_page: pageSize,
				page: page,
			});

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
			debugger;
			return this.handleException(ex, cc, undefined);
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

	private async graphql<T>(token: string, query: string, variables: { [key: string]: any }): Promise<T | undefined> {
		try {
			return await this.octokit(token).graphql<T>(query, variables);
		} catch (ex) {
			if (ex instanceof GraphqlResponseError) {
				switch (ex.errors?.[0]?.type) {
					case 'NOT_FOUND':
						throw new ProviderRequestNotFoundError(ex);
					case 'FORBIDDEN':
						throw new AuthenticationError('github', AuthenticationErrorReason.Forbidden, ex);
				}

				void window.showErrorMessage(`GitHub request failed: ${ex.errors?.[0]?.message ?? ex.message}`, 'OK');
			} else if (ex instanceof RequestError) {
				this.handleRequestError(ex);
			} else {
				void window.showErrorMessage(`GitHub request failed: ${ex.message}`, 'OK');
			}

			throw ex;
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
			if (ex instanceof RequestError) {
				this.handleRequestError(ex);
			} else {
				void window.showErrorMessage(`GitHub request failed: ${ex.message}`, 'OK');
			}

			throw ex;
		}
	}

	private handleRequestError(ex: RequestError): void {
		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new ProviderRequestNotFoundError(ex);
			// case 429: //Too Many Requests
			case 401: // Unauthorized
				throw new AuthenticationError('github', AuthenticationErrorReason.Unauthorized, ex);
			case 403: // Forbidden
				throw new AuthenticationError('github', AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				if (ex.response != null) {
					void window.showErrorMessage(
						'GitHub failed to respond and might be experiencing issues. Please visit the [GitHub status page](https://githubstatus.com) for more information.',
						'OK',
					);
				}
				break;
			case 502: // Bad Gateway
				// GitHub seems to return this status code for timeouts
				if (ex.message.includes('timeout')) {
					void window.showErrorMessage('GitHub request timed out', 'OK');
					return;
				}
				break;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new ProviderRequestClientError(ex);
				break;
		}

		void window.showErrorMessage(
			`GitHub request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			'OK',
		);
	}

	private handleException<T>(ex: unknown | Error, cc: LogCorrelationContext | undefined, defaultValue: T): T {
		if (ex instanceof ProviderRequestNotFoundError) return defaultValue;

		Logger.error(ex, cc);
		debugger;

		if (ex instanceof AuthenticationError) {
			void this.showAuthenticationErrorMessage(ex);
		}
		throw ex;
	}

	private async showAuthenticationErrorMessage(ex: AuthenticationError) {
		if (ex.reason === AuthenticationErrorReason.Unauthorized || ex.reason === AuthenticationErrorReason.Forbidden) {
			const confirm = 'Reauthenticate';
			const result = await window.showErrorMessage(
				`${ex.message}. Would you like to try reauthenticating${
					ex.reason === AuthenticationErrorReason.Forbidden ? ' to provide additional access' : ''
				}?`,
				confirm,
			);

			if (result === confirm) {
				this._onDidReauthenticate.fire();
			}
		} else {
			void window.showErrorMessage(ex.message, 'OK');
		}
	}
}

export interface GitHubBlame {
	ranges: GitHubBlameRange[];
	viewer?: string;
}

export interface GitHubBlameRange {
	startingLine: number;
	endingLine: number;
	commit: GitHubCommit;
}

export interface GitHubBranch {
	name: string;
	target: {
		oid: string;
		commitUrl: string;
		authoredDate: string;
		committedDate: string;
	};
}

export interface GitHubCommit {
	oid: string;
	parents: { nodes: { oid: string }[] };
	message: string;
	additions?: number | undefined;
	changedFiles?: number | undefined;
	deletions?: number | undefined;
	author: { avatarUrl: string | undefined; date: string; email: string | undefined; name: string };
	committer: { date: string; email: string | undefined; name: string };

	files?: Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files'];
}

export interface GitHubCommitRef {
	oid: string;
}

export type GitHubContributor = Endpoints['GET /repos/{owner}/{repo}/contributors']['response']['data'][0];

interface GitHubIssueOrPullRequest {
	type: IssueOrPullRequestType;
	number: number;
	createdAt: string;
	closed: boolean;
	closedAt: string | null;
	title: string;
	url: string;
}

export interface GitHubPagedResult<T> {
	pageInfo: GitHubPageInfo;
	totalCount: number;
	values: T[];
}

interface GitHubPageInfo {
	startCursor?: string | null;
	endCursor?: string | null;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
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

export interface GitHubTag {
	name: string;
	target: {
		oid: string;
		commitUrl: string;
		authoredDate: string;
		committedDate: string;
		message?: string | null;
		tagger?: {
			date: string;
		} | null;
	};
}

export function fromCommitFileStatus(
	status: NonNullable<Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files']>[0]['status'],
): GitFileIndexStatus | undefined {
	switch (status) {
		case 'added':
			return GitFileIndexStatus.Added;
		case 'changed':
		case 'modified':
			return GitFileIndexStatus.Modified;
		case 'removed':
			return GitFileIndexStatus.Deleted;
		case 'renamed':
			return GitFileIndexStatus.Renamed;
		case 'copied':
			return GitFileIndexStatus.Copied;
	}
	return undefined;
}
