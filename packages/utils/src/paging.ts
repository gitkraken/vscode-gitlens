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
