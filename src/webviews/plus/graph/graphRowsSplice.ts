/**
 * Host-side rows splice-delta support for rebuild pushes.
 *
 * On every repo change the host re-walks and re-processes the loaded window, then ships ALL rows —
 * megabytes of serialize/deflate/inflate/parse for output that is nearly identical below the changed
 * region. The webview's engine already splices the unchanged suffix by content; this module lets the
 * HOST skip shipping it: a compact per-row ledger mirrors the rows the webview currently holds (sha +
 * a fingerprint of the mutable projection), and a bottom-up diff of a fresh row set against that
 * ledger yields the {@link GraphRowsSplice} payload — the changed head (and grown tail), plus span
 * pointers into the webview's own array.
 *
 * Why a fingerprint of only the MUTABLE projection: a commit's topology fields (sha, parents, author,
 * date, message, type, stats) are immutable per sha — history edits mint new shas. Between two walks,
 * a row with the same sha can differ only in its ref decorations (`heads`/`remotes`/`tags`), its
 * `contexts`, or — for the mutable work-dir/stash row types — anything. So the ledger stores a
 * fingerprint over exactly those fields (undefined for the common bare row), and sha equality covers
 * the rest.
 *
 * `contexts.flags` and `contexts.reachabilityIndex` are deliberately NOT in the fingerprint: they
 * flip GRAPH-WIDE on branch create/delete/checkout (unique-to-branch, reachable-from-HEAD, ref-set
 * membership all cascade to every ancestor), which would collapse the reuse for exactly the events
 * that matter most under heavy repo activity. Both are small non-negative ints, so the diff ships
 * them as a per-row PATCH on the splice instead (`null` = unchanged, `-1` = now absent) and the
 * webview applies them onto its retained rows.
 */

import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GraphRowsSplice } from './protocol.js';

export interface SentRowsLedger {
	shas: string[];
	/** Mutable-projection fingerprint per row; undefined for rows with no mutable fields. */
	fps: (string | undefined)[];
	/** `contexts.flags` per row — patchable, excluded from the fingerprint. */
	flags: (number | undefined)[];
	/** `contexts.reachabilityIndex` per row — patchable, excluded from the fingerprint. */
	reach: (number | undefined)[];
}

/** Row types whose content isn't pinned by their sha (re-stamped dates, live stats, etc.). */
function isMutableRowType(type: string): boolean {
	return type === 'work-dir-changes' || type === 'stash-node';
}

/** Fingerprint of the fields that CAN change for a given sha between two walks — EXCLUDING the
 *  patchable `contexts.flags` / `contexts.reachabilityIndex` (see the module doc). */
export function fingerprintRow(row: GitGraphRow): string | undefined {
	const mutableType = isMutableRowType(row.type);
	const ctx = row.contexts;
	const hasOtherContext =
		ctx != null &&
		(ctx.row !== undefined ||
			ctx.ref !== undefined ||
			ctx.refGroups !== undefined ||
			ctx.graph !== undefined ||
			ctx.avatar !== undefined ||
			ctx.message !== undefined ||
			ctx.author !== undefined ||
			ctx.date !== undefined ||
			ctx.sha !== undefined ||
			ctx.stats !== undefined);
	if (row.heads == null && row.remotes == null && row.tags == null && !hasOtherContext && !mutableType) {
		return undefined;
	}

	const ctxRest = hasOtherContext
		? [
				ctx.row,
				ctx.ref,
				ctx.refGroups,
				ctx.graph,
				ctx.avatar,
				ctx.message,
				ctx.author,
				ctx.date,
				ctx.sha,
				ctx.stats,
			]
		: undefined;
	return JSON.stringify(
		mutableType
			? [row.heads, row.remotes, row.tags, ctxRest, row.date, row.stats]
			: [row.heads, row.remotes, row.tags, ctxRest],
	);
}

export function buildRowsLedger(rows: readonly GitGraphRow[]): SentRowsLedger {
	const shas = new Array<string>(rows.length);
	const fps = new Array<string | undefined>(rows.length);
	const flags = new Array<number | undefined>(rows.length);
	const reach = new Array<number | undefined>(rows.length);
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		shas[i] = row.sha;
		fps[i] = fingerprintRow(row);
		flags[i] = row.contexts?.flags;
		reach[i] = row.contexts?.reachabilityIndex;
	}
	return { shas: shas, fps: fps, flags: flags, reach: reach };
}

/**
 * Mirrors the webview reducer's paging concatenation (`DidChangeRowsNotification` with a
 * `startingCursor`): keep the ledger up to and including the cursor row (trimming anything below it,
 * exactly like the reducer trims), then append the page. A cursor missing from the ledger appends
 * after the full ledger — the same fallthrough the reducer has. The cursor-trim rule here MUST stay in
 * lockstep with `appendRowsAtCursor` (the row-array mirror, in `@gitlens/git/utils/graph.utils.js`).
 */
export function appendRowsLedger(
	ledger: SentRowsLedger,
	startingCursor: string,
	pageRows: readonly GitGraphRow[],
): SentRowsLedger {
	const cursorIndex = ledger.shas.indexOf(startingCursor);
	const keep = cursorIndex >= 0 ? cursorIndex + 1 : ledger.shas.length;
	const shas = ledger.shas.slice(0, keep);
	const fps = ledger.fps.slice(0, keep);
	const flags = ledger.flags.slice(0, keep);
	const reach = ledger.reach.slice(0, keep);
	for (const row of pageRows) {
		shas.push(row.sha);
		fps.push(fingerprintRow(row));
		flags.push(row.contexts?.flags);
		reach.push(row.contexts?.reachabilityIndex);
	}
	return { shas: shas, fps: fps, flags: flags, reach: reach };
}

/**
 * Bottom-up diff of a fresh row set against the ledger of what the webview holds. Returns the
 * splice payload when a worthwhile suffix is reusable, or undefined to ship the full rows.
 *
 * Alignment mirrors the webview engine's suffix logic: a rebuild anchored on the prior bottom row
 * usually aligns exactly; a GROWN bottom (the walk ran past the anchor) is located by scanning the
 * fresh rows upward for the ledger's bottom sha; a CUT bottom by scanning the ledger upward for the
 * fresh bottom sha. The reused run is contiguous because row content depends only on the walk above
 * it — the first mismatch ends the reuse.
 *
 * "Worthwhile" is judged RELATIVE to the window, not by an absolute row count: the splice's payoff is
 * the webview's row reuse (skipping re-render of everything below the change), which is proportional
 * to the window regardless of its size — a 490/497-row reuse is exactly as valuable to a 500-row graph
 * as a 4900/4970 reuse is to a 5000-row one. A flat absolute floor defeats that for every window under
 * the floor: `minReused` is kept only as a tiny sanity minimum (default 10) below which splice
 * bookkeeping (ledger diff + patch encoding) costs more than just shipping the rows outright.
 */
export function diffRowsAgainstLedger(
	rows: readonly GitGraphRow[],
	ledger: SentRowsLedger,
	options?: { minReused?: number; scanCap?: number },
): GraphRowsSplice | undefined {
	const priorLength = ledger.shas.length;
	if (priorLength === 0 || rows.length === 0) return undefined;

	const scanCap = options?.scanCap ?? 10_000;
	let li = priorLength - 1;
	let ni = rows.length - 1;
	let tail: GitGraphRow[] | undefined;
	if (ledger.shas[li] !== rows[ni].sha) {
		// Grown bottom: find the ledger's bottom sha in the fresh rows (bounded scan).
		const bottomSha = ledger.shas[li];
		let found = -1;
		const floor = Math.max(0, ni - scanCap);
		for (let i = ni; i >= floor; i--) {
			if (rows[i].sha === bottomSha) {
				found = i;
				break;
			}
		}
		if (found >= 0) {
			tail = rows.slice(found + 1);
			ni = found;
		} else {
			// Cut bottom: find the fresh bottom sha in the ledger.
			const cut = ledger.shas.lastIndexOf(rows[ni].sha);
			if (cut < 0) return undefined;

			li = cut;
		}
	}

	// Walk the reusable run bottom-up. `flags`/`reachabilityIndex` differences do NOT end the run
	// (they're excluded from the fingerprint) — they're collected into the patch instead, built
	// bottom-up here and reversed into span order below. `null` = unchanged, `-1` = now absent.
	let reused = 0;
	let patched = false;
	const patchFlags: (number | null)[] = [];
	const patchReach: (number | null)[] = [];
	while (li >= 0 && ni >= 0) {
		const row = rows[ni];
		if (ledger.shas[li] !== row.sha || ledger.fps[li] !== fingerprintRow(row)) break;

		const f = row.contexts?.flags;
		const r = row.contexts?.reachabilityIndex;
		if (f !== ledger.flags[li]) {
			patched = true;
			patchFlags.push(f ?? -1);
		} else {
			patchFlags.push(null);
		}
		if (r !== ledger.reach[li]) {
			patched = true;
			patchReach.push(r ?? -1);
		} else {
			patchReach.push(null);
		}

		reused++;
		li--;
		ni--;
	}
	const minReused = options?.minReused ?? 10;
	if (reused < minReused || reused < rows.length / 2) return undefined;

	if (patched) {
		patchFlags.reverse();
		patchReach.reverse();
	}
	const reusedStart = li + 1;
	return {
		head: rows.slice(0, ni + 1),
		reusedStart: reusedStart,
		reusedCount: reused,
		tail: tail,
		patch: patched ? { flags: patchFlags, reachability: patchReach } : undefined,
		expectedPriorRows: priorLength,
		firstReusedSha: ledger.shas[reusedStart],
		lastReusedSha: ledger.shas[reusedStart + reused - 1],
	};
}

/**
 * Rebuilds the ledger for `rows` after a successful {@link diffRowsAgainstLedger} splice, without
 * re-fingerprinting the reused span: `diffRowsAgainstLedger` only calls a row "reused" once its
 * fingerprint has already been confirmed to match `priorLedger`'s entry, so that span's sha/fp are
 * just a slice of `priorLedger`; flags/reachability are recovered by applying `splice.patch` (the
 * diff's own record of what changed) instead of re-reading the fresh rows. Only `splice.head` /
 * `splice.tail` — the genuinely new/changed content — get fingerprinted fresh.
 */
export function buildRowsLedgerFromSplice(priorLedger: SentRowsLedger, splice: GraphRowsSplice): SentRowsLedger {
	const { reusedStart, reusedCount, patch } = splice;
	const shas = priorLedger.shas.slice(reusedStart, reusedStart + reusedCount);
	const fps = priorLedger.fps.slice(reusedStart, reusedStart + reusedCount);
	const flags = priorLedger.flags.slice(reusedStart, reusedStart + reusedCount);
	const reach = priorLedger.reach.slice(reusedStart, reusedStart + reusedCount);
	if (patch != null) {
		for (let i = 0; i < reusedCount; i++) {
			const f = patch.flags[i];
			if (f !== null) {
				flags[i] = f === -1 ? undefined : f;
			}
			const r = patch.reachability[i];
			if (r !== null) {
				reach[i] = r === -1 ? undefined : r;
			}
		}
	}

	const headLedger = buildRowsLedger(splice.head);
	const tailLedger = splice.tail != null ? buildRowsLedger(splice.tail) : undefined;
	return {
		shas: [...headLedger.shas, ...shas, ...(tailLedger?.shas ?? [])],
		fps: [...headLedger.fps, ...fps, ...(tailLedger?.fps ?? [])],
		flags: [...headLedger.flags, ...flags, ...(tailLedger?.flags ?? [])],
		reach: [...headLedger.reach, ...reach, ...(tailLedger?.reach ?? [])],
	};
}
