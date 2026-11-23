import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';
import type { RequestParameters } from '@octokit/types';
import { RequestRateLimitError } from '@gitlens/git/errors.js';

type GitHubIssueWriteTarget = { owner: string; repo: string };

export type GitHubIssueDelete = GitHubIssueWriteTarget & { number: number; expectedNodeId: string };

export type GitHubIssueWrite =
	| (GitHubIssueWriteTarget & { action: 'create'; title: string; body?: string })
	| (GitHubIssueDelete &
			(
				| { action: 'edit'; title?: string; body?: string }
				| { action: 'set-state'; state: 'open' }
				| { action: 'set-state'; state: 'closed'; reason: 'completed' | 'not_planned' }
			));

export type IssueWriteResult =
	| {
			ok: true;
			issue: {
				owner: string;
				repo: string;
				number: number;
				nodeId: string;
				url: string;
				title: string;
				body: string;
				state: 'open' | 'closed';
			};
			deletedFromDifferentRepository?: true;
	  }
	| {
			ok: false;
			reason:
				| 'unsupported'
				| 'no-connection'
				| 'forbidden'
				| 'not-found'
				| 'invalid-input'
				| 'rate-limit'
				| 'unknown';
	  };

export type GitHubIssueMutation =
	| GitHubIssueWrite
	| (GitHubIssueDelete & { action: 'delete' })
	| (GitHubIssueDelete & { action: 'resolve'; intent?: 'delete' });
type GraphqlRequest = <T>(query: string, variables: RequestParameters) => Promise<T | undefined>;

const issueFields = `
	id number url title body state
	repository { id owner { login } name }
`;

type IssueNode = {
	id: string;
	number: number;
	url: string;
	title: string;
	body: string;
	state: 'OPEN' | 'CLOSED';
	repository: { id: string; owner: { login: string }; name: string };
};

type RepositoryNode = {
	id: string;
	hasIssuesEnabled: boolean;
	isArchived: boolean;
};

type WriteTarget = {
	repository: RepositoryNode | null;
	node?: (IssueNode & { __typename: string; viewerCanDelete?: boolean }) | null;
};

export function isValidGitHubIssueMutation(input: GitHubIssueMutation): boolean {
	if (
		typeof input.owner !== 'string' ||
		!/^[a-z\d_-]+$/i.test(input.owner) ||
		typeof input.repo !== 'string' ||
		!/^[a-z\d._-]+$/i.test(input.repo) ||
		input.repo === '.' ||
		input.repo === '..'
	) {
		return false;
	}

	if (
		input.action !== 'create' &&
		(!Number.isInteger(input.number) ||
			input.number < 1 ||
			input.number > 2147483647 ||
			typeof input.expectedNodeId !== 'string' ||
			!input.expectedNodeId.trim())
	) {
		return false;
	}

	switch (input.action) {
		case 'create':
			return isIssueTitle(input.title) && (input.body === undefined || typeof input.body === 'string');
		case 'edit':
			return (
				(input.title !== undefined || input.body !== undefined) &&
				(input.title === undefined || isIssueTitle(input.title)) &&
				(input.body === undefined || typeof input.body === 'string')
			);
		case 'set-state':
			return (
				input.state === 'open' ||
				(input.state === 'closed' && (input.reason === 'completed' || input.reason === 'not_planned'))
			);
		case 'delete':
			return true;
		case 'resolve':
			return input.intent === undefined || input.intent === 'delete';
		default:
			return false;
	}
}

function isIssueTitle(title: unknown): title is string {
	return typeof title === 'string' && title.trim().length > 0;
}

export function issueWriteFailure(ex: unknown): Extract<IssueWriteResult, { ok: false }> {
	if (RequestRateLimitError.is(ex)) return { ok: false, reason: 'rate-limit' };

	if (ex instanceof GraphqlResponseError) {
		if (ex.errors?.some(error => error.type === 'RATE_LIMIT' || error.type === 'RATE_LIMITED')) {
			return { ok: false, reason: 'rate-limit' };
		}

		switch (ex.errors?.[0]?.type) {
			case 'NOT_FOUND':
				return { ok: false, reason: 'not-found' };
			case 'FORBIDDEN':
			case 'INSUFFICIENT_SCOPES':
				return { ok: false, reason: 'forbidden' };
			case 'BAD_USER_INPUT':
			case 'UNPROCESSABLE':
				return { ok: false, reason: 'invalid-input' };
		}
	}

	if (ex instanceof RequestError) {
		switch (ex.status) {
			case 400:
			case 422:
				return { ok: false, reason: 'invalid-input' };
			case 401:
				return { ok: false, reason: 'no-connection' };
			case 403:
				return {
					ok: false,
					reason: ex.message.toLowerCase().includes('rate limit') ? 'rate-limit' : 'forbidden',
				};
			case 404:
			case 410:
				return { ok: false, reason: 'not-found' };
			case 429:
				return { ok: false, reason: 'rate-limit' };
		}
	}

	return { ok: false, reason: 'unknown' };
}

export async function mutateGitHubIssue(
	input: GitHubIssueMutation,
	graphql: GraphqlRequest,
): Promise<IssueWriteResult> {
	try {
		const { owner, repo } = input;
		const target =
			input.action === 'create'
				? await graphql<WriteTarget>(
						`
							query IssueCreateTarget($owner: String!, $repo: String!) {
								repository(owner: $owner, name: $repo, followRenames: false) {
									id
									hasIssuesEnabled
									isArchived
								}
							}
						`,
						{ owner: owner, repo: repo },
					)
				: await graphql<WriteTarget>(
						`query IssueWriteTarget($owner: String!, $repo: String!, $expectedNodeId: ID!, $checkDelete: Boolean!) {
							repository(owner: $owner, name: $repo, followRenames: false) {
								id hasIssuesEnabled isArchived
							}
							node(id: $expectedNodeId) {
								__typename
								... on Issue {
									${issueFields}
									viewerCanDelete @include(if: $checkDelete)
								}
							}
						}`,
						{
							owner: owner,
							repo: repo,
							expectedNodeId: input.expectedNodeId,
							checkDelete:
								input.action === 'delete' || (input.action === 'resolve' && input.intent === 'delete'),
						},
					);
		const repository = target?.repository;
		if (repository == null) return { ok: false, reason: 'not-found' };
		if (repository.isArchived) return { ok: false, reason: 'forbidden' };
		if (!repository.hasIssuesEnabled) return { ok: false, reason: 'unsupported' };

		if (input.action === 'create') {
			return await writeIssue(graphql, 'createIssue', 'CreateIssueInput', {
				repositoryId: repository.id,
				title: input.title,
				body: input.body,
			});
		}

		const issue = target?.node;
		if (
			issue?.__typename !== 'Issue' ||
			issue.number !== input.number ||
			issue.repository.id !== repository.id ||
			issue.repository.owner.login.toLowerCase() !== owner.toLowerCase() ||
			issue.repository.name.toLowerCase() !== repo.toLowerCase()
		) {
			return { ok: false, reason: 'not-found' };
		}

		switch (input.action) {
			case 'resolve':
				if (input.intent === 'delete' && issue.viewerCanDelete !== true) {
					return { ok: false, reason: 'forbidden' };
				}
				return toIssueWriteResult(issue);
			case 'edit':
				return await writeIssue(graphql, 'updateIssue', 'UpdateIssueInput', {
					id: issue.id,
					title: input.title,
					body: input.body,
				});
			case 'set-state':
				return input.state === 'open'
					? await writeIssue(graphql, 'reopenIssue', 'ReopenIssueInput', { issueId: issue.id })
					: await writeIssue(graphql, 'closeIssue', 'CloseIssueInput', {
							issueId: issue.id,
							stateReason: input.reason === 'completed' ? 'COMPLETED' : 'NOT_PLANNED',
						});
			case 'delete': {
				if (issue.viewerCanDelete !== true) return { ok: false, reason: 'forbidden' };

				const result = await graphql<{ deleteIssue: { repository: { id: string } | null } | null }>(
					`
						mutation DeleteIssue($issueId: ID!) {
							deleteIssue(input: { issueId: $issueId }) {
								repository {
									id
								}
							}
						}
					`,
					{ issueId: issue.id },
				);
				const deletedRepositoryId = result?.deleteIssue?.repository?.id;
				return typeof deletedRepositoryId === 'string' && deletedRepositoryId.length > 0
					? toIssueWriteResult(issue, deletedRepositoryId !== repository.id)
					: { ok: false, reason: 'unknown' };
			}
		}
	} catch (ex) {
		return issueWriteFailure(ex);
	}
}

async function writeIssue(
	graphql: GraphqlRequest,
	mutation: 'createIssue' | 'updateIssue' | 'closeIssue' | 'reopenIssue',
	inputType: string,
	input: Record<string, string | undefined>,
): Promise<IssueWriteResult> {
	const result = await graphql<{ change: { issue: IssueNode | null } | null }>(
		`mutation WriteIssue($input: ${inputType}!) {
			change: ${mutation}(input: $input) { issue { ${issueFields} } }
		}`,
		{ input: input },
	);
	return result?.change?.issue != null ? toIssueWriteResult(result.change.issue) : { ok: false, reason: 'unknown' };
}

function toIssueWriteResult(issue: IssueNode, deletedFromDifferentRepository = false): IssueWriteResult {
	return {
		ok: true,
		...(deletedFromDifferentRepository && { deletedFromDifferentRepository: true }),
		issue: {
			owner: issue.repository.owner.login,
			repo: issue.repository.name,
			number: issue.number,
			nodeId: issue.id,
			url: issue.url,
			title: issue.title,
			body: issue.body,
			state: issue.state === 'CLOSED' ? 'closed' : 'open',
		},
	};
}
