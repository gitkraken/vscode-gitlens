import type { GraphRefOptData, GraphRefType } from '../../../plus/graph/protocol.js';

/** Display parts for a hidden ref. `owner` is the dimmed `origin/` prefix that disambiguates same-named
 *  branches across remotes; `suffix` is the dimmed qualifier on a remote-wide hide. */
export interface HiddenRefLabel {
	owner?: string;
	name: string;
	suffix?: string;
}

/** Sort order within the hidden-refs list — remotes, then locals, then tags. Total over `GraphRefType` so
 *  the comparator stays well-defined: only `head`/`remote`/`tag` are storable (`StoredGraphRefType`), but a
 *  missing rank would compare as `NaN` and silently leave the list unsorted. */
const refTypeRank: Record<GraphRefType, number> = { remote: 0, head: 1, tag: 2, worktree: 3 };

/**
 * Splits a hidden ref into its display parts. Hiding a whole remote stores `name: '*'` (see `hideRef` in
 * `graphCommands.ts`), which renders as a bare `*` unless the `owner` is pulled in — and remote branches
 * store the name WITHOUT the remote prefix, so `origin/main` and `upstream/main` are indistinguishable
 * until the owner is shown alongside.
 */
export function getHiddenRefLabel(ref: GraphRefOptData): HiddenRefLabel {
	if (ref.type !== 'remote' || !ref.owner) return { name: ref.name };
	if (ref.name === '*') return { name: ref.owner, suffix: 'all branches' };

	return { owner: `${ref.owner}/`, name: ref.name };
}

/** The full `owner/name` a ref sorts and reads as — remote-wide hides collapse to just the remote. */
export function getHiddenRefSortKey(ref: GraphRefOptData): string {
	const { owner, name, suffix } = getHiddenRefLabel(ref);
	return suffix != null ? name : `${owner ?? ''}${name}`;
}

export function compareGraphRefOpts(a: GraphRefOptData, b: GraphRefOptData): number {
	const byType = refTypeRank[a.type] - refTypeRank[b.type];
	if (byType !== 0) return byType;

	return getHiddenRefSortKey(a).localeCompare(getHiddenRefSortKey(b));
}
