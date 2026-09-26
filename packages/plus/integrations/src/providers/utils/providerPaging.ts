import type {
	CollectionCompleteness,
	CollectionMetadata,
	CollectionOmission,
	CollectionScopeFailure,
} from '@gitkraken/provider-apis';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { uniqueBy } from '@gitlens/utils/iterable.js';
import { throwIfCallerContractError, toCollectionScopeFailure } from '../../collectionMetadata.js';
import { collectionScopeKey } from '../../results.js';
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
export function throwIfAllSettledFailed<T>(results: PromiseSettledResult<T>[]): void {
	if (results.some(result => result.status === 'fulfilled')) return;

	const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
	if (rejected != null) throw rejected.reason;
}

/**
 * The answer a pull-requests-by-branch read gives for one branch: the rows `matchesHead` accepts, newest first, at
 * most `limit` of them, each passed through `map`. Rows are filtered before they're mapped, so a non-matching row
 * can't fail the answer. `more` says the host holds rows it didn't return; the filter can't see those, so they make
 * the answer `truncated` however few rows passed it.
 */
export function selectBranchPullRequests<T, R>(
	rows: readonly T[],
	options: {
		matchesHead: (row: T) => boolean;
		updatedAt: (row: T) => number;
		map: (row: T) => R;
		limit: number;
		more: boolean;
	},
): { values: R[]; truncated: boolean } {
	const matched = rows.filter(options.matchesHead).sort((a, b) => options.updatedAt(b) - options.updatedAt(a));
	return {
		values: matched.slice(0, options.limit).map(options.map),
		truncated: options.more || matched.length > options.limit,
	};
}

/**
 * The second step of a pull-requests-by-branch read on a host whose branch query can't return the batch read's
 * rows: resolves each target's matched numbers through `resolve` (the host's `getProviderPullRequestsBatch`), so a
 * pull request comes back identical whichever read found it.
 *
 * One `resolve` call for every target's numbers, so the host's own fan-out bounds the concurrency. A number it
 * reports absent (deleted between the two steps) is dropped; one it couldn't check rejects the whole target, since
 * a partial list would read as a complete one. The first step's order is kept.
 */
export async function resolveBranchPullRequests(
	targets: readonly { owner: string; repo: string; project?: string }[],
	found: readonly PromiseSettledResult<{ numbers: number[]; truncated: boolean }>[],
	resolve: (
		coordinates: { owner: string; repo: string; number: number; project?: string }[],
	) => Promise<PromiseSettledResult<PullRequestShape | undefined>[] | undefined>,
): Promise<PromiseSettledResult<{ pullRequests: PullRequestShape[]; truncated: boolean }>[]> {
	const coordinates = found.flatMap((slot, i) =>
		slot.status === 'fulfilled'
			? slot.value.numbers.map(number => ({
					owner: targets[i].owner,
					repo: targets[i].repo,
					number: number,
					project: targets[i].project,
				}))
			: [],
	);

	let resolved: PromiseSettledResult<PullRequestShape | undefined>[] = [];
	if (coordinates.length > 0) {
		try {
			resolved =
				(await resolve(coordinates)) ??
				coordinates.map(() => ({
					status: 'rejected',
					reason: new Error('Pull requests could not be resolved'),
				}));
		} catch (ex) {
			resolved = coordinates.map(() => ({ status: 'rejected', reason: ex }));
		}
	}

	let offset = 0;
	return found.map(slot => {
		if (slot.status === 'rejected') return slot;

		const slots = resolved.slice(offset, offset + slot.value.numbers.length);
		offset += slot.value.numbers.length;

		const failure = slots.find((s): s is PromiseRejectedResult => s.status === 'rejected');
		if (failure != null) return failure;

		return {
			status: 'fulfilled',
			value: {
				pullRequests: slots.flatMap(s => (s.status === 'fulfilled' && s.value != null ? [s.value] : [])),
				truncated: slot.value.truncated,
			},
		};
	});
}

export function flatSettledResultsOrThrow<T>(results: PromiseSettledResult<T[]>[]): T[] {
	throwIfAllSettledFailed(results);

	const fulfilled = results.filter((result): result is PromiseFulfilledResult<T[]> => result.status === 'fulfilled');
	return fulfilled.flatMap(result => result.value);
}

export async function flatSettledOrThrow<T>(promises: Promise<T[]>[]): Promise<T[]> {
	return flatSettledResultsOrThrow(await Promise.allSettled(promises));
}

/** Precedence for merged completeness: any known omission (`partial`) wins, then inability to confirm
 * (`unknown`), and only an all-`complete` set of pages stays `complete`. */
const completenessRank: Record<CollectionCompleteness, number> = { partial: 2, unknown: 1, complete: 0 };

/** A stable key for deduplicating structurally-identical scope failures accumulated across drained pages. */
function collectionFailureKey(failure: CollectionScopeFailure): string {
	return [failure.kind, collectionScopeKey(failure.scope), failure.message ?? ''].join(' ');
}

/**
 * A stable key for collapsing omissions accumulated across drained pages, matching the SDK's own
 * `dedupeOmissions`: kind plus scope IDs, deliberately WITHOUT `limit`/`totalCount`.
 *
 * Those counts are a re-measurement, not an identity. GitHub recomputes the match total on every request, so
 * one repository drained over several pages reports the same cap with a drifting total; keying on the total
 * would emit a near-identical warning per page ("matched 1393…", "matched 1402…") that
 * `appendDedupedWarning` cannot collapse, since the messages genuinely differ. Independently-scoped omissions
 * still stay distinct, which is the case that carries information.
 */
function collectionOmissionKey(omission: CollectionOmission): string {
	return [omission.kind, collectionScopeKey(omission.scope)].join(' ');
}

/**
 * Merges SDK collection metadata across drained pages. Completeness follows {@link completenessRank};
 * failures are deduplicated by kind, scope IDs, and message, and omissions are collapsed per kind and scope
 * keeping the highest reported total ({@link collectionOmissionKey}). Both preserve first-reported order.
 * Returns `undefined` when no page supplied metadata, so metadata-free providers and test doubles keep
 * behaving as before.
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

	// First occurrence wins: a repeated failure carries no new information, since the message is part of its key.
	const failures = [
		...uniqueBy([...(base.failures ?? []), ...(next.failures ?? [])], collectionFailureKey, original => original),
	];
	// Highest total wins, so re-measuring one cap across pages collapses to a single omission holding the
	// largest figure reported for it — the same rule the SDK applies in `createCollectionMetadata`.
	const omissions = [
		...uniqueBy(
			[...(base.omissions ?? []), ...(next.omissions ?? [])],
			collectionOmissionKey,
			(original, current) => ((current.totalCount ?? -1) > (original.totalCount ?? -1) ? current : undefined),
		),
	];

	return {
		completeness: completeness,
		...(failures.length ? { failures: failures } : {}),
		...(omissions.length ? { omissions: omissions } : {}),
	};
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
	let truncated = false;

	// Omit `metadata` entirely when no page supplied it, so a metadata-free drain stays deep-equal to its
	// pre-metadata shape (and consumers never see an explicit `undefined`).
	const build = (extra?: Partial<ProviderHierarchyResult<T>>): ProviderHierarchyResult<T> => {
		const mergedMetadata = extra?.metadata ?? metadata;
		return {
			values: values,
			...extra,
			...(truncated || extra?.truncated === true ? { truncated: true } : {}),
			...(mergedMetadata != null ? { metadata: mergedMetadata } : {}),
		};
	};

	for (let page = 0; page < maxPages; page++) {
		let result: ProviderApiPagedResult<T> | undefined;
		try {
			result = await fetch(cursor);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			// A caller-contract error is not a fact about this scope, so it is never recorded as one — see
			// `throwIfCallerContractError`. Checked alongside cancellation because both are errors that a
			// per-scope failure would misdescribe.
			throwIfCallerContractError(ex);

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
		if (result == null) {
			if (page === 0) return build();

			return build({
				truncated: true,
				...(scope != null
					? {
							metadata: mergeCollectionMetadata(metadata, {
								completeness: 'partial',
								failures: [
									toCollectionScopeFailure(
										scope,
										new Error('Provider returned no page after advertising a continuation'),
									),
								],
							}),
						}
					: undefined),
			});
		}

		values.push(...result.values);
		metadata = mergeCollectionMetadata(metadata, result.metadata);
		truncated ||= result.paging?.truncated === true;

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
