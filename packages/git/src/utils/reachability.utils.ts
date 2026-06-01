import { base64, fromBase64 } from '@gitlens/utils/base64.js';
import type { GraphReachabilityTable } from '../models/graph.js';
import type { GitCommitReachability } from '../providers/commits.js';

type ReachableRef = GitCommitReachability['refs'][number];

/**
 * Canonical dictionary key for a reachable ref. The `r`/`l` discriminator keeps a remote branch from
 * colliding with a local branch of the same name; the `refType` prefix separates tags from branches.
 * Single-sourced here so the encoder ({@link createReachabilityTableBuilder}) and any future consumer
 * can't drift on the convention.
 */
export function reachableRefKey(ref: ReachableRef): string {
	return `${ref.refType}:${ref.refType === 'branch' && ref.remote ? 'r' : 'l'}:${ref.name}`;
}

// Monotonic generation counter — each builder (i.e. each fresh graph walk) gets a distinct id, while a
// builder reused across `more()` pagination keeps its id. Only ever incremented host-side (the encoder);
// the webview treats the id as opaque. Module-scoped so ids are unique across a session's builders.
let nextReachabilityTableId = 0;

/**
 * Builds a {@link GraphReachabilityTable} incrementally: interns refs into a shared dictionary and
 * distinct membership bitmaps into a deduplicated set list. Kept next to {@link decodeReachabilitySet}
 * (its exact inverse) so the wire format — first-seen dictionary indexing, LSB-first bit packing,
 * base64 — has a single owner and a round-trippable test, rather than an encoder and decoder that can
 * silently diverge across packages.
 *
 * Append-only by construction: an index, once assigned, is never reused — so a builder kept alive
 * across paginated loads accumulates a table whose existing indices stay valid as it grows.
 */
export function createReachabilityTableBuilder(): {
	intern: (refs: Iterable<ReachableRef> | undefined) => number | undefined;
	build: () => GraphReachabilityTable | undefined;
} {
	const id = ++nextReachabilityTableId;
	const dictionary: GitCommitReachability['refs'] = [];
	const refKeyToIndex = new Map<string, number>();
	const sets: string[] = [];
	const setKeyToIndex = new Map<string, number>();

	return {
		/** Interns a ref set, returning its index into `sets`, or undefined when the set is empty. */
		intern: (refs: Iterable<ReachableRef> | undefined): number | undefined => {
			if (refs == null) return undefined;

			let maxIndex = -1;
			const indices: number[] = [];
			for (const ref of refs) {
				const key = reachableRefKey(ref);
				let index = refKeyToIndex.get(key);
				if (index == null) {
					index = dictionary.length;
					refKeyToIndex.set(key, index);
					dictionary.push(ref);
				}
				indices.push(index);
				if (index > maxIndex) {
					maxIndex = index;
				}
			}
			if (indices.length === 0) return undefined;

			// Pack into a bitset sized to this set's high-water dictionary index, then intern by base64.
			const bytes = new Uint8Array((maxIndex >> 3) + 1);
			for (const index of indices) {
				bytes[index >> 3] |= 1 << (index & 7);
			}
			const encoded = base64(bytes);
			let setIndex = setKeyToIndex.get(encoded);
			if (setIndex == null) {
				setIndex = sets.length;
				setKeyToIndex.set(encoded, setIndex);
				sets.push(encoded);
			}
			return setIndex;
		},

		/** The accumulated table, or undefined when nothing was interned. */
		build: (): GraphReachabilityTable | undefined =>
			dictionary.length ? { id: id, dictionary: dictionary, sets: sets } : undefined,
	};
}

/**
 * Decodes the membership bitmap at `index` in a {@link GraphReachabilityTable} back into its list of
 * reachable refs. Refs come back in the table's first-seen dictionary order — callers that need the
 * canonical display order (current-first / local-before-remote / tags newest-first) sort the result
 * with `compareReachableRefs`. Returns an empty array for an out-of-range/missing set index.
 *
 * The bitmap is at most `ceil(dictionary.length / 8)` bytes; earlier (shorter) bitmaps packed against
 * a smaller dictionary stay valid — only bits actually present can be set, so the loop stops at the
 * shorter of the dictionary length and the bitmap's bit count rather than scanning a guaranteed-zero tail.
 */
export function decodeReachabilitySet(table: GraphReachabilityTable, index: number): GitCommitReachability['refs'] {
	const { dictionary, sets } = table;
	const encoded = sets[index];
	if (encoded == null) return [];

	const bytes = fromBase64(encoded);
	const refs: GitCommitReachability['refs'] = [];
	const count = Math.min(dictionary.length, bytes.length * 8);
	for (let i = 0; i < count; i++) {
		if ((bytes[i >> 3] ?? 0) & (1 << (i & 7))) {
			refs.push(dictionary[i]);
		}
	}
	return refs;
}
