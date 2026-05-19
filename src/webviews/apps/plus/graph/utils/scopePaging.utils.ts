/**
 * Decides which sha to target with `GetMoreRowsCommand` in response to a `scopeanchorsunreachable`
 * event from the GK graph component. Returns `undefined` to suppress paging.
 *
 * The library's anchors are typically branchRef/upstreamRef/additionalBranchRefs tips (resolved
 * from `shaByRefId`, so already loaded) plus `mergeTargetTipSha`. When `scope.mergeBase` is known
 * but its commit hasn't been loaded as a row, the library marks the (loaded) branch tip as
 * unreachable — meaning "this anchor's parent chain can't reach a visible ancestor because the
 * merge base isn't in the loaded graph rows". The right consumer response is to page targeted at
 * `mergeBase.sha` so a single round-trip lands the row and the library can flip `isBounded` true.
 */
export function pickScopePageTarget(
	anchors: ReadonlySet<string>,
	loaded: ReadonlySet<string>,
	requested: ReadonlySet<string>,
	mergeBaseSha: string | undefined,
): string | undefined {
	for (const sha of anchors) {
		if (!loaded.has(sha) && !requested.has(sha)) return sha;
	}
	if (mergeBaseSha != null && !loaded.has(mergeBaseSha) && !requested.has(mergeBaseSha)) {
		return mergeBaseSha;
	}
	return undefined;
}
