import type { CollectionCompleteness, CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import { toCollectionScopeFailure } from '../../results.js';
import type { ProviderApiPagedResult, ProviderHierarchyResult } from '../models.js';

/**
 * Encodes an opaque numeric paging token as the `{ value, type: 'page' }` cursor the paging layer uses.
 * The value is whatever the consumer round-trips unchanged: a 1-based page number for numbered-page reads,
 * or a provider offset (e.g. Bitbucket Server's `nextPageStart`) that is never reinterpreted here.
 */
export function toPageCursor(page: number): string {
	return JSON.stringify({ value: page, type: 'page' });
}

/** Extracts the numeric paging token from a `{ value, type: 'page' }` cursor; undefined when absent/malformed. */
export function parsePageCursor(cursor: string | undefined): number | undefined {
	if (cursor == null || cursor === '{}') return undefined;

	try {
		const parsed = JSON.parse(cursor) as { value?: unknown; type?: unknown };
		if (parsed.type === 'page' && typeof parsed.value === 'number') return parsed.value;
	} catch {}

	return undefined;
}

/** Preserves successful sibling scopes, but doesn't turn an all-scope provider failure into an empty success. */
export async function flatSettledOrThrow<T>(promises: Promise<T[]>[]): Promise<T[]> {
	const results = await Promise.allSettled(promises);
	const fulfilled = results.filter((result): result is PromiseFulfilledResult<T[]> => result.status === 'fulfilled');
	if (fulfilled.length === 0) {
		const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (rejected != null) throw rejected.reason;
	}

	return fulfilled.flatMap(result => result.value);
}

/** Precedence for merged completeness: any known omission (`partial`) wins, then inability to confirm
 * (`unknown`), and only an all-`complete` set of pages stays `complete`. */
const completenessRank: Record<CollectionCompleteness, number> = { partial: 2, unknown: 1, complete: 0 };

/** A stable key for deduplicating structurally-identical scope failures accumulated across drained pages. */
function collectionFailureKey(failure: CollectionScopeFailure): string {
	const scope = failure.scope;
	return [
		failure.kind,
		scope?.providerId ?? '',
		scope?.resourceId ?? '',
		scope?.projectId ?? '',
		scope?.repositoryId ?? '',
		failure.message ?? '',
	].join(' ');
}

/**
 * Merges SDK collection metadata across drained pages. Completeness follows {@link completenessRank};
 * failures are concatenated and deduplicated by kind, scope IDs, and message. Returns `undefined` when no
 * page supplied metadata, so metadata-free providers and test doubles keep behaving as before.
 */
export function mergeCollectionMetadata(
	base: CollectionMetadata | undefined,
	next: CollectionMetadata | undefined,
): CollectionMetadata | undefined {
	if (base == null) return next;
	if (next == null) return base;

	const completeness =
		completenessRank[next.completeness] > completenessRank[base.completeness]
			? next.completeness
			: base.completeness;

	const failures: CollectionScopeFailure[] = [];
	const seen = new Set<string>();
	for (const failure of [...(base.failures ?? []), ...(next.failures ?? [])]) {
		const key = collectionFailureKey(failure);
		if (seen.has(key)) continue;

		seen.add(key);
		failures.push(failure);
	}

	return { completeness: completeness, ...(failures.length ? { failures: failures } : {}) };
}

/**
 * Drains a provider paged fetcher into a single result while preserving enough metadata to
 * signal whether the defensive backstop interrupted the drain, and merging SDK collection metadata
 * ({@link mergeCollectionMetadata}) across the fetched pages.
 *
 * The local `truncated` flag and SDK `metadata` are distinct facts: a page-drain backstop must remain visible
 * even if every fetched page reported `complete`, and SDK incompleteness is preserved even when the drain
 * finished within its page budget.
 */
export async function collectProviderPagedResult<T>(
	fetch: (cursor: string | undefined) => Promise<ProviderApiPagedResult<T> | undefined>,
	maxPages = 20,
	scope?: CollectionScopeFailure['scope'],
): Promise<ProviderHierarchyResult<T>> {
	const values: NonNullable<T>[] = [];
	let cursor: string | undefined;
	let metadata: CollectionMetadata | undefined;

	// Omit `metadata` entirely when no page supplied it, so a metadata-free drain stays deep-equal to its
	// pre-metadata shape (and consumers never see an explicit `undefined`).
	const build = (extra?: Partial<ProviderHierarchyResult<T>>): ProviderHierarchyResult<T> => {
		const mergedMetadata = extra?.metadata ?? metadata;
		return {
			values: values,
			...extra,
			...(mergedMetadata != null ? { metadata: mergedMetadata } : {}),
		};
	};

	for (let page = 0; page < maxPages; page++) {
		let result: ProviderApiPagedResult<T> | undefined;
		try {
			result = await fetch(cursor);
		} catch (ex) {
			// When the caller supplied a scope, preserve the items already fetched from that scope and record the
			// failure in collection metadata rather than re-throwing and discarding the prefix. Callers without a
			// scope keep the legacy throw behavior.
			if (scope == null) throw ex;
			return build({
				truncated: true,
				metadata: mergeCollectionMetadata(metadata, {
					completeness: 'partial',
					failures: [toCollectionScopeFailure(scope, ex)],
				}),
			});
		}
		if (result == null) return build();

		values.push(...result.values);
		metadata = mergeCollectionMetadata(metadata, result.metadata);

		if (!result.paging?.more) return build();

		if (result.paging.cursor === cursor) {
			return build({ truncated: true });
		}

		cursor = result.paging.cursor;
		if (cursor == null || cursor === '{}') {
			return build({ truncated: true });
		}
		if (page === maxPages - 1) {
			return build({ paging: result.paging, truncated: true });
		}
	}

	return build();
}
