import { chunk } from '@gitlens/utils/array.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { GitHubCheckContextEtagNode, GitHubCheckContexts, GitHubCheckContextsRead } from '../models.js';
import type { AliasedGraphql, GraphqlAliasError } from './aliasedQuery.js';
import { aliasedQueryChunkSize } from './aliasedQuery.js';

export type CheckContextsFragment =
	| { readonly kind: 'row'; readonly readsRequired: boolean }
	| { readonly kind: 'etag' };

export const etagCheckContextsFragment: CheckContextsFragment = { kind: 'etag' };

const checkContextsPageSize = 100;
const checkContextsLimit = 500;

function readsRequired(fragment: CheckContextsFragment): boolean {
	return fragment.kind === 'row' && fragment.readsRequired;
}

function gqlCheckContextNodes(fragment: CheckContextsFragment, index: number): string {
	if (fragment.kind === 'etag') {
		return `
__typename
... on CheckRun {
	id
	databaseId
	name
	status
	conclusion
	checkSuite {
		app {
			slug
		}
	}
}
... on StatusContext {
	id
	context
	state
}
`;
	}

	// KEEP: reads `$k{index}`, so a query selecting `readsRequired` must declare it for this alias.
	const isRequired = fragment.readsRequired ? `isRequired(pullRequestNumber: $k${index})` : '';
	return `
__typename
... on CheckRun {
	id
	databaseId
	name
	status
	conclusion
	detailsUrl
	url
	title
	startedAt
	completedAt
	${isRequired}
	checkSuite {
		app {
			slug
		}
		workflowRun {
			workflow {
				name
			}
		}
	}
}
... on StatusContext {
	id
	context
	state
	targetUrl
	createdAt
	${isRequired}
}
`;
}

function gqlCheckContexts(fragment: CheckContextsFragment, index: number, after: string | undefined): string {
	const args = after != null ? `first: ${checkContextsPageSize}, after: ${after}` : `first: ${checkContextsPageSize}`;
	return `
statusCheckRollup {
	contexts(${args}) {
		pageInfo {
			hasNextPage
			endCursor
		}
		nodes {
			${gqlCheckContextNodes(fragment, index)}
		}
	}
}
`;
}

export function gqlPullRequestCheckRunsFragment(fragment: CheckContextsFragment, index: number): string {
	// KEEP: the same arguments as the full fragment's `commits(last: 1)`, so GraphQL merges the two selections.
	return `
commits(last: 1) {
	nodes {
		commit {
			id
			${gqlCheckContexts(fragment, index, undefined)}
		}
	}
}
`;
}

export function isCheckContextsError(error: GraphqlAliasError): boolean {
	const path: readonly unknown[] | undefined = error.path;
	const at = path?.indexOf('statusCheckRollup') ?? -1;
	// KEEP: only under `nodes`; `contexts` and its `pageInfo` are non-null, so an error there nulls the whole rollup.
	return at !== -1 && path?.[at + 1] === 'contexts' && path[at + 2] === 'nodes';
}

function losesCheckContexts(
	errors: readonly GraphqlAliasError[],
	prefix: readonly (string | number)[],
	contexts: GitHubCheckContexts<GitHubCheckContextEtagNode> | undefined,
): boolean {
	return errors.some(e => {
		const path: readonly unknown[] | undefined = e.path;
		if (path == null || !isCheckContextsError(e) || !prefix.every((key, i) => path[i] === key)) return false;

		const tail = path.slice(path.indexOf('statusCheckRollup') + 2);
		const index = tail[1];
		return typeof index !== 'number' || tail.length === 2 || contexts?.nodes?.[index] == null;
	});
}

interface CheckContextsTarget<N extends GitHubCheckContextEtagNode> {
	readonly number: number;
	readonly commit:
		| { readonly id?: string; readonly statusCheckRollup: { readonly contexts?: GitHubCheckContexts<N> } | null }
		| undefined;
	readonly errorPath: readonly (string | number)[];
}

type CommitCheckContextsPage<N extends GitHubCheckContextEtagNode> = Record<
	string,
	{ statusCheckRollup?: { contexts?: GitHubCheckContexts<N> } | null } | null | undefined
>;

function gqlCommitCheckContextsPageQuery(fragment: CheckContextsFragment, count: number): string {
	const params: string[] = [];
	const fields: string[] = [];
	for (let j = 0; j < count; j++) {
		params.push(`$c${j}: ID!`, `$a${j}: String!`);
		if (readsRequired(fragment)) {
			params.push(`$k${j}: Int!`);
		}
		fields.push(`c${j}: node(id: $c${j}) {
	... on Commit {
		${gqlCheckContexts(fragment, j, `$a${j}`)}
	}
}`);
	}

	return `query getCommitCheckContextsPage(
	${params.join('\n\t')}
) {
	${fields.join('\n\t')}
}`;
}

export async function readCheckContexts<N extends GitHubCheckContextEtagNode>(
	graphql: AliasedGraphql,
	fragment: CheckContextsFragment,
	targets: readonly (CheckContextsTarget<N> | undefined)[],
	errors: readonly GraphqlAliasError[],
	scope: ScopedLogger | undefined,
): Promise<(GitHubCheckContextsRead<N> | undefined)[]> {
	type Read = { contexts: (N | null)[]; truncated: boolean };
	type Pending = { read: Read; number: number; commitId: string; after: string };

	let pending: Pending[] = [];
	const follow = (
		read: Read,
		number: number,
		commitId: string | undefined,
		contexts: GitHubCheckContexts<N> | undefined,
	): void => {
		if (!contexts?.pageInfo.hasNextPage) return;

		if (commitId == null || contexts.pageInfo.endCursor == null) {
			read.truncated = true;
			return;
		}

		pending.push({ read: read, number: number, commitId: commitId, after: contexts.pageInfo.endCursor });
	};

	const reads = targets.map((target): Read | undefined => {
		if (target == null) return undefined;

		const contexts = target.commit?.statusCheckRollup?.contexts;
		const read: Read = {
			contexts: [...(contexts?.nodes ?? [])],
			truncated: losesCheckContexts(errors, target.errorPath, contexts),
		};
		follow(read, target.number, target.commit?.id, contexts);
		return read;
	});

	for (let count = checkContextsPageSize; pending.length > 0; count += checkContextsPageSize) {
		const current = pending;
		pending = [];
		if (count >= checkContextsLimit) {
			for (const p of current) {
				p.read.truncated = true;
			}
			break;
		}

		for (const page of chunk(current, aliasedQueryChunkSize)) {
			const variables: Record<string, unknown> = {};
			page.forEach((p, j) => {
				variables[`c${j}`] = p.commitId;
				variables[`a${j}`] = p.after;
				if (readsRequired(fragment)) {
					variables[`k${j}`] = p.number;
				}
			});

			let rsp:
				| { readonly data: CommitCheckContextsPage<N>; readonly errors: readonly GraphqlAliasError[] }
				| undefined;
			try {
				rsp = await graphql<CommitCheckContextsPage<N>>(
					gqlCommitCheckContextsPageQuery(fragment, page.length),
					variables,
				);
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				scope?.warn(`failed to read a page of check runs; ex=${ex}`);
			}

			page.forEach((p, j) => {
				const alias = `c${j}`;
				const contexts = rsp?.data[alias]?.statusCheckRollup?.contexts;
				if (
					rsp == null ||
					contexts == null ||
					rsp.errors.some(e => e.path?.[0] === alias && !isCheckContextsError(e))
				) {
					p.read.truncated = true;
					return;
				}

				p.read.contexts.push(...(contexts.nodes ?? []));
				if (losesCheckContexts(rsp.errors, [alias], contexts)) {
					p.read.truncated = true;
				}
				follow(p.read, p.number, p.commitId, contexts);
			});
		}
	}

	return reads;
}
