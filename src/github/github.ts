'use strict';
import { graphql } from '@octokit/graphql';
import { Logger } from '../logger';
import { debug } from '../system';
import { AuthenticationError, IssueOrPullRequest, PullRequest, PullRequestState } from '../git/git';

export class GitHubApi {
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
			const query = `query pr($owner: String!, $repo: String!, $branch: String!, $limit: Int!, $states: [PullRequestState!], $avatarSize: Int) {
	repository(name: $repo, owner: $owner) {
		refs(query: $branch, refPrefix: "refs/heads/", first: 1) {
			nodes {
				associatedPullRequests(first: $limit, orderBy: {field: UPDATED_AT, direction: DESC}, states: $states) {
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
				limit: options?.limit ?? 1,
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
		},
	): Promise<PullRequest | undefined> {
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
