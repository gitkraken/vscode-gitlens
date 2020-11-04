'use strict';
import { graphql } from '@octokit/graphql';
import { Logger } from '../logger';
import { debug, Functions } from '../system';
import { AuthenticationError, IssueOrPullRequest, PullRequest, PullRequestState } from '../git/git';
import { Account } from '../git/models/author';

export class GitHubApi {
	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getAccountForCommit(
		provider: string,
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

		try {
			const query = `query ($owner: String!, $repo: String!, $ref: GitObjectID!, $avatarSize: Int) {
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

			const rsp = await graphql<{
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
			}>(query, {
				owner: owner,
				repo: repo,
				ref: ref,
				headers: { authorization: `Bearer ${token}` },
				...options,
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
			Logger.error(ex, cc);

			if (ex.code === 401) {
				throw new AuthenticationError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getAccountForEmail(
		provider: string,
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

		try {
			const query = `query ($emailQuery: String!, $avatarSize: Int) {
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

			const rsp = await graphql<{
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
			}>(query, {
				owner: owner,
				repo: repo,
				emailQuery: `in:email ${email}`,
				headers: { authorization: `Bearer ${token}` },
				...options,
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
			Logger.error(ex, cc);

			if (ex.code === 401) {
				throw new AuthenticationError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getIssueOrPullRequest(
		provider: string,
		token: string,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const query = `query pr($owner: String!, $repo: String!, $number: Int!) {
	repository(name: $repo, owner: $owner) {
		issueOrPullRequest(number: $number) {
			__typename
			... on Issue {
				createdAt
				closed
				closedAt
				title
			}
			... on PullRequest {
				createdAt
				closed
				closedAt
				title
			}
		}
	}
}`;

			const rsp = await graphql<{ repository?: { issueOrPullRequest?: GitHubIssueOrPullRequest } }>(query, {
				owner: owner,
				repo: repo,
				number: number,
				headers: { authorization: `Bearer ${token}` },
				...options,
			});

			const issue = rsp?.repository?.issueOrPullRequest;
			if (issue == null) return undefined;

			return {
				provider: provider,
				type: issue.type,
				id: number,
				date: new Date(issue.createdAt),
				title: issue.title,
				closed: issue.closed,
				closedDate: issue.closedAt == null ? undefined : new Date(issue.closedAt),
			};
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code === 401) {
				throw new AuthenticationError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getPullRequestForBranch(
		provider: string,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			include?: GitHubPullRequestState[];
			limit?: number;
		},
	): Promise<PullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const query = `query pr($owner: String!, $repo: String!, $branch: String!, $limit: Int!, $include: [PullRequestState!], $avatarSize: Int) {
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

			options = { limit: 1, ...options };

			const rsp = await graphql<{
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
			}>(query, {
				owner: owner,
				repo: repo,
				branch: branch,
				headers: { authorization: `Bearer ${token}` },
				...options,
			});

			const pr = rsp?.repository?.refs.nodes[0]?.associatedPullRequests?.nodes?.[0];
			if (pr == null) return undefined;
			// GitHub seems to sometimes return PRs for forks
			if (pr.repository.owner.login !== owner) return undefined;

			return GitHubPullRequest.from(pr, provider);
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code === 401) {
				throw new AuthenticationError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getPullRequestForCommit(
		provider: string,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<PullRequest | undefined> {
		if (ref === 'b44296e7c45a9e83530feb976f9f293a78457161') {
			await Functions.wait(5000);
			return new PullRequest(
				provider,
				{
					name: 'Eric Amodio',
					avatarUrl: `https://avatars1.githubusercontent.com/u/641685?s=${options?.avatarSize ?? 32}&v=4`,
					url: 'https://github.com/eamodio',
				},
				1,
				'Supercharged',
				'https://github.com/eamodio/vscode-gitlens/pulls/1',
				PullRequestState.Merged,
				new Date('Sat, 12 Nov 2016 19:41:00 GMT'),
				undefined,
				new Date('Sat, 12 Nov 2016 20:41:00 GMT'),
			);
		}

		const cc = Logger.getCorrelationContext();

		try {
			const query = `query pr($owner: String!, $repo: String!, $ref: GitObjectID!, $avatarSize: Int) {
	repository(name: $repo, owner: $owner) {
		object(oid: $ref) {
			... on Commit {
				associatedPullRequests(first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) {
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

			const rsp = await graphql<{
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
			}>(query, {
				owner: owner,
				repo: repo,
				ref: ref,
				headers: { authorization: `Bearer ${token}` },
				...options,
			});

			const pr = rsp?.repository?.object?.associatedPullRequests?.nodes?.[0];
			if (pr == null) return undefined;
			// GitHub seems to sometimes return PRs for forks
			if (pr.repository.owner.login !== owner) return undefined;

			return GitHubPullRequest.from(pr, provider);
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code === 401) {
				throw new AuthenticationError(ex);
			}
			throw ex;
		}
	}
}

interface GitHubIssueOrPullRequest {
	type: 'Issue' | 'PullRequest';
	number: number;
	createdAt: string;
	closed: boolean;
	closedAt: string | null;
	title: string;
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
		owner: {
			login: string;
		};
	};
}

export namespace GitHubPullRequest {
	export function from(pr: GitHubPullRequest, provider: string): PullRequest {
		return new PullRequest(
			provider,
			{
				name: pr.author.login,
				avatarUrl: pr.author.avatarUrl,
				url: pr.author.url,
			},
			pr.number,
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
