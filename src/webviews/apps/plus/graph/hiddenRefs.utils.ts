import type { GraphExcludeRefs, GraphRefOptData, GraphRefType } from '../../../plus/graph/protocol.js';

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
	if (ref.name === '*') {
		return {
			name: ref.owner,
			suffix: ref.except?.length ? `all branches but ${ref.except.length}` : 'all branches',
		};
	}

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

/** A whole-remote "Hide Remote" wildcard's exceptions, in both forms consumers need: `exceptIds` for
 *  id-keyed lookups (row refs), `exceptNames` for bare-name lookups (candidates that carry no id yet). */
export interface ExcludedRemote {
	exceptIds: ReadonlySet<string>;
	exceptNames: ReadonlySet<string>;
}

/** Memoized by `excludeRefs` object identity — the state provider replaces the whole map on each host
 *  push, so identity is a valid cache key. `null` caches a computed-and-empty result so a map with no
 *  wildcard entries isn't re-scanned on every call. */
const excludedRemotesCache = new WeakMap<GraphExcludeRefs, ReadonlyMap<string, ExcludedRemote> | null>();

/** A remote branch id's bare name — ids are `${repoPath}|remotes/${owner}/${branchName}`. `undefined`
 *  when the id doesn't carry the expected marker (never thrown; the id is just skipped). */
function exceptedBranchName(id: string, owner: string): string | undefined {
	const marker = `|remotes/${owner}/`;
	const index = id.indexOf(marker);
	return index === -1 ? undefined : id.slice(index + marker.length);
}

/**
 * The remote names (`owner`) hidden wholesale via a "Hide Remote" wildcard entry — `type: 'remote'`,
 * `name: '*'` (see `hideRef` in `graphCommands.ts`) — mapped to the branches exempted from that hide
 * (the wildcard's `except`, empty when none). Every OTHER branch of that remote is excluded, not just
 * the single branch id the wildcard was minted from, so consumers that only match `excludeRefs` by id
 * need this to catch the rest. `undefined` when there's nothing to exclude.
 */
export function getExcludedRemotes(
	excludeRefs: GraphExcludeRefs | undefined,
): ReadonlyMap<string, ExcludedRemote> | undefined {
	if (excludeRefs == null) return undefined;

	const cached = excludedRemotesCache.get(excludeRefs);
	if (cached !== undefined) return cached ?? undefined;

	let remotes: Map<string, ExcludedRemote> | undefined;
	for (const ref of Object.values(excludeRefs)) {
		if (ref.type !== 'remote' || ref.name !== '*' || ref.owner == null) continue;

		const exceptIds = new Set<string>(ref.except);
		const exceptNames = new Set<string>();
		for (const id of exceptIds) {
			const name = exceptedBranchName(id, ref.owner);
			if (name != null) {
				exceptNames.add(name);
			}
		}

		remotes ??= new Map<string, ExcludedRemote>();
		remotes.set(ref.owner, { exceptIds: exceptIds, exceptNames: exceptNames });
	}

	excludedRemotesCache.set(excludeRefs, remotes ?? null);
	return remotes;
}
