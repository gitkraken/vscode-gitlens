import { areEqual, hasKeys } from '@gitlens/utils/object.js';
import type { GraphSelectedRows } from '../../../../plus/graph/protocol.js';

/**
 * A highlight the HOST asked for, held until the row it names becomes renderable.
 *
 * Sibling to `GraphSelectIntent`, and deliberately not the same thing: the intent drives a full SELECTION
 * — scroll, anchor, host echo — for an ask the webview originated, while this only projects a HIGHLIGHT for
 * one the host pushed through `graphState.selectedRows` (cold start, deep link, undo, search). Both can be
 * outstanding at once and neither supersedes the other.
 *
 * Bounded for the same reason the intent is: a row can stay unrenderable indefinitely — filtered out by
 * branch visibility, an active scope, a search filter — and an unbounded request lands minutes later, on
 * whatever unrelated toggle finally reveals its row. The bound runs against the WAITING, though, not the
 * request itself — see {@link touch}. A bootstrap selection is never adopted into the anchor (nothing
 * app-side derives one from `selectedRows`), so an absolute age would erase a perfectly good highlight.
 *
 * No user-intent cancel, unlike the intent: a click writes `graphState.selectedRows` itself, so {@link sync}
 * already replaces the request with the clicked row, which is renderable and adopted on the same render.
 */
export class GraphHostSelectionRequest {
	private _rows: GraphSelectedRows | undefined;
	private _lastSeen: GraphSelectedRows | undefined;
	private _armedAt = 0;

	/** @param retention How long, in ms, an armed request stays live. */
	constructor(private readonly retention: number) {}

	/** The outstanding request, or `undefined` when nothing is armed. */
	get pending(): GraphSelectedRows | undefined {
		return this._rows;
	}

	/**
	 * Arms on a host value whose CONTENT differs from the last one seen. Compared by content, not reference,
	 * because the host re-ships an identical `selectedRows` (as a new object) on every full-state push — a
	 * re-ship must neither re-arm nor restart the retention window.
	 */
	sync(hostRows: GraphSelectedRows | undefined): void {
		if (areEqual(hostRows, this._lastSeen)) return;

		this._lastSeen = hostRows;
		this._rows = hostRows != null && hasKeys(hostRows) ? hostRows : undefined;
		this._armedAt = Date.now();
	}

	/**
	 * Restarts the retention window, for a request the caller is currently surfacing. Keeps the bound
	 * pointed at the case it exists for — a row that never renders — instead of expiring a highlight that
	 * is on screen and doing its job.
	 */
	touch(): void {
		this._armedAt = Date.now();
	}

	/**
	 * Drops the request once it has gone unsurfaced for longer than `retention`. Call this ONLY when the
	 * row could not be projected: measuring age on read instead would expire a renderable request whenever
	 * the graph simply hasn't re-rendered in a while, and the highlight would vanish on the next hover.
	 */
	expireIfWaiting(): void {
		if (this._rows == null || Date.now() - this._armedAt < this.retention) return;

		this._rows = undefined;
	}

	/**
	 * Drops the request once `derived` matches it — the anchor adopted it, so the derived highlight owns the
	 * selection from here. Returns whether it matched.
	 */
	adopt(derived: GraphSelectedRows | undefined): boolean {
		const rows = this.pending;
		if (rows == null || !areEqual(rows, derived)) return false;

		this._rows = undefined;
		return true;
	}

	/**
	 * Drops the request when it names exactly `sha`, for a navigation that reported the row can't be found.
	 * Keyed so a failure for one sha can't discard a request a different source armed — cold start and a
	 * search jump can be in flight together.
	 */
	rejectFor(sha: string): void {
		const rows = this.pending;
		if (rows == null) return;

		const keys = Object.keys(rows);
		if (keys.length !== 1 || keys[0] !== sha) return;

		this._rows = undefined;
	}
}
