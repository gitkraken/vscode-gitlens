import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderHierarchyResult } from '../models.js';

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
