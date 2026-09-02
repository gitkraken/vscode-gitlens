/** Geometry constants and pure layout math (node/row sizing, gutter width) shared by every renderer. */

import type { ProcessedGraphRow } from './engine/types.js';

// Geometry

export const rowHeightTable = 24; // `table` style: tight single-line rows (was 30 — too much vertical gap)
export const rowHeightList = 44; // `list` style: 2-line stacked rows
export const nodeRadius = 5;
export const nodeRadiusRef = 6;
export const nodeRadiusWorkdir = 7;
export const columnWidth = 18;
export const gutterPadding = 8;

/** Container width (px) below which the `auto` graph style switches from `table` to `list` (the
 *  panel is too narrow for the columns). */
export const listAutoBelow = 520;
/** Date-column width (px) at/below which the date renders in ultra-compact form ("2d" not
 *  "2 days ago"). Sized so the long form would otherwise clip. */
export const shortDateWidth = 78;

export function xForColumn(column: number, columnWidth: number): number {
	return gutterPadding + column * columnWidth + columnWidth / 2;
}

/**
 * Per-row gutter width — sized to that row's own lane footprint (commit column + max
 * edge column passing through). In inline placement we use this so the message text
 * snaps tight to *this* row's right-most lane edge instead of being pushed out by the
 * widest row in the visible set. Standalone-gutter mode keeps a fixed `totalGutterWidth`
 * so all rows align under the same column.
 */
export function rowGutterWidth(row: ProcessedGraphRow, columnWidth: number): number {
	const max = Math.max(row.column, row.edgeColumnMax);
	return gutterPadding * 2 + (max + 1) * columnWidth;
}

// Graph style modes

/**
 * Graph style (row layout):
 *   - `table` — single-line rows (`rowHeightTable`), metadata in columns (5 visible, or fewer if narrow)
 *   - `list`  — 2-line stacked rows (`rowHeightList`), all metadata stacked under the message, no columns
 *   - `auto`  — switch to `list` when the container is narrower than `listAutoBelow`, else `table`
 */
export type GraphStyle = 'table' | 'list' | 'auto';

/** {@link GraphStyle} after `auto` has been resolved against the container width. */
export type ResolvedGraphStyle = Exclude<GraphStyle, 'auto'>;

/**
 * Where the SVG gutter (lanes + nodes) is placed relative to the content columns:
 *   - `column`  — its own gutter column ahead of the content zones (classic look).
 *   - `grouped` — folded into another column; the lanes render inline within a shared column
 *                (the graph is grouped with the message/refs rather than standing alone).
 *   - `hidden`  — the gutter is not rendered.
 */
export type GraphPlacement = 'column' | 'grouped' | 'hidden';

/**
 * Where the refs ("branch / tag / remote" chips) adornment is placed. Same domain as
 * {@link GraphPlacement} today (`column` / `grouped` / `hidden`); named separately for intent and
 * possible future divergence.
 */
export type RefsPlacement = GraphPlacement;
