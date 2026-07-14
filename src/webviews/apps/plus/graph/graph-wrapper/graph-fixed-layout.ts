import { FlowLayout } from '@lit-labs/virtualizer/layouts/flow.js';

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
 * Implemented by SUBCLASSING `FlowLayout` — the only exported layout whose `BaseLayout` machinery
 * (viewport/scroll/reflow/scroll-into-view) we can inherit (`BaseLayout` itself isn't in the package's
 * `exports`). We override just the size/position/active-range hooks, bypassing flow's variable-size
 * anchor+estimate logic entirely; the inherited reflow/scroll-into-view then operate on exact sizes.
 */
export class FixedSizeVerticalLayout extends FlowLayout {
	// The uniform row height (px). Set via config; kept in sync with the density's row height.
	private _fixedSize = 1;

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

	// `width` here feeds only scroll-into-view centering, never the row DOM size (rows keep their own CSS
	// box) — the viewport width is the natural value.
	override _getItemSize(_idx: number): LayoutSize {
		return { height: this._fixedSize, width: this._viewDim2 };
	}

	// Vertical-only: exact top, no leading margin/offset — so no sub-pixel drift.
	override _getItemPosition(idx: number): LayoutPositions {
		return { top: idx * this._fixedSize, left: 0 };
	}

	override _updateScrollSize(): void {
		this._scrollSize = Math.max(1, this.items.length * this._fixedSize);
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
		this._first = Math.max(0, Math.min(count - 1, Math.floor(min / size)));
		this._last = Math.max(0, Math.min(count - 1, Math.ceil(max / size) - 1));
		this._physicalMin = this._first * size;
		this._physicalMax = (this._last + 1) * size;
	}

	protected override get _delta(): number {
		return this._fixedSize;
	}
}

/** `.layout=${fixedSizeVertical(rowHeight)}` — the fixed-size vertical layout specifier. */
export function fixedSizeVertical(itemSize: number): FixedSizeLayoutSpecifier {
	return { type: FixedSizeVerticalLayout, direction: 'vertical', itemSize: itemSize };
}
