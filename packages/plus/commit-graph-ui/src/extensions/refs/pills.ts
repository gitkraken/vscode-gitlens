import type { GraphExcludeRefs } from '../../contracts/state.js';

export function refPillKey(ref: { kind: string; name: string; owner?: string | null }): string {
	return ref.kind === 'remote' ? `remote:${ref.owner ?? ''}/${ref.name}` : `${ref.kind}:${ref.name}`;
}

/**
 * The key a CONTEXT pin (native menu open over a pill) is stored and matched under — {@link refPillKey}
 * qualified by the row's jump sha when there is one.
 *
 * `refPillKey` alone can't tell two pills apart here: the WIP row's row-marker PROXY pill renders the
 * HEAD row's refs, so it carries the SAME `data-ref-key` as the real pill on the HEAD row. Right-clicking
 * the proxy would otherwise expand the HEAD row's pill — the one the user is not pointing at — and leave
 * the proxy to collapse the moment the menu stole its `:hover`.
 */
export function refContextPinKey(refKey: string | undefined, jumpSha: string | undefined): string | undefined {
	if (refKey == null) return undefined;

	return jumpSha != null ? `${jumpSha}|${refKey}` : refKey;
}

export interface ExcludedRemote {
	exceptIds: ReadonlySet<string>;
	exceptNames: ReadonlySet<string>;
}

const excludedRemotesCache = new WeakMap<GraphExcludeRefs, ReadonlyMap<string, ExcludedRemote> | null>();

function exceptedBranchName(id: string, owner: string): string | undefined {
	const marker = `|remotes/${owner}/`;
	const index = id.indexOf(marker);
	return index === -1 ? undefined : id.slice(index + marker.length);
}

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

const assumedRefPillWidth = 110;

/** Computes an auto inline-ref cap without measuring any rendered pill. */
export function resolveAutoRefPillCap(availableWidth: number): number {
	if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;

	return Math.min(10, Math.max(1, Math.floor(availableWidth / assumedRefPillWidth)));
}
