/**
 * A sparse index over "tall" rows — rows that span more than one display unit — used by a virtualizer
 * layout to convert between "row index" space and "unit position" space. Almost all rows are 1 unit;
 * only a few (e.g. rows rendering multiple stacked commits) are N units. Storing only the tall rows
 * (instead of a per-row units array) keeps lookups and rebuilds cheap even for huge row counts.
 *
 * Pure module — no imports — so it stays trivially testable and reusable outside the webview layer.
 */

/** Returns the unit-height of the row at `index`. Should return an integer >= 1. */
export type RowUnitsSource = (index: number) => number;

export class RowUnitsIndex {
	// The uniform case (no tall rows at all) is by far the common case, and callers use `===` on the
	// returned index to detect "did anything change" — so it must be a stable, shared singleton rather
	// than a fresh instance that happens to be empty.
	static readonly uniform: RowUnitsIndex = new RowUnitsIndex([], [], [], 0);

	private constructor(
		private readonly _indices: number[],
		private readonly _units: number[],
		private readonly _extraBefore: number[],
		readonly totalExtra: number,
	) {}

	/** Builds an index by scanning every row from `0` to `rowCount - 1`. */
	static build(rowCount: number, unitsFor: RowUnitsSource): RowUnitsIndex {
		const indices: number[] = [];
		const units: number[] = [];
		const extraBefore: number[] = [];

		const extra = RowUnitsIndex._scan(indices, units, extraBefore, 0, 0, rowCount, unitsFor);
		if (indices.length === 0) return RowUnitsIndex.uniform;

		return new RowUnitsIndex(indices, units, extraBefore, extra);
	}

	/** Appends every tall row in `[fromIndex, rowCount)` onto the three parallel arrays, returning the
	 *  running extra-units total — seeded with `extra`, the total already accumulated before `fromIndex`.
	 *  Shared by `build` (empty arrays, seed 0) and `extend` (the sliced prefix and its total). */
	private static _scan(
		indices: number[],
		units: number[],
		extraBefore: number[],
		extra: number,
		fromIndex: number,
		rowCount: number,
		unitsFor: RowUnitsSource,
	): number {
		for (let i = fromIndex; i < rowCount; i++) {
			let u = unitsFor(i);
			// Defensive clamp: a bad row-height callback (NaN, 0, negative) must never break layout math —
			// treat it as a normal 1-unit row instead of throwing.
			if (!Number.isFinite(u) || u < 1) {
				u = 1;
			}

			if (u > 1) {
				indices.push(i);
				units.push(u);
				extraBefore.push(extra);
				extra += u - 1;
			}
		}

		return extra;
	}

	/**
	 * Returns a new index equivalent to rebuilding from scratch with a `unitsFor` that agrees with this
	 * index for rows before `fromIndex` and defers to the given `unitsFor` from `fromIndex` on — without
	 * re-scanning the untouched prefix. Any of this index's tall rows at or beyond `fromIndex` are
	 * discarded; the caller is re-deriving that whole tail.
	 */
	extend(rowCount: number, fromIndex: number, unitsFor: RowUnitsSource): RowUnitsIndex {
		const splitAt = RowUnitsIndex._lowerBound(this._indices, fromIndex);

		const indices = this._indices.slice(0, splitAt);
		const units = this._units.slice(0, splitAt);
		const extraBefore = this._extraBefore.slice(0, splitAt);
		const seed = splitAt > 0 ? this._extraBefore[splitAt - 1] + (this._units[splitAt - 1] - 1) : 0;

		const extra = RowUnitsIndex._scan(indices, units, extraBefore, seed, fromIndex, rowCount, unitsFor);
		if (indices.length === 0) return RowUnitsIndex.uniform;

		return new RowUnitsIndex(indices, units, extraBefore, extra);
	}

	/**
	 * Content equality: the same tall rows, at the same indices, with the same spans. Lets a caller that
	 * rebuilds unconditionally KEEP its current instance when nothing actually moved — consumers guard on
	 * instance identity (see `FixedSizeVerticalLayout`'s `units` setter), so a fresh-but-equal index would
	 * otherwise force a full reflow on every rebuild.
	 *
	 * `_extraBefore` is a running sum over `_indices`/`_units` by construction, so two indices agreeing on
	 * those agree on it too — it needs no comparison.
	 */
	equalsIndex(other: RowUnitsIndex): boolean {
		if (other === this) return true;
		if (other.totalExtra !== this.totalExtra || other._indices.length !== this._indices.length) return false;

		for (let i = 0; i < this._indices.length; i++) {
			if (this._indices[i] !== other._indices[i] || this._units[i] !== other._units[i]) return false;
		}

		return true;
	}

	get isUniform(): boolean {
		return this._indices.length === 0;
	}

	unitsOf(index: number): number {
		const pos = RowUnitsIndex._lowerBound(this._indices, index);
		if (pos < this._indices.length && this._indices[pos] === index) return this._units[pos];

		return 1;
	}

	/** Extra units contributed by tall rows strictly before `index`. */
	unitsBefore(index: number): number {
		// `pos` is the count of tall rows with display index < `index` (the first position whose index is
		// >= `index`, over an ascending array), and `_extraBefore[pos]` already sums `(units - 1)` over
		// exactly those tall rows by construction.
		const pos = RowUnitsIndex._lowerBound(this._indices, index);
		return pos === this._indices.length ? this.totalExtra : this._extraBefore[pos];
	}

	unitPosOf(index: number): number {
		return index + this.unitsBefore(index);
	}

	totalUnits(rowCount: number): number {
		return rowCount + this.totalExtra;
	}

	/** Inverse of `unitPosOf`, clamped to `[0, rowCount - 1]`. */
	rowIndexAtUnit(unit: number, rowCount: number): number {
		if (rowCount <= 0) return 0;
		if (unit < 0) return 0;

		const total = this.totalUnits(rowCount);
		if (unit >= total) return rowCount - 1;

		// Binary search for the last tall row whose start-unit (`_indices[i] + _extraBefore[i]`) is <=
		// `unit`, computing the start-unit on the fly rather than materializing it as an array.
		let lo = 0;
		let hi = this._indices.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			const startUnit = this._indices[mid] + this._extraBefore[mid];
			if (startUnit <= unit) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		const i = lo - 1;

		if (i >= 0) {
			const startUnit = this._indices[i] + this._extraBefore[i];
			if (unit < startUnit + this._units[i]) return this._indices[i];
		}

		// `unit` falls in a uniform stretch after tall row `i` (or before any tall row if `i === -1`).
		const extraAtPoint = i >= 0 ? this._extraBefore[i] + (this._units[i] - 1) : 0;
		const row = unit - extraAtPoint;

		// Defensive clamp — should already be in range given the bounds checks above.
		if (row < 0) return 0;
		if (row > rowCount - 1) return rowCount - 1;

		return row;
	}

	/** First index `pos` in ascending `arr` such that `arr[pos] >= value`; `arr.length` if none. */
	private static _lowerBound(arr: number[], value: number): number {
		let lo = 0;
		let hi = arr.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (arr[mid] < value) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		return lo;
	}
}
