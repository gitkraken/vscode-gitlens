import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { PagingMode } from '../providers/models.js';
import { mergeCollectionMetadata, parsePageCursor, toPageCursor } from '../providers/utils/providerPaging.js';
import type { ProviderPagedResult, ProviderPageInfo, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';

/**
 * The paging mechanics shared by every paged read on the provider facade: translating the SDK's `paging` into
 * the page-oriented shape consumers get, deciding what position and what continuation a page may honestly
 * claim, and walking a cursor-only read forward to a requested page number.
 *
 * Kept in one module because the value of these rules is that they are the SAME on every read — the contract
 * they implement is documented once on {@link ProviderPageInfo} and on `IntegrationManager`'s paging section.
 * Copies of them drifting apart is exactly the defect this consolidation removed.
 */

/**
 * Whether a repo-scoped read for this provider ADVANCES on a page number, so the facade may synthesize a
 * page-number cursor, `page.currentPage` may echo the request, and a next-page number is a usable continuation.
 *
 * Only `PagingMode.Repos` (GitHub/GHE) is excluded: its read is cursor-only, so it accepts a page number and
 * ignores it, answering with page 1 — which is why {@link drainToRequestedPage} exists for that mode.
 *
 * Every other provider, including one with no declared mode (Bitbucket Data Center), reads `page` as a 1-based
 * page number. That last part is only true as of `@gitkraken/provider-apis` 0.54.0: before it, Bitbucket Data
 * Center consumed `page` as a raw `start` ITEM OFFSET, so a synthesized page 3 asked for `start=3` — a window
 * overlapping page 1 — and this facade had to withhold the synthesized cursor from it. The SDK now converts
 * (`start = (page - 1) * limit`) and reports `nextPage` as a page number, so the guard is gone and that host
 * can be advanced by number like the rest.
 */
export function isPageNumberAdvanceable(mode: PagingMode | undefined): boolean {
	return mode !== PagingMode.Repos;
}

/**
 * Encodes a 1-based page number as the opaque cursor the provider paging layer understands, via the same
 * {@link toPageCursor} the providers encode with (its `parsePageCursor` counterpart is what reads these back).
 * Page 1 needs no cursor: it is the read's own starting position.
 */
export function pageToCursor(page: number | undefined): string | undefined {
	return page == null || page <= 1 ? undefined : toPageCursor(page);
}

/**
 * Filters out the provider paging layer's empty-cursor sentinel. `providersApi` seeds its next-cursor with
 * `'{}'` and leaves it there when the SDK reports another page without an `endCursor`, so `'{}'` means "no
 * usable continuation" and must never be threaded back as one.
 */
export function usableCursor(cursor: string | undefined): string | undefined {
	return cursor == null || cursor === '{}' ? undefined : cursor;
}

/**
 * The terminal page a paged read returns when it refuses the request outright — the surface doesn't apply (an
 * issue tracker asked for a repo read), the target couldn't be resolved, a capability is missing, or a filter
 * set isn't expressible server-side. Every one of those is "no page was served": empty `items`, no continuation,
 * and the reason carried in `warnings`.
 *
 * `currentPage` stays a caller-supplied parameter rather than being derived here because the refusals differ on
 * what position they can honestly claim: a read the provider advances by page number reports the requested page,
 * while a cursor-only account-wide read has no addressable position and reports 1 (see
 * {@link ProviderPageInfo.currentPage}).
 */
export function refusedPage<T>(
	currentPage: number,
	warnings: ProviderWarning[],
	fetchFailed: boolean,
): ProviderPagedResult<T> {
	return {
		items: [],
		warnings: warnings,
		page: { currentPage: currentPage, itemsPerPage: 0 },
		hasMore: false,
		fetchFailed: fetchFailed || undefined,
	};
}

/** A provider page normalized off the SDK's `paging`, before continuation and position are reconciled. */
export interface NormalizedPage {
	page: ProviderPageInfo;
	hasMore: boolean;
	cursor?: string;
	truncated: boolean;
}

/**
 * Normalizes a `PagedResult.paging` into the page-oriented shape Kepler consumes: `page`, `hasMore`, and an
 * opaque `cursor` retained only for cursor-only hosts (where jumping straight to page N isn't possible, so the
 * caller threads the cursor back instead).
 */
export function toProviderPageInfo(
	itemsPerPage: number,
	paging: { more?: boolean; cursor?: string; page?: number; pageSize?: number; truncated?: boolean } | undefined,
): NormalizedPage {
	let cursor: string | undefined;
	let cursorPage: number | undefined;
	const raw = paging?.cursor;
	if (raw != null && raw !== '{}') {
		try {
			const parsed = JSON.parse(raw) as { type?: string; cursors?: unknown; page?: number };
			// Retain opaque cursor strings for cursor-only hosts, per-repo/project cursor bundles for
			// PagingMode.Repo/Project reads, AND page/offset cursors. The latter matters for reads with no
			// caller-visible page param to increment — e.g. Bitbucket Server's account-wide PR read threads
			// its next `start` offset as a `type:'page'` cursor; dropping it left the caller with
			// `hasMore:true` and nothing to continue with. A page cursor is a valid opaque continuation, so
			// threading it back is always safe even where a page number is also reported.
			if (parsed.type === 'cursor' || parsed.type === 'page' || Array.isArray(parsed.cursors)) {
				cursor = raw;
				// Per-repo/project cursor bundles also carry the current page number so the facade can report the
				// real page when the consumer continues using only the cursor.
				if (Array.isArray(parsed.cursors) && parsed.page != null) {
					cursorPage = parsed.page;
				}
			}
		} catch {}
	}
	// Only echo a page number the provider actually honored. Numbered-page hosts report their own
	// `paging.page`; cursor-only hosts (e.g. GitHub PR search) report none and ignore a synthesized
	// page-number cursor — returning their first page — so echoing the requested `page` would mislabel
	// page 1 as page N. Report page 1 in that case rather than the unapplied request. Per-repo/project
	// bundles may carry the page explicitly in the cursor.
	const currentPage = paging?.page ?? cursorPage ?? 1;
	return {
		page: {
			currentPage: Math.max(1, currentPage),
			itemsPerPage: paging?.pageSize ?? itemsPerPage,
		},
		hasMore: paging?.more ?? false,
		cursor: cursor,
		// A single-page provider read that couldn't confirm completeness carries `paging.truncated`;
		// surface it so callers can flag `page.truncated` instead of publishing a partial read as complete.
		truncated: paging?.truncated ?? false,
	};
}

/**
 * Reconciles a provider's `hasMore` with the continuation it actually handed back. A provider can report
 * `hasNextPage: true` while omitting the `endCursor` (the paging layer surfaces that as the sentinel `'{}'`,
 * which {@link toProviderPageInfo} drops), leaving `hasMore: true` with no cursor — a consumer that pages while
 * `hasMore` would then re-request the same page forever. Prefer the real provider cursor; else synthesize the
 * next page number, but only for a read the provider actually advances by page number (`nextPage` omitted for
 * cursor-only reads, which ignore it and answer with their first page again); else report the read as
 * terminal-but-incomplete (`hasMore: false` + `truncated`).
 */
export function resolveContinuation(
	paged: { hasMore: boolean; cursor?: string; truncated: boolean },
	nextPage: number | undefined,
): { hasMore: boolean; cursor?: string; truncated: boolean } {
	if (!paged.hasMore) return { hasMore: false, cursor: undefined, truncated: paged.truncated };
	if (paged.cursor != null) return { hasMore: true, cursor: paged.cursor, truncated: paged.truncated };

	const synthesized = nextPage != null ? pageToCursor(nextPage) : undefined;
	if (synthesized != null) return { hasMore: true, cursor: synthesized, truncated: paged.truncated };

	return { hasMore: false, cursor: undefined, truncated: true };
}

/**
 * Resolves the position a paged read reports as `page.currentPage`, per the single convention documented on
 * {@link ProviderPageInfo.currentPage}. Every paged read routes through here so the field means the same thing
 * on all of them: positional, never constant-1 for one read and positional for another.
 *
 * `providerPage` is what the provider (or the internal drain) established — 1 means "nothing reported".
 * `pageAdvanceable` is whether the read honors a page number at all: false for a cursor-only read, which
 * answers with its first page when handed a synthesized page-number cursor, so the requested `page` must NOT be
 * echoed there.
 */
export function resolveCurrentPage(options: {
	providerPage: number;
	requestedPage: number;
	suppliedCursor: string | undefined;
	pageAdvanceable: boolean;
}): number {
	if (options.providerPage > 1) return options.providerPage;
	// A caller-threaded cursor DID advance the provider, so the caller's own position is authoritative for a
	// provider that reports none: prefer the page the cursor encodes, else the `page` supplied alongside it.
	if (options.suppliedCursor != null) return parsePageCursor(options.suppliedCursor) ?? options.requestedPage;

	return options.pageAdvanceable ? options.requestedPage : 1;
}

/** The mutable state {@link drainToRequestedPage} carries across the pages it walks. */
export interface DrainState<T> {
	items: T[];
	paged: NormalizedPage;
	metadata: CollectionMetadata | undefined;
	fetchFailed: boolean;
}

/**
 * Advances a cursor-only read to the requested page when the caller supplied only `page`.
 *
 * A cursor-only read accepts a synthesized page-number cursor and ignores it, answering with its first page, so
 * the requested page has to be reached by walking the provider's own opaque continuations. Only the last
 * successfully-read page's items are kept — returning pages 1..N as "page N" would duplicate items for a normal
 * paged consumer — while warnings and metadata are merged across the whole drained prefix.
 *
 * Shared by the repo-scoped and account-wide PR reads and the repo-scoped issue read so the three cannot drift:
 * a requested page past the provider's terminal cursor is an EMPTY page N on all of them, per
 * {@link ProviderPageInfo.currentPage}, never the last available page relabeled.
 */
export async function drainToRequestedPage<T>(
	state: DrainState<T>,
	options: {
		requestedPage: number;
		itemsPerPage: number | undefined;
		warnings: ProviderWarning[];
		readPage: (cursor: string) => Promise<{
			value?: (PagedResult<T> & { metadata?: CollectionMetadata }) | undefined;
			warning?: ProviderWarning;
		}>;
	},
): Promise<DrainState<T>> {
	let { items, metadata, fetchFailed } = state;
	let currentPage = 1;
	let currentCursor = usableCursor(state.paged.hasMore ? state.paged.cursor : undefined);
	let currentHasMore = state.paged.hasMore && currentCursor != null;
	let currentTruncated = state.paged.truncated;
	// A page requested past the terminal cursor is that empty page N. Distinguished from the first read
	// having failed outright, which is already reported as page N with no items by the caller's own state.
	const missRequestedPage = () => {
		items = [];
		currentPage = options.requestedPage;
		currentCursor = undefined;
		currentHasMore = false;
	};

	if (fetchFailed) {
		missRequestedPage();
	}

	while (currentPage < options.requestedPage && currentHasMore && currentCursor != null) {
		const { value, warning } = await options.readPage(currentCursor);
		if (warning != null) {
			appendDedupedWarning(options.warnings, warning);
		}
		if (value == null) {
			fetchFailed = true;
			missRequestedPage();
			break;
		}

		items = value.values;
		metadata = mergeCollectionMetadata(metadata, value.metadata);
		const next = toProviderPageInfo(options.itemsPerPage ?? value.values.length, value.paging);
		currentPage++;
		currentTruncated ||= next.truncated;
		const nextCursor = usableCursor(next.cursor);
		// A provider that hands back the same cursor (or none) isn't advancing; stop rather than refetch
		// the same page forever.
		if (nextCursor == null || nextCursor === currentCursor) {
			currentCursor = undefined;
			currentHasMore = false;
			break;
		}

		currentCursor = nextCursor;
		currentHasMore = next.hasMore;
	}

	if (currentPage < options.requestedPage) {
		missRequestedPage();
	}

	return {
		items: items,
		paged: {
			page: { currentPage: currentPage, itemsPerPage: options.itemsPerPage ?? items.length },
			hasMore: currentHasMore,
			cursor: currentCursor,
			truncated: currentTruncated,
		},
		metadata: metadata,
		fetchFailed: fetchFailed,
	};
}
