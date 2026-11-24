import { RequestError } from '@octokit/request-error';
import type { RequestParameters } from '@octokit/types';
import type { GitHubPullRequestCreateTarget, PullRequestWriteFailure } from './pullRequestWrites.js';

export type GraphqlRequest = <T>(query: string, variables: RequestParameters) => Promise<T | undefined>;
export type BranchRule = {
	type: string;
	parameters?: { allowedMergeMethods?: readonly string[] | null } | null;
};
export type BranchPolicy = { rules: BranchRule[]; requiresLinearHistory: boolean };

export type EnterprisePullRequestWriteOptions = {
	origin: string;
	readBranchRules: (target: GitHubPullRequestCreateTarget, branch: string) => Promise<unknown[] | undefined>;
};

type MergePolicy =
	| BranchPolicy
	| { kind: 'queue' }
	| { kind: 'unavailable'; reason: PullRequestWriteFailure['reason'] };

export async function readEnterprisePullRequestMergePolicy(
	{ id, baseRef, baseRefId }: { id: string; baseRef: string; baseRefId: string },
	repository: GitHubPullRequestCreateTarget,
	graphql: GraphqlRequest,
	readBranchRules: EnterprisePullRequestWriteOptions['readBranchRules'],
): Promise<MergePolicy> {
	const schema = await readEnterpriseMergeSchema(graphql);
	if (schema == null) return { kind: 'unavailable', reason: 'unknown' };
	if (schema.hasQueue && !schema.queueFields) return { kind: 'unavailable', reason: 'unknown' };

	if (schema.queueFields || schema.stack) {
		const result = await graphql<{
			node: {
				id: string;
				baseRefName: string;
				baseRef: { id: string } | null;
				isInMergeQueue?: boolean;
				isMergeQueueEnabled?: boolean;
				stack?: { id: string } | null;
			} | null;
		}>(
			`query PullRequestMergeFeatures($id: ID!) {
				node(id: $id) {
					... on PullRequest {
						id baseRefName baseRef { id }
						${schema.queueFields ? 'isInMergeQueue isMergeQueueEnabled' : ''}
						${schema.stack ? 'stack { id }' : ''}
					}
				}
			}`,
			{ id: id },
		);
		const current = result?.node;
		if (
			current?.id !== id ||
			current.baseRefName !== baseRef ||
			current.baseRef?.id !== baseRefId ||
			(schema.queueFields &&
				(typeof current.isInMergeQueue !== 'boolean' || typeof current.isMergeQueueEnabled !== 'boolean')) ||
			(schema.stack && current.stack === undefined)
		) {
			return { kind: 'unavailable', reason: 'unknown' };
		}

		if (current.isInMergeQueue) return { kind: 'unavailable', reason: 'blocked' };
		if (current.stack != null) return { kind: 'unavailable', reason: 'unsupported' };
		if (current.isMergeQueueEnabled) return enterpriseQueueCapability(schema.canEnqueue);
	}

	const activeRules = normalizeEnterpriseBranchRules(
		await readBranchRules(repository, baseRef).catch((ex: unknown) => {
			if (ex instanceof RequestError && ex.status === 404) return undefined;

			throw ex;
		}),
	);
	if (activeRules == null) return { kind: 'unavailable', reason: 'unknown' };
	if (activeRules.some(rule => rule.type === 'MERGE_QUEUE')) {
		return enterpriseQueueCapability(schema.queueFields && schema.canEnqueue);
	}

	if (!schema.canMerge || !schema.linearHistory) return { kind: 'unavailable', reason: 'unsupported' };

	const response = await graphql<{
		node: { id: string; refUpdateRule: { requiresLinearHistory: boolean } | null } | null;
	}>(
		`
			query PullRequestLegacyBranchRule($id: ID!) {
				node(id: $id) {
					... on Ref {
						id
						refUpdateRule {
							requiresLinearHistory
						}
					}
				}
			}
		`,
		{ id: baseRefId },
	);
	const ref = response?.node;
	if (
		ref?.id !== baseRefId ||
		(ref.refUpdateRule !== null && typeof ref.refUpdateRule?.requiresLinearHistory !== 'boolean')
	) {
		return { kind: 'unavailable', reason: 'unknown' };
	}

	return {
		rules: activeRules,
		requiresLinearHistory: ref.refUpdateRule?.requiresLinearHistory === true,
	};
}

function normalizeEnterpriseBranchRules(data: unknown[] | undefined): BranchRule[] | undefined {
	if (data == null) return undefined;

	const rules: BranchRule[] = [];
	for (const value of data) {
		const rule = value as { type?: unknown; parameters?: { allowed_merge_methods?: unknown } } | null;
		if (typeof rule?.type !== 'string' || !rule.type) return undefined;

		const type = rule.type.toUpperCase();
		const parameters = type === 'PULL_REQUEST' ? rule.parameters : undefined;
		if (parameters != null && (typeof parameters !== 'object' || Array.isArray(parameters))) return undefined;

		const methods = parameters?.allowed_merge_methods;
		if (methods == null) {
			rules.push({ type: type });
		} else if (Array.isArray(methods) && methods.every(method => typeof method === 'string')) {
			rules.push({ type: type, parameters: { allowedMergeMethods: methods } });
		} else {
			return undefined;
		}
	}
	return rules;
}

function enterpriseQueueCapability(supported: boolean): MergePolicy {
	return supported ? { kind: 'queue' } : { kind: 'unavailable', reason: 'unsupported' };
}

async function readEnterpriseMergeSchema(graphql: GraphqlRequest) {
	type Member = { name: string };
	type Response = {
		mutation: { fields: Member[] } | null;
		pr: { fields: Member[] } | null;
		ref: { fields: Member[] } | null;
		legacy: { fields: Member[] } | null;
		enqueue: { inputFields: Member[] } | null;
		enqueuePayload: { fields: Member[] } | null;
		entry: { fields: Member[] } | null;
		merge: { inputFields: Member[] } | null;
	};
	const [operations, branch, queue] = await Promise.all([
		graphql<Pick<Response, 'mutation' | 'pr' | 'enqueue' | 'merge'>>(
			`
				query PullRequestMergeSchemaOperations {
					mutation: __type(name: "Mutation") {
						fields {
							name
						}
					}
					pr: __type(name: "PullRequest") {
						fields {
							name
						}
					}
					enqueue: __type(name: "EnqueuePullRequestInput") {
						inputFields {
							name
						}
					}
					merge: __type(name: "MergePullRequestInput") {
						inputFields {
							name
						}
					}
				}
			`,
			{},
		),
		graphql<Pick<Response, 'ref' | 'legacy'>>(
			`
				query PullRequestMergeSchemaBranch {
					ref: __type(name: "Ref") {
						fields {
							name
						}
					}
					legacy: __type(name: "RefUpdateRule") {
						fields {
							name
						}
					}
				}
			`,
			{},
		),
		graphql<Pick<Response, 'enqueuePayload' | 'entry'>>(
			`
				query PullRequestMergeSchemaQueue {
					enqueuePayload: __type(name: "EnqueuePullRequestPayload") {
						fields {
							name
						}
					}
					entry: __type(name: "MergeQueueEntry") {
						fields {
							name
						}
					}
				}
			`,
			{},
		),
	]);
	if (
		!Array.isArray(operations?.mutation?.fields) ||
		!Array.isArray(operations.pr?.fields) ||
		operations.enqueue === undefined ||
		operations.merge === undefined ||
		branch?.ref === undefined ||
		branch.legacy === undefined ||
		queue?.enqueuePayload === undefined ||
		queue.entry === undefined
	) {
		return undefined;
	}

	const has = (members: Member[] | undefined, ...names: string[]) =>
		names.every(name => members?.some(member => member.name === name) === true);
	const hasEnqueue = has(operations.mutation.fields, 'enqueuePullRequest');
	return {
		stack: has(operations.pr.fields, 'stack'),
		queueFields: has(operations.pr.fields, 'isInMergeQueue', 'isMergeQueueEnabled'),
		hasQueue:
			hasEnqueue ||
			has(operations.pr.fields, 'isInMergeQueue') ||
			has(operations.pr.fields, 'isMergeQueueEnabled'),
		canEnqueue:
			hasEnqueue &&
			has(operations.enqueue?.inputFields, 'pullRequestId', 'expectedHeadOid') &&
			has(queue.enqueuePayload?.fields, 'mergeQueueEntry') &&
			has(queue.entry?.fields, 'id', 'pullRequest'),
		canMerge:
			has(operations.mutation.fields, 'mergePullRequest') &&
			has(operations.merge?.inputFields, 'pullRequestId', 'expectedHeadOid', 'mergeMethod'),
		linearHistory: has(branch.ref?.fields, 'refUpdateRule') && has(branch.legacy?.fields, 'requiresLinearHistory'),
	};
}
