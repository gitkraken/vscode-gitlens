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
			const query = `query pr($owner: String!, $repo: String!, $sha: String!) {
	repository(name: $repo, owner: $owner) {
		object(expression: $sha) {
			... on Commit {
				associatedPullRequests(first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) {
					nodes {
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
				repository?: {
					object?: {
						associatedPullRequests?: {
							nodes?: GitHubPullRequest[];
						};
					};
				};
			}>(query, {
				owner: owner,
				repo: repo,
				sha: ref,
				headers: { authorization: `Bearer ${token}` },
				...options,
			});

			const pr = rsp?.repository?.object?.associatedPullRequests?.nodes?.[0];
			if (pr == null) return undefined;
			// GitHub seems to sometimes return PRs for forks
			if (pr.repository.owner.login !== owner) return undefined;

			return new PullRequest(
				provider,
				pr.number,
				pr.title,
				pr.permalink,
				pr.state === 'MERGED'
					? PullRequestState.Merged
					: pr.state === 'CLOSED'
					? PullRequestState.Closed
					: PullRequestState.Open,
				new Date(pr.updatedAt),
				pr.closedAt == null ? undefined : new Date(pr.closedAt),
				pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
			);
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

interface GitHubPullRequest {
	permalink: string;
	number: number;
	title: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	repository: {
		owner: {
			login: string;
		};
	};
}
