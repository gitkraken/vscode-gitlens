import type { Mutable } from './types.js';

export interface PagedResult<T> {
	readonly paging?: {
		readonly cursor: string;
		readonly more: boolean;
	};
	readonly values: NonNullable<T>[];
}

/** A shared, frozen empty result to avoid allocating on every "nothing found" path. */
export const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export interface PagingOptions {
	cursor?: string;
}

export class PageableResult<T> {
	private cached: Mutable<PagedResult<T>> | undefined;

	constructor(
		private readonly fetch: (paging: PagedResult<T>['paging']) => Promise<PagedResult<T>>,
		seed?: PagedResult<T>,
	) {
		this.cached = seed;
	}

	async *values(): AsyncIterable<NonNullable<T>> {
		let page = this.cached;
		if (page == null) {
			// No seed or cached results yet, so perform the initial fetch
			page = await this.fetch(undefined);
			this.cached = page;
		}

		const cached = page; // memoized accumulator (the first page)
		for (const value of cached.values) {
			yield value;
		}

		while (page.paging?.more) {
			page = await this.fetch(page.paging);
			cached.values.push(...page.values);
			cached.paging = page.paging;

			for (const value of page.values) {
				yield value;
			}
		}
	}
}

/**
 * Drains a paged fetcher into a single array, following `paging.cursor` until exhausted. Bounded by
 * `maxPages` (default 20) as a backstop against a provider that never stops paging.
 */
export async function collectPagedResults<T>(
	fetch: (cursor: string | undefined) => Promise<PagedResult<T> | undefined>,
	maxPages = 20,
): Promise<NonNullable<T>[]> {
	const all: NonNullable<T>[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const result = await fetch(cursor);
		if (result == null) break;

		all.push(...result.values);
		if (!result.paging?.more || result.paging.cursor === cursor) break;

		cursor = result.paging.cursor;
	}
	return all;
}
