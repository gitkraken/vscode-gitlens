import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderHierarchyResult } from '../models.js';

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

/**
 * Drains a provider paged fetcher into a single result while preserving enough metadata to
 * signal whether the defensive backstop interrupted the drain.
 */
export async function collectProviderPagedResult<T>(
	fetch: (cursor: string | undefined) => Promise<PagedResult<T> | undefined>,
	maxPages = 20,
): Promise<ProviderHierarchyResult<T>> {
	const values: NonNullable<T>[] = [];
	let cursor: string | undefined;

	for (let page = 0; page < maxPages; page++) {
		const result = await fetch(cursor);
		if (result == null) return { values: values };

		values.push(...result.values);
		if (!result.paging?.more) return { values: values };

		if (result.paging.cursor === cursor) {
			return {
				values: values,
				truncated: true,
			};
		}

		cursor = result.paging.cursor;
		if (page === maxPages - 1) {
			return {
				values: values,
				paging: result.paging,
				truncated: true,
			};
		}
	}

	return { values: values };
}
