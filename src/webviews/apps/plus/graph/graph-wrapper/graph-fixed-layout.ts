import { FlowLayout } from '@lit-labs/virtualizer/layouts/flow.js';
import { RowUnitsIndex } from './graph-row-units.js';

// Minimal structural mirrors of @lit-labs/virtualizer's internal layout value types. The package's
// `exports` map does not expose `layouts/shared/Layout.js`, so `Positions`/`Size` aren't importable —
// but they're tiny, stable shapes, and our overrides only need to be assignable to FlowLayout's.
type LayoutPositions = {
	left: number;
	top: number;
	width?: number;
	height?: number;
	xOffset?: number;
	yOffset?: number;
};
type LayoutSize = { width: number; height: number };

/** Layout specifier for `.layout=${...}` on `<lit-virtualizer>` (mirrors the `flow()` specifier). */
export type FixedSizeLayoutSpecifier = {
	type: typeof FixedSizeVerticalLayout;
	direction: 'vertical';
	itemSize: number;
	units?: RowUnitsIndex;
};

/**
 * A constant-item-size vertical layout for `<lit-virtualizer>`. Graph rows are UNIFORM height per
 * density (expanded / compact), so `flow()`'s measurement is pure overhead: it reads every child's
 * `getBoundingClientRect` on each range change and derives positions from averaged/estimated sizes,
 * which drift onto sub-pixel boundaries. This layout instead positions row `idx` at exactly
 * `idx * itemSize` and never measures — precisely the `idx * rowHeight` math the graph already assumes
 * everywhere (reveal / scroll / pill geometry), now made exact. The size changes only when the density's
 * row height changes (rare), via the `itemSize` config.
 *
 * Rows are uniform per density EXCEPT for a sparse set of quantized (integer-multiple-of-`itemSize`)
 * "tall" rows, tracked by an optional `RowUnitsIndex` (see `./graph-row-units.js`) set via the `units`
 * config. Positions and sizes for tall rows remain exact arithmetic through that index — no measurement
 * is introduced. When no `units` index is set (or it's explicitly `RowUnitsIndex.uniform`), every index
 * lookup is the identity (`unitPosOf(i) === i`, `unitsOf(i) === 1`), so the hooks below are identical BY
 * CONSTRUCTION to before tall rows existed — no separate uniform code path to keep in sync.
 *
 * Implemented by SUBCLASSING `FlowLayout` — the only exported layout whose `BaseLayout` machinery
 * (viewport/scroll/reflow/scroll-into-view) we can inherit (`BaseLayout` itself isn't in the package's
 * `exports`). We override just the size/position/active-range hooks, bypassing flow's variable-size
 * anchor+estimate logic entirely; the inherited reflow/scroll-into-view then operate on exact sizes.
 */
export class FixedSizeVerticalLayout extends FlowLayout {
	// The uniform row height (px). Set via config; kept in sync with the density's row height.
	private _fixedSize = 1;

	// The sparse tall-row index. Defaults to the no-tall-rows singleton, matching pre-`units` behavior.
	private _units: RowUnitsIndex = RowUnitsIndex.uniform;

	// No child measurement — sizes are known and uniform (overrides flow's `true`), so the virtualizer
	// never measures a child and never calls `updateItemSizes`.
	override get measureChildren(): boolean {
		return false;
	}

	set itemSize(size: number) {
		// Guarded: a real change reflows (new positions + scroll size); an unchanged one is a no-op, so
		// re-applying config every render (the virtualize directive does) costs nothing.
		if (size > 0 && size !== this._fixedSize) {
			this._fixedSize = size;
			this._triggerReflow();
		}
	}
	get itemSize(): number {
		return this._fixedSize;
	}

	set units(index: RowUnitsIndex | undefined) {
		// Guarded by instance identity, not value equality: re-applying the same `RowUnitsIndex` every
		// render (the virtualize directive does) costs nothing, and a genuinely new index (even one with
		// the same tall rows) reflows. `undefined` normalizes to the `uniform` singleton (no tall rows).
		// The identity guard is only cheap because producers hold their instance STABLE across
		// content-equal rebuilds (see `RowUnitsIndex.equalsIndex` and gl-lit-graph's `rebuildRowUnits`) —
		// a producer that hands over a fresh-but-equal index every tick reflows the whole list every tick.
		const next = index ?? RowUnitsIndex.uniform;
		if (next !== this._units) {
			this._units = next;
			this._triggerReflow();
		}
	}
	get units(): RowUnitsIndex {
		return this._units;
	}

	// `width` here feeds only scroll-into-view centering, never the row DOM size (rows keep their own CSS
	// box) — the viewport width is the natural value.
	override _getItemSize(idx: number): LayoutSize {
		return { height: this._units.unitsOf(idx) * this._fixedSize, width: this._viewDim2 };
	}

	// Vertical-only: exact top, no leading margin/offset — so no sub-pixel drift.
	override _getItemPosition(idx: number): LayoutPositions {
		return { top: this._units.unitPosOf(idx) * this._fixedSize, left: 0 };
	}

	override _updateScrollSize(): void {
		this._scrollSize = Math.max(1, this._units.totalUnits(this.items.length) * this._fixedSize);
	}

	override _getActiveItems(): void {
		const size = this._fixedSize;
		const count = this.items.length;
		if (this._viewDim1 === 0 || count === 0 || size <= 0) {
			this._first = -1;
			this._last = -1;
			this._physicalMin = 0;
			this._physicalMax = 0;
			return;
		}

		// The active range covers the viewport plus the base overhang buffer, rounded out to whole rows.
		// `floor(min)`/`ceil(max)` guarantee `_physicalMin <= min` and `_physicalMax >= max`, so
		// BaseLayout's threshold check (which decides whether another reflow is needed) never thrashes.
		const min = Math.max(0, this._scrollPosition - this._overhang);
		const max = Math.min(this._scrollSize, this._scrollPosition + this._viewDim1 + this._overhang);

		// Floor/ceil overhang math computed in "unit" space and mapped back to row indices through the
		// index — a tall row straddling `min`/`max` still gets fully included, so `_physicalMin <= min` and
		// `_physicalMax >= max` hold. With no tall rows every lookup is the identity (`unitPos === index`),
		// so this reduces to plain `min / size` / `max / size` row arithmetic.
		const firstAtUnit = Math.max(0, Math.floor(min / size));
		const lastAtUnit = Math.max(0, Math.ceil(max / size) - 1);
		this._first = this._units.rowIndexAtUnit(firstAtUnit, count);
		this._last = Math.max(this._first, this._units.rowIndexAtUnit(lastAtUnit, count));
		this._physicalMin = this._units.unitPosOf(this._first) * size;
		this._physicalMax = (this._units.unitPosOf(this._last) + this._units.unitsOf(this._last)) * size;
	}

	protected override get _delta(): number {
		return this._fixedSize;
	}
}

/** `.layout=${fixedSizeVertical(rowHeight, units)}` — the fixed-size vertical layout specifier. */
export function fixedSizeVertical(itemSize: number, units?: RowUnitsIndex): FixedSizeLayoutSpecifier {
	return { type: FixedSizeVerticalLayout, direction: 'vertical', itemSize: itemSize, units: units };
}
