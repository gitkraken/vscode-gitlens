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
		if (this.cached != null) {
			for (const value of this.cached.values) {
				yield value;
			}
		}

		let results = this.cached;
		while (results == null || results.paging?.more) {
			results = await this.fetch(results?.paging);

			if (this.cached == null) {
				this.cached = results;
			} else {
				this.cached.values.push(...results.values);
				this.cached.paging = results.paging;
			}

			for (const value of results.values) {
				yield value;
			}
		}
	}
}
