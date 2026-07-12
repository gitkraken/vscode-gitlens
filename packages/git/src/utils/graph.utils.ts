import type { GitGraphRow } from '../models/graph.js';

/**
 * Cursor-anchored concatenation of an accumulated rows window with a freshly-paged set — the SAME
 * cursor-anchored append the graph webview's reducer performs: keep prior rows up to and including the
 * cursor sha (trimming anything below it), then append the page; a cursor missing from the prior rows
 * appends after all of them (the reducer's fallthrough).
 *
 * Owns the canonical cursor-trim rule for the provider-side accumulated window (`GitGraphSession.window`)
 * and the host's rows mirror. Its ledger analogue (`appendRowsLedger` in the graph webview's
 * `graphRowsSplice.ts`) MUST stay in lockstep with this so the row mirror and its fingerprint ledger
 * can't drift.
 */
export function appendRowsAtCursor(
	prior: readonly GitGraphRow[],
	startingCursor: string,
	page: readonly GitGraphRow[],
): GitGraphRow[] {
	const cursorIndex = prior.findIndex(r => r.sha === startingCursor);
	const keep = cursorIndex >= 0 ? cursorIndex + 1 : prior.length;
	// Single-pass copy: preallocate the exact length, copy the kept prefix, then append the page — avoids
	// the intermediate array a `slice` + double-spread allocates.
	const result = new Array<GitGraphRow>(keep + page.length);
	for (let i = 0; i < keep; i++) {
		result[i] = prior[i];
	}
	for (let i = 0; i < page.length; i++) {
		result[keep + i] = page[i];
	}
	return result;
}

/**
 * Write-once cross-generation avatar merge: carry a prior graph generation's resolved avatar URLs forward into
 * a fresh generation's map WITHOUT overwriting its own entries. Resolved URLs are cheap to keep across a
 * rebuild/page and the fresh map's entries always win, so a stale carry-forward can never clobber current data.
 */
export function mergeAvatarsForward(prior: ReadonlyMap<string, string>, incoming: Map<string, string>): void {
	if (prior.size === 0) return;

	for (const [email, url] of prior) {
		if (!incoming.has(email)) {
			incoming.set(email, url);
		}
	}
}
