import type { IssueSorting } from '@gitlens/git/models/issue.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { azureWorkItemSearchResultLimit, toAzureWorkItemOrderQuery } from './search.js';

type QueryResult = { ids: number[]; asOf?: string };
type Query = (wiql: string, top: number, asOf?: string) => Promise<QueryResult>;

/** All partitions and ranking windows use the first query's server instant and ordering. */
export async function queryAzureWorkItemSearch(
	queries: readonly string[],
	sort: IssueSorting,
	ordered: boolean,
	query: Query,
	cancellation?: AbortSignal,
): Promise<number[]> {
	if (cancellation?.aborted) throw new CancellationError();

	const limit = azureWorkItemSearchResultLimit + 1;
	const first = await query(queries[0], limit);
	if (cancellation?.aborted) throw new CancellationError();

	if (queries.length === 1) return [...new Set(first.ids)].slice(0, limit);

	const asOf = first.asOf;
	if (
		typeof asOf !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(asOf) ||
		Number.isNaN(new Date(asOf).getTime())
	) {
		throw new Error('Azure DevOps returned no snapshot date for the partitioned work item search');
	}

	let ids = [...new Set(first.ids)].slice(0, limit);
	for (const wiql of queries.slice(1)) {
		if (cancellation?.aborted) throw new CancellationError();

		const next = [...new Set((await query(wiql, limit, asOf)).ids)].slice(0, limit);
		if (cancellation?.aborted) throw new CancellationError();

		ids = ordered
			? await mergeWorkItemIds(ids, next, sort, asOf, query, cancellation)
			: [...new Set([...ids, ...next])].slice(0, limit);
		if (!ordered && ids.length === limit) return ids;
	}
	return ids;
}

async function mergeWorkItemIds(
	left: readonly number[],
	right: readonly number[],
	sort: IssueSorting,
	asOf: string,
	query: Query,
	cancellation?: AbortSignal,
): Promise<number[]> {
	const limit = azureWorkItemSearchResultLimit + 1;
	const merged: number[] = [];
	let l = 0;
	let r = 0;
	while (l < left.length && r < right.length && merged.length < limit) {
		if (cancellation?.aborted) throw new CancellationError();

		// Small windows bound the escaped query even with the largest Azure work item ids.
		const lEnd = Math.min(l + 200, left.length);
		const rEnd = Math.min(r + 200, right.length);
		const a = new Set(left.slice(l, lEnd));
		const b = new Set(right.slice(r, rEnd));
		const candidates = [...new Set([...a, ...b])];
		const ranked = (await query(toAzureWorkItemOrderQuery(candidates, sort), candidates.length, asOf)).ids;
		if (cancellation?.aborted) throw new CancellationError();

		if (
			ranked.length !== candidates.length ||
			new Set(ranked).size !== candidates.length ||
			ranked.some(id => !a.has(id) && !b.has(id))
		) {
			throw new Error('Azure DevOps returned an incomplete work item search ranking');
		}

		for (const id of ranked) {
			merged.push(id);
			if (a.has(id)) {
				l++;
			}
			if (b.has(id)) {
				r++;
			}
			// An unseen row of an exhausted window can precede the other window's remaining rows.
			if (l === lEnd || r === rEnd || merged.length === limit) break;
		}
	}
	return [...merged, ...left.slice(l), ...right.slice(r)].slice(0, limit);
}
