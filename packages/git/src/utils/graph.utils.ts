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

/**
 * Swaps the `${fromRepoPath}|` prefix on every ref id a graph row embeds — local heads plus their
 * upstream/worktree refs, remote heads, and tags — for a session rebind onto `toRepoPath`. Mutates the
 * row in place, and returns whether it carried anything repoPath-derived at all (`false` for most rows,
 * letting callers skip the rest of their per-row rebind work).
 *
 * SINGLE OWNER of the row-id swap: the WALK owns these ids (`buildRowFromCommit` stamps them from the
 * branch map built at the walk's own `repoPath`), which is why this belongs to the provider layer and why
 * {@link GraphRowProcessor.restampRow} is narrowed to the host-serialized contexts it alone can rebuild.
 *
 * Matches the prefix INCLUDING the trailing `|`, so `/repo` never re-stamps `/repo2|heads/x`.
 *
 * Not to be confused with the graph webview's `restampId` (`utils/rebind.utils.ts`), which re-keys
 * client-held STATE ids at the webview layer and shares no data with these rows.
 */
export function restampGraphRowIds(row: GitGraphRow, fromRepoPath: string, toRepoPath: string): boolean {
	if (
		row.heads == null &&
		row.remotes == null &&
		row.tags == null &&
		row.contexts?.refGroups == null &&
		row.contexts?.row == null
	) {
		return false;
	}

	const fromPrefix = `${fromRepoPath}|`;
	const restampId = (id: string): string =>
		id.startsWith(fromPrefix) ? `${toRepoPath}|${id.slice(fromPrefix.length)}` : id;

	if (row.heads != null) {
		for (const head of row.heads) {
			if (head.id != null) {
				head.id = restampId(head.id);
			}
			if (head.upstream != null) {
				head.upstream.id = restampId(head.upstream.id);
			}
			if (head.worktree != null) {
				head.worktree.id = restampId(head.worktree.id);
			}
		}
	}
	if (row.remotes != null) {
		for (const remoteHead of row.remotes) {
			if (remoteHead.id != null) {
				remoteHead.id = restampId(remoteHead.id);
			}
		}
	}
	if (row.tags != null) {
		for (const tag of row.tags) {
			if (tag.id != null) {
				tag.id = restampId(tag.id);
			}
		}
	}

	return true;
}
