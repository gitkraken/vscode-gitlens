import { emptySetMarker } from './filtering.js';

/**
 * Counts how many of a branches-visibility `includeOnlyRefs` set have actually decorated a loaded row,
 * for the footer that discloses a partially-paged filter. A ref's tip is its newest commit, so a ref
 * absent from `loadedRefIds` has none of its unique history on screen.
 *
 * The `emptySetMarker` sentinel is a filter state ("narrowed to nothing"), not a ref, so it never counts
 * toward either number — a set holding only the sentinel reports `{ loaded: 0, total: 0 }`, which reads
 * as "nothing to disclose" rather than "0 of 1 loaded".
 */
export function countLoadedIncludedRefs(
	includeOnlyRefs: Record<string, unknown> | undefined,
	loadedRefIds: ReadonlySet<string>,
): { loaded: number; total: number } {
	let loaded = 0;
	let total = 0;
	if (includeOnlyRefs == null) return { loaded: loaded, total: total };

	for (const id of Object.keys(includeOnlyRefs)) {
		if (id === emptySetMarker) continue;

		total++;
		if (loadedRefIds.has(id)) {
			loaded++;
		}
	}

	return { loaded: loaded, total: total };
}

/**
 * Decides which sha to target with `rows.getMoreRows` in response to a `scopeanchorsunreachable`
 * event from the GK graph component. Returns `undefined` to suppress paging.
 *
 * The library's anchors are typically branchRef/upstreamRef/additionalBranchRefs tips (resolved
 * from `shaByRefId`, so already loaded) plus `mergeTargetTipSha`. When `scope.mergeBase` is known
 * but its commit hasn't been loaded as a row, the library marks the (loaded) branch tip as
 * unreachable — meaning "this anchor's parent chain can't reach a visible ancestor because the
 * merge base isn't in the loaded graph rows". The right consumer response is to page targeted at
 * `mergeBase.sha` so a single round-trip lands the row and the library can flip `isBounded` true.
 *
 * `anchors` carries SHAs only — see `ScopeAnchors.unreachableAnchors`. `ineligible` holds SHAs the
 * caller has already spent a walk on with nothing to show for it (in flight, or out of attempts).
 */
export function pickScopePageTarget(
	anchors: ReadonlySet<string>,
	loaded: ReadonlySet<string>,
	ineligible: ReadonlySet<string>,
	mergeBaseSha: string | undefined,
): string | undefined {
	for (const sha of anchors) {
		if (!loaded.has(sha) && !ineligible.has(sha)) return sha;
	}
	if (mergeBaseSha != null && !loaded.has(mergeBaseSha) && !ineligible.has(mergeBaseSha)) {
		return mergeBaseSha;
	}
	return undefined;
}
