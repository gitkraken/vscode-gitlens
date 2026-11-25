import { includeNoRefsKey } from '../contracts/state.js';

export function countLoadedIncludedRefs(
	includeOnlyRefs: Record<string, unknown> | undefined,
	loadedRefIds: ReadonlySet<string>,
): { loaded: number; total: number } {
	let loaded = 0;
	let total = 0;
	if (includeOnlyRefs == null) return { loaded: loaded, total: total };

	for (const id of Object.keys(includeOnlyRefs)) {
		if (id === includeNoRefsKey) continue;

		total++;
		if (loadedRefIds.has(id)) {
			loaded++;
		}
	}

	return { loaded: loaded, total: total };
}

export function countRenderedSearchResults(
	resultIds: Readonly<Record<string, unknown>> | undefined,
	renderedShas: ReadonlyMap<string, unknown> | undefined,
): number {
	if (resultIds == null || renderedShas == null) return 0;

	let count = 0;
	for (const sha of Object.keys(resultIds)) {
		if (renderedShas.has(sha)) {
			count++;
		}
	}
	return count;
}

/** The sha to page toward: the first of `anchors` not loaded or `ineligible`, else `mergeBaseSha`; `undefined` stops
 *  paging. */
export function pickScopePageTarget(
	anchors: Iterable<string>,
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
