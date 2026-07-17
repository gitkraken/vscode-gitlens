import type { Mutable } from './types.js';

export interface PagedResult<T> {
	readonly paging?: {
		readonly cursor: string;
		readonly more: boolean;
		/**
		 * True when the read stopped without confirming it returned everything, yet exposes no usable cursor
		 * to continue (e.g. a provider read that fetches a single default page and can't report `hasNextPage`).
		 * Distinct from `more`: `more` means "there is a next page you can fetch with `cursor`"; `truncated`
		 * means "results may be incomplete and there is no cursor to follow." Consumers should surface this as
		 * a truncation signal rather than treating the result as complete.
		 */
		readonly truncated?: boolean;
		/** 1-based page that produced this result. Populated by numbered-page providers only. */
		readonly page?: number;
		/** Items requested per page, when known. */
		readonly pageSize?: number;
		/** Next page number, when the provider pages by number. */
		readonly nextPage?: number;
		/** Total number of pages, when the provider reports totals. */
		readonly totalPages?: number;
		/** Total number of items across all pages, when the provider reports totals. */
		readonly totalCount?: number;
	};
	readonly values: NonNullable<T>[];
}

/** A shared, frozen empty result to avoid allocating on every "nothing found" path. */
export const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export interface PagingOptions {
	cursor?: string;
	/** 1-based page to request from numbered-page providers. */
	page?: number;
	/** Items to request per page (numbered-page providers, and GitHub's cursor pages). */
	pageSize?: number;
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
