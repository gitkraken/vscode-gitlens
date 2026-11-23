import { GraphqlResponseError } from '@octokit/graphql';
import type { RequestParameters } from '@octokit/types';
import { AuthenticationError, AuthenticationErrorReason, RequestNotFoundError } from '@gitlens/git/errors.js';
import type { PullRequestMergeMethod, PullRequestMergeQueueActionResult } from '@gitlens/git/models/pullRequest.js';
import { issueWriteFailure } from './issueWrites.js';

type MergeMethod = `${PullRequestMergeMethod}`;
export type GitHubPullRequestCreateTarget = { owner: string; repo: string };

export type GitHubPullRequestWriteTarget = GitHubPullRequestCreateTarget & { number: number; expectedNodeId: string };
export type GitHubPullRequestWrite =
	| (GitHubPullRequestCreateTarget & {
			action: 'create';
			title: string;
			body?: string;
			headRef: string;
			baseRef: string;
			expectedRepositoryId?: string;
	  })
	| (GitHubPullRequestWriteTarget &
			(
				| { action: 'edit'; title?: string; body?: string }
				| { action: 'set-state'; state: 'open' | 'closed' }
				| ({ expectedHeadSha: string; expectedBaseRef: string } & (
						| { action: 'merge'; mergeMethod: MergeMethod }
						| { action: 'enqueue' }
				  ))
			));

export type PullRequestWriteFailure = {
	ok: false;
	reason:
		| 'unsupported'
		| 'no-connection'
		| 'forbidden'
		| 'not-found'
		| 'invalid-input'
		| 'rate-limit'
		| 'blocked'
		| 'head-changed'
		| 'base-changed'
		| 'unknown'
		| 'outcome-unknown';
};

export type PullRequestWriteSnapshot = {
	owner: string;
	repo: string;
	number: number;
	nodeId: string;
	url: string;
	title: string;
	body: string;
	state: 'open' | 'closed' | 'merged';
	closedAt?: string;
	updatedAt?: string;
	headSha: string;
	baseRef: string;
};

export type PullRequestCreateCapabilityResult =
	| { ok: true; repositoryId: string; canCreate: boolean | undefined }
	| PullRequestWriteFailure;

type MergeCapability =
	| { kind: 'direct'; methods: MergeMethod[]; defaultMethod?: MergeMethod }
	| { kind: 'queue' }
	| { kind: 'unavailable'; reason: PullRequestWriteFailure['reason'] };

export type PullRequestWriteTargetResult =
	| {
			ok: true;
			pullRequest: PullRequestWriteSnapshot;
			capabilities: { edit: boolean; close: boolean; reopen: boolean; merge: MergeCapability };
	  }
	| PullRequestWriteFailure;

export type PullRequestWriteResult =
	| {
			ok: true;
			status: 'created' | 'updated' | 'closed' | 'reopened' | 'merged' | 'queued';
			pullRequest: PullRequestWriteSnapshot;
	  }
	| PullRequestWriteFailure;

type RepositoryIdentity = {
	id: string;
	owner: { login: string };
	name: string;
};

type RepositoryNode = RepositoryIdentity & {
	isArchived: boolean;
	isDisabled: boolean;
	isLocked: boolean;
	viewerPermission: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'MODERATE' | 'TRIAGE' | 'READ' | null;
};

type PullRequestNode = {
	id: string;
	number: number;
	url: string;
	title: string;
	body: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	closedAt: string | null;
	mergedAt: string | null;
	updatedAt: string;
	headRefOid: string;
	baseRefName: string;
	repository: RepositoryIdentity;
};

type WriteNode = PullRequestNode & {
	__typename: 'PullRequest';
	viewerCanUpdate: boolean;
	viewerCanClose: boolean;
	viewerCanReopen: boolean;
	isDraft: boolean;
	isInMergeQueue: boolean;
	isMergeQueueEnabled: boolean;
	stack: { id: string } | null;
	baseRef: { id: string } | null;
};

type MergeRepository = RepositoryNode & {
	mergeCommitAllowed: boolean;
	squashMergeAllowed: boolean;
	rebaseMergeAllowed: boolean;
	viewerDefaultMergeMethod: string;
};

type ResolvedPullRequest = { ok: true; node: WriteNode; repository: MergeRepository };
type GraphqlRequest = <T>(query: string, variables: RequestParameters) => Promise<T | undefined>;
type BranchRule = {
	type: string;
	parameters: { allowedMergeMethods?: readonly Uppercase<MergeMethod>[] | null } | null;
};

const repositoryIdentity = 'id owner { login } name';
const repositoryFields = `${repositoryIdentity} isArchived isDisabled isLocked viewerPermission`;
const pullRequestFields = `
	id number url title body state closedAt mergedAt updatedAt headRefOid baseRefName
	repository { ${repositoryIdentity} }
`;
const mergeMethods: readonly MergeMethod[] = ['merge', 'squash', 'rebase'];

function isValidRepository({ owner, repo }: GitHubPullRequestCreateTarget): boolean {
	return (
		typeof owner === 'string' &&
		/^[a-z\d_-]+$/i.test(owner) &&
		typeof repo === 'string' &&
		/^[a-z\d._-]+$/i.test(repo) &&
		repo !== '.' &&
		repo !== '..'
	);
}

function isValidTarget(input: GitHubPullRequestWriteTarget): boolean {
	return (
		isValidRepository(input) &&
		Number.isInteger(input.number) &&
		input.number >= 1 &&
		input.number <= 2147483647 &&
		typeof input.expectedNodeId === 'string' &&
		input.expectedNodeId.trim().length > 0
	);
}

function isBranchName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.trim() === value &&
		!value.includes(':') &&
		!value.startsWith('refs/') &&
		!value.startsWith('-')
	);
}

function isTitle(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isValidWrite(input: GitHubPullRequestWrite): boolean {
	if (input.action === 'create') {
		return (
			isValidRepository(input) &&
			isTitle(input.title) &&
			(input.body === undefined || typeof input.body === 'string') &&
			(input.expectedRepositoryId === undefined ||
				(typeof input.expectedRepositoryId === 'string' && input.expectedRepositoryId.trim().length > 0)) &&
			isBranchName(input.headRef) &&
			isBranchName(input.baseRef) &&
			input.headRef !== input.baseRef
		);
	}

	if (!isValidTarget(input)) return false;

	switch (input.action) {
		case 'edit':
			return (
				(input.title !== undefined || input.body !== undefined) &&
				(input.title === undefined || isTitle(input.title)) &&
				(input.body === undefined || typeof input.body === 'string')
			);
		case 'set-state':
			return input.state === 'open' || input.state === 'closed';
		case 'merge':
		case 'enqueue':
			return (
				(input.action === 'enqueue' || mergeMethods.includes(input.mergeMethod)) &&
				isBranchName(input.expectedBaseRef) &&
				typeof input.expectedHeadSha === 'string' &&
				/^[a-f\d]{40}$/i.test(input.expectedHeadSha)
			);
		default:
			return false;
	}
}

export function pullRequestWriteFailure(ex: unknown, phase?: 'write' | 'merge' | 'enqueue'): PullRequestWriteFailure {
	if (ex instanceof RequestNotFoundError) return { ok: false, reason: 'not-found' };
	if (ex instanceof AuthenticationError) {
		if (ex.reason === AuthenticationErrorReason.Forbidden) return { ok: false, reason: 'forbidden' };
		return { ok: false, reason: 'no-connection' };
	}

	const failure = issueWriteFailure(ex);
	if (failure.reason === 'rate-limit') return failure;

	if (phase === 'merge' || phase === 'enqueue') {
		const error = ex instanceof GraphqlResponseError ? ex.errors?.[0] : undefined;
		if (error?.type === 'UNPROCESSABLE') {
			if (/\b(?:expected head oid|head sha) does not match\b/i.test(error.message)) {
				return { ok: false, reason: 'head-changed' };
			}

			return { ok: false, reason: 'blocked' };
		}
	}

	return phase != null && failure.reason === 'unknown' ? { ok: false, reason: 'outcome-unknown' } : failure;
}

function hasWritePermission(repository: RepositoryNode): boolean | undefined {
	const { viewerPermission } = repository;
	return viewerPermission == null
		? undefined
		: viewerPermission === 'ADMIN' || viewerPermission === 'MAINTAIN' || viewerPermission === 'WRITE';
}

function isRepositoryWritable(repository: RepositoryNode): boolean {
	return !repository.isArchived && !repository.isDisabled && !repository.isLocked;
}

function sameRepository(a: GitHubPullRequestCreateTarget, b: RepositoryIdentity): boolean {
	return a.owner.toLowerCase() === b.owner.login.toLowerCase() && a.repo.toLowerCase() === b.name.toLowerCase();
}

function toSnapshot(node: PullRequestNode): PullRequestWriteSnapshot {
	const closedAt = node.state === 'MERGED' ? (node.mergedAt ?? node.closedAt) : node.closedAt;
	return {
		owner: node.repository.owner.login,
		repo: node.repository.name,
		number: node.number,
		nodeId: node.id,
		url: node.url,
		title: node.title,
		body: node.body,
		state: node.state === 'OPEN' ? 'open' : node.state === 'CLOSED' ? 'closed' : 'merged',
		...(node.state !== 'OPEN' && typeof closedAt === 'string' ? { closedAt: closedAt } : {}),
		...(typeof node.updatedAt === 'string' ? { updatedAt: node.updatedAt } : {}),
		headSha: node.headRefOid,
		baseRef: node.baseRefName,
	};
}

async function resolveNode(
	input: GitHubPullRequestWriteTarget,
	graphql: GraphqlRequest,
): Promise<ResolvedPullRequest | PullRequestWriteFailure> {
	const { owner, repo, expectedNodeId, number } = input;
	const result = await graphql<{ repository: MergeRepository | null; node: WriteNode | null }>(
		`query PullRequestWriteTarget($owner: String!, $repo: String!, $expectedNodeId: ID!) {
			repository(owner: $owner, name: $repo, followRenames: false) {
				${repositoryFields}
				mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod
			}
			node(id: $expectedNodeId) {
				__typename
				... on PullRequest {
					${pullRequestFields}
					viewerCanUpdate viewerCanClose viewerCanReopen
					isDraft isInMergeQueue isMergeQueueEnabled
					stack { id }
					baseRef { id }
				}
			}
		}`,
		{ owner: owner, repo: repo, expectedNodeId: expectedNodeId },
	);
	const repository = result?.repository;
	const node = result?.node;
	if (
		repository == null ||
		!sameRepository(input, repository) ||
		node?.__typename !== 'PullRequest' ||
		node.number !== number ||
		node.repository.id !== repository.id
	) {
		return { ok: false, reason: 'not-found' };
	}

	return { ok: true, node: node, repository: repository };
}

async function readBranchRules(
	refId: string,
	graphql: GraphqlRequest,
): Promise<{ rules: BranchRule[]; requiresLinearHistory: boolean } | undefined> {
	type Response = {
		node: {
			id: string;
			refUpdateRule: { requiresLinearHistory: boolean } | null;
			rules: {
				nodes: (BranchRule | null)[] | null;
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		} | null;
	};
	const rules: BranchRule[] = [];
	const seen = new Set<string>();
	let requiresLinearHistory = false;
	let cursor: string | undefined;
	for (;;) {
		const response = await graphql<Response>(
			`
				query PullRequestBranchRules($id: ID!, $cursor: String) {
					node(id: $id) {
						... on Ref {
							id
							refUpdateRule {
								requiresLinearHistory
							}
							rules(first: 100, after: $cursor) {
								nodes {
									type
									parameters {
										... on PullRequestParameters {
											allowedMergeMethods
										}
									}
								}
								pageInfo {
									hasNextPage
									endCursor
								}
							}
						}
					}
				}
			`,
			{ id: refId, cursor: cursor },
		);
		const ref = response?.node;
		const page = ref?.rules;
		if (ref?.id !== refId || page?.nodes == null) return undefined;

		requiresLinearHistory ||= ref.refUpdateRule?.requiresLinearHistory === true;

		for (const rule of page.nodes) {
			if (rule == null) return undefined;

			rules.push(rule);
		}

		if (!page.pageInfo.hasNextPage) return { rules: rules, requiresLinearHistory: requiresLinearHistory };

		const nextCursor = page.pageInfo.endCursor;
		if (nextCursor == null || seen.has(nextCursor)) return undefined;

		seen.add(nextCursor);
		cursor = nextCursor;
	}
}

async function getMergeCapability(
	{ node, repository }: ResolvedPullRequest,
	graphql: GraphqlRequest,
): Promise<MergeCapability> {
	if (
		!isRepositoryWritable(repository) ||
		node.state !== 'OPEN' ||
		node.isDraft ||
		node.isInMergeQueue ||
		node.baseRef == null
	) {
		return { kind: 'unavailable', reason: 'blocked' };
	}

	const canWrite = hasWritePermission(repository);
	if (canWrite !== true) return { kind: 'unavailable', reason: canWrite === false ? 'forbidden' : 'unknown' };
	if (node.stack != null) return { kind: 'unavailable', reason: 'unsupported' };
	if (node.isMergeQueueEnabled) return { kind: 'queue' };

	try {
		const branch = await readBranchRules(node.baseRef.id, graphql);
		if (branch == null) return { kind: 'unavailable', reason: 'unknown' };

		const { rules, requiresLinearHistory } = branch;
		if (rules.some(rule => rule.type === 'MERGE_QUEUE')) return { kind: 'queue' };

		const linearHistory = requiresLinearHistory || rules.some(rule => rule.type === 'REQUIRED_LINEAR_HISTORY');
		const methods = mergeMethods.filter(method => {
			const allowed =
				method === 'merge'
					? repository.mergeCommitAllowed && !linearHistory
					: method === 'squash'
						? repository.squashMergeAllowed
						: repository.rebaseMergeAllowed;
			return (
				allowed &&
				rules.every(rule => {
					const permitted = rule.type === 'PULL_REQUEST' ? rule.parameters?.allowedMergeMethods : undefined;
					return permitted == null || permitted.some(allowedMethod => allowedMethod.toLowerCase() === method);
				})
			);
		});
		if (methods.length === 0) return { kind: 'unavailable', reason: 'blocked' };

		const preference = repository.viewerDefaultMergeMethod.toLowerCase();
		const defaultMethod = methods.find(method => method === preference);
		return { kind: 'direct', methods: methods, defaultMethod: defaultMethod };
	} catch (ex) {
		return { kind: 'unavailable', reason: pullRequestWriteFailure(ex).reason };
	}
}

export async function resolveGitHubPullRequestWriteTarget(
	input: GitHubPullRequestWriteTarget,
	graphql: GraphqlRequest,
): Promise<PullRequestWriteTargetResult> {
	if (!isValidTarget(input)) return { ok: false, reason: 'invalid-input' };

	try {
		const resolved = await resolveNode(input, graphql);
		if (!resolved.ok) return resolved;

		const { node, repository } = resolved;
		const writable = isRepositoryWritable(repository);
		return {
			ok: true,
			pullRequest: toSnapshot(node),
			capabilities: {
				edit: writable && node.viewerCanUpdate,
				close: writable && node.state === 'OPEN' && node.viewerCanClose,
				reopen: writable && node.state === 'CLOSED' && node.viewerCanReopen,
				merge: await getMergeCapability(resolved, graphql),
			},
		};
	} catch (ex) {
		return pullRequestWriteFailure(ex);
	}
}

export async function getGitHubPullRequestCreateCapability(
	input: GitHubPullRequestCreateTarget,
	graphql: GraphqlRequest,
): Promise<PullRequestCreateCapabilityResult> {
	if (!isValidRepository(input)) return { ok: false, reason: 'invalid-input' };

	try {
		const result = await graphql<{ repository: RepositoryNode | null }>(
			`query PullRequestCreateCapability($owner: String!, $repo: String!) {
				repository(owner: $owner, name: $repo, followRenames: false) {
					${repositoryFields}
				}
			}`,
			{ owner: input.owner, repo: input.repo },
		);
		const repository = result?.repository;
		if (repository == null || !sameRepository(input, repository)) return { ok: false, reason: 'not-found' };

		return {
			ok: true,
			repositoryId: repository.id,
			// A repository role only establishes read access. GitHub checks the chosen head branch and organization
			// membership when the pull request is created.
			canCreate: isRepositoryWritable(repository) && (repository.viewerPermission == null ? undefined : true),
		};
	} catch (ex) {
		return pullRequestWriteFailure(ex);
	}
}

type WriteTransport = {
	graphql: GraphqlRequest;
	isSessionCurrent: () => Promise<boolean>;
	enqueue: (nodeId: string, headSha: string) => Promise<PullRequestMergeQueueActionResult>;
};

const mutations = {
	created: ['createPullRequest', 'CreatePullRequestInput'],
	updated: ['updatePullRequest', 'UpdatePullRequestInput'],
	closed: ['closePullRequest', 'ClosePullRequestInput'],
	reopened: ['reopenPullRequest', 'ReopenPullRequestInput'],
	merged: ['mergePullRequest', 'MergePullRequestInput'],
} as const;

async function sendMutation(
	transport: WriteTransport,
	status: keyof typeof mutations,
	repositoryId: string,
	values: Record<string, string | undefined>,
	previous?: PullRequestNode,
): Promise<PullRequestWriteResult> {
	if (!(await transport.isSessionCurrent())) return { ok: false, reason: 'no-connection' };

	const [mutation, inputType] = mutations[status];
	type Payload = { change: { pullRequest: PullRequestNode | null } | null };
	let node: PullRequestNode | null | undefined;
	try {
		const response = await transport.graphql<Payload>(
			`mutation WritePullRequest($input: ${inputType}!) {
				change: ${mutation}(input: $input) { pullRequest { ${pullRequestFields} } }
			}`,
			{ input: values },
		);
		node = response?.change?.pullRequest;
	} catch (ex) {
		if (ex instanceof GraphqlResponseError) {
			node = (ex.data as Payload | undefined)?.change?.pullRequest;
			if (node == null && ex.errors?.some(error => error.path?.[0] === 'change' && error.path.length > 1)) {
				return { ok: false, reason: 'outcome-unknown' };
			}
		}

		if (node == null) return pullRequestWriteFailure(ex, status === 'merged' ? 'merge' : 'write');
	}

	const expectedState =
		status === 'created' || status === 'reopened'
			? 'OPEN'
			: status === 'closed'
				? 'CLOSED'
				: status === 'merged'
					? 'MERGED'
					: undefined;
	if (
		node?.repository?.id !== repositoryId ||
		(previous != null && (node.id !== previous.id || node.number !== previous.number)) ||
		(expectedState != null && node.state !== expectedState) ||
		typeof node.repository.owner?.login !== 'string' ||
		typeof node.repository.name !== 'string' ||
		typeof node.id !== 'string' ||
		!Number.isInteger(node.number) ||
		typeof node.url !== 'string' ||
		typeof node.title !== 'string' ||
		typeof node.body !== 'string' ||
		typeof node.headRefOid !== 'string' ||
		typeof node.baseRefName !== 'string' ||
		(node.state !== 'OPEN' && node.state !== 'CLOSED' && node.state !== 'MERGED')
	) {
		return { ok: false, reason: 'outcome-unknown' };
	}

	return { ok: true, status: status, pullRequest: toSnapshot(node) };
}

async function createPullRequest(
	input: Extract<GitHubPullRequestWrite, { action: 'create' }>,
	transport: WriteTransport,
): Promise<PullRequestWriteResult> {
	type CreateRepository = RepositoryNode & { base: { id: string } | null; head: { id: string } | null };
	const result = await transport.graphql<{ repository: CreateRepository | null }>(
		`query PullRequestCreateTarget($owner: String!, $repo: String!, $base: String!, $head: String!) {
			repository(owner: $owner, name: $repo, followRenames: false) {
				${repositoryFields}
				base: ref(qualifiedName: $base) { id }
				head: ref(qualifiedName: $head) { id }
			}
		}`,
		{
			owner: input.owner,
			repo: input.repo,
			base: `refs/heads/${input.baseRef}`,
			head: `refs/heads/${input.headRef}`,
		},
	);
	const repository = result?.repository;
	if (
		repository == null ||
		!sameRepository(input, repository) ||
		(input.expectedRepositoryId != null && input.expectedRepositoryId !== repository.id)
	) {
		return { ok: false, reason: 'not-found' };
	}

	if (!isRepositoryWritable(repository)) return { ok: false, reason: 'blocked' };
	if (repository.base == null || repository.head == null) return { ok: false, reason: 'invalid-input' };

	return sendMutation(transport, 'created', repository.id, {
		repositoryId: repository.id,
		baseRefName: input.baseRef,
		headRefName: input.headRef,
		title: input.title,
		body: input.body,
	});
}

async function mergePullRequest(
	input: Extract<GitHubPullRequestWrite, { action: 'merge' | 'enqueue' }>,
	resolved: ResolvedPullRequest,
	transport: WriteTransport,
): Promise<PullRequestWriteResult> {
	const { node, repository } = resolved;
	if (node.headRefOid.toLowerCase() !== input.expectedHeadSha.toLowerCase()) {
		return { ok: false, reason: 'head-changed' };
	}

	if (node.baseRefName !== input.expectedBaseRef) return { ok: false, reason: 'base-changed' };

	const capability = await getMergeCapability(resolved, transport.graphql);
	if (capability.kind === 'unavailable') return { ok: false, reason: capability.reason };

	if (input.action === 'merge') {
		if (capability.kind !== 'direct' || !capability.methods.includes(input.mergeMethod)) {
			return { ok: false, reason: 'blocked' };
		}

		return sendMutation(
			transport,
			'merged',
			repository.id,
			{ pullRequestId: node.id, expectedHeadOid: node.headRefOid, mergeMethod: input.mergeMethod.toUpperCase() },
			node,
		);
	}

	if (capability.kind !== 'queue') return { ok: false, reason: 'blocked' };
	if (!(await transport.isSessionCurrent())) return { ok: false, reason: 'no-connection' };

	try {
		const result = await transport.enqueue(node.id, node.headRefOid);
		if (result.status === 'queued' && result.entry != null) {
			return { ok: true, status: 'queued', pullRequest: toSnapshot(node) };
		}

		if (result.status !== 'failed') return { ok: false, reason: 'outcome-unknown' };

		switch (result.reason) {
			case 'permission':
				return { ok: false, reason: 'forbidden' };
			case 'already-queued':
			case 'not-allowed':
				return { ok: false, reason: 'blocked' };
			case 'head-changed':
			case 'unsupported':
				return { ok: false, reason: result.reason };
			default:
				return { ok: false, reason: 'outcome-unknown' };
		}
	} catch (ex) {
		return pullRequestWriteFailure(ex, 'enqueue');
	}
}

export async function writeGitHubPullRequest(
	input: GitHubPullRequestWrite,
	transport: WriteTransport,
): Promise<PullRequestWriteResult> {
	if (!isValidWrite(input)) return { ok: false, reason: 'invalid-input' };

	try {
		if (input.action === 'create') return await createPullRequest(input, transport);

		const resolved = await resolveNode(input, transport.graphql);
		if (!resolved.ok) return resolved;

		const { node, repository } = resolved;
		if (!isRepositoryWritable(repository)) return { ok: false, reason: 'blocked' };
		if (input.action === 'merge' || input.action === 'enqueue') {
			return await mergePullRequest(input, resolved, transport);
		}

		if (input.action === 'edit') {
			if (!node.viewerCanUpdate) return { ok: false, reason: 'forbidden' };

			return await sendMutation(
				transport,
				'updated',
				repository.id,
				{ pullRequestId: node.id, title: input.title, body: input.body },
				node,
			);
		}

		const close = input.state === 'closed';
		if (node.state !== (close ? 'OPEN' : 'CLOSED')) return { ok: false, reason: 'blocked' };
		if (close ? !node.viewerCanClose : !node.viewerCanReopen) return { ok: false, reason: 'forbidden' };

		return await sendMutation(
			transport,
			close ? 'closed' : 'reopened',
			repository.id,
			{ pullRequestId: node.id },
			node,
		);
	} catch (ex) {
		return pullRequestWriteFailure(ex);
	}
}
