import type { GraphqlResponseError } from '@octokit/graphql';
import type { RequestParameters } from '@octokit/types';

/** One field-level error GitHub attaches to a GraphQL response, as thrown via {@link GraphqlResponseError}. */
export type GraphqlAliasError = NonNullable<GraphqlResponseError<unknown>['errors']>[number];

/** An aliased GraphQL read: the (possibly partial) `data` alongside the field-level errors GitHub attached to it. */
export type AliasedGraphql = <T>(
	query: string,
	variables: RequestParameters,
) => Promise<{ readonly data: T; readonly errors: readonly GraphqlAliasError[] } | undefined>;

export const aliasedQueryChunkSize = 25;

/**
 * What an alias's own errors say about its slot in an aliased read: `'absent'` only when its node is null and every
 * error on it is NOT_FOUND; a rejection when a node arrived with an error, or on any other error (even a NOT_FOUND
 * nested under the node), since neither is trustworthy; `undefined` when the alias has no errors. `parent` names the
 * top-level field the alias is selected under, for a document that aliases inside one selection.
 */
export function getAliasErrorVerdict(
	errors: readonly GraphqlAliasError[],
	alias: string,
	node: unknown,
	parent?: string,
): 'absent' | PromiseRejectedResult | undefined {
	const aliasErrors = errors.filter(e => {
		// KEEP: typed as a one-segment tuple, but a nested field's error carries its whole path.
		const path: readonly unknown[] | undefined = e.path;
		return parent == null ? path?.[0] === alias : path?.[0] === parent && path[1] === alias;
	});
	if (aliasErrors.length === 0) return undefined;
	if (node == null && aliasErrors.every(e => e.type === 'NOT_FOUND')) return 'absent';

	const primary = aliasErrors.find(e => e.type !== 'NOT_FOUND') ?? aliasErrors[0];
	return { status: 'rejected', reason: new Error(primary.message) };
}
