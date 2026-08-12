/**
 * Framework-agnostic view-model for the commit graph: geometry constants, the multi-zone
 * column layout, density/placement/search enums, scroll-marker types, and the pure layout
 * math shared by every renderer. No DOM, no rendering framework — keep it that way.
 */

import type { ProcessedGraphRow } from './engine/types.js';
import type { ChangesColumnMode } from './stats.js';

// Date formatting

/**
 * Lightweight relative-time formatter for commit dates. Consumers can override per-render
 * by passing a `formatDate` prop; otherwise this English-default is used. No i18n
 * dependency in the package — keeping the surface focused on the graph itself.
 */
export function relativeTime(date: number): string {
	if (!Number.isFinite(date)) return '';

	const diff = Date.now() - date;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

/**
 * Ultra-compact relative-time formatter ("5m", "3h", "2d", "4w", "6mo", "1y") used when the
 * date column is too narrow for the verbose "N days ago" form. No "ago" suffix — the column
 * header already labels the column as a date, so the bare magnitude reads cleanly.
 *
 * Pass `now` to make the result deterministic — a test that pins it, a snapshot, or a host that
 * keeps its own clock. Omitted, it reads the wall clock, which is what a live renderer wants.
 */
export function relativeTimeShort(date: number, now: number = Date.now()): string {
	if (!Number.isFinite(date)) return '';

	const diff = now - date;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;

	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	if (days < 30) return `${Math.floor(days / 7)}w`;
	if (days < 365) return `${Math.floor(days / 30)}mo`;
	return `${Math.floor(days / 365)}y`;
}

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

// Multi-zone column layout

export type ZoneId = 'ref' | 'message' | 'author' | 'datetime' | 'changes' | 'sha';

/** Every column the header can address — the content {@link ZoneId}s plus the gutter, which takes a
 *  column slot of its own when {@link GraphPlacement} is `column`. The engine lays the gutter out
 *  separately from the content zones, but consumers reorder, hide, and resize all of them together. */
export type ColumnId = ZoneId | 'graph';

/** The gutter column's density mode; `undefined` is the default (expanded) lane spacing. */
export type GraphColumnMode = 'compact';

/** Per-column display mode, discriminated by which column carries it: the Changes column takes a
 *  {@link ChangesColumnMode}, the gutter takes a {@link GraphColumnMode}. Typed rather than `string`
 *  so a consumer persisting or forwarding these cannot invent a value the engine won't render. */
export type ColumnMode = ChangesColumnMode | GraphColumnMode;

export interface ZoneSpec {
	id: ZoneId;
	label: string;
	/** Preferred (persisted/saved) pixel width — the "ideal" used as the expansion-recovery target. */
	width: number;
	/** Minimum draggable width (hard floor). */
	minWidth: number;
	/** Optional soft ceiling. Honored for every zone EXCEPT the fill zone (which absorbs slack). */
	maxWidth?: number;
	/** Per-column display mode — see {@link ColumnMode}. */
	mode?: ColumnMode;
	/** Runtime solved width (set by `solveZoneLayout`) — the actual rendered px. Falls back to `width`
	 * before the first solve. NOT persisted; only `width` (the preferred) round-trips to settings. */
	currentWidth?: number;
	/** When true, this is the elastic "fill" zone that absorbs slack (only one expected). */
	flex?: boolean;
	/** When true, the zone is omitted from rendering (user-toggled column hide). */
	hidden?: boolean;
}

// minWidth floors: ref 32 and message 50 (flex) match the legacy gitkraken-components zones;
// author (34) is the floor that still fits its content: at/below the floor the cell drops the name and
// shows only the 1.8rem avatar, so 34 = that avatar + the zone's 0.8rem×2 border-box padding — the
// legacy 32 left the content box 2px narrower than the avatar (VS Code's injected webview default
// `img { max-width: 100% }` then squished the circle into an oval; the stylesheet also counters that,
// but the floor should fit the avatar regardless);
// date (44) is tighter than the legacy 50 since it renders in ultra-compact form ("2d") when narrow;
// changes (36) is below the legacy CHANGES_ZONE_MIN_WIDTH of 50 on purpose — the cell degrades to a
// single centered glyph at that floor (see `changesStageForWidth`), so it stays useful where the old
// full-width viz would have clipped. 36 = the 1.6rem glyph + the zone's 0.8rem×2 border-box padding +
// ~0.2rem×2 breathing room, so the glyph never clips against the cell edges. The column also DEFAULTS to
// this width (`width === minWidth`; see the host's `defaultGraphColumnsSettings`), so out of the box it
// shows the compact glyph until the user widens it;
// sha (44) keeps ~3 monospace chars + an ellipsis at the floor.
export const defaultZones: readonly ZoneSpec[] = [
	{ id: 'ref', label: 'Branches / Tags', width: 180, minWidth: 32 },
	{ id: 'message', label: 'Message', width: 0, minWidth: 50, flex: true },
	{ id: 'author', label: 'Author', width: 140, minWidth: 34 },
	{ id: 'changes', label: 'Changes', width: 36, minWidth: 36, mode: 'bar' },
	{ id: 'datetime', label: 'Date', width: 80, minWidth: 44 },
	{ id: 'sha', label: 'SHA', width: 76, minWidth: 44 },
];

/**
 * Merge a consumer-supplied zone overlay onto `defaultZones`. The overlay's order wins —
 * any default zones not mentioned in the overlay are appended at the end (so a future
 * version of commit-graph that adds a zone won't be silently dropped by an older settings blob).
 * Overlay entries inherit `label` / `minWidth` / `flex` / `mode` defaults when absent.
 */
export function mergeZones(
	defaults: readonly ZoneSpec[],
	overlay: readonly ZoneSpec[] | undefined,
): readonly ZoneSpec[] {
	if (overlay == null || overlay.length === 0) return defaults;

	const defaultsById = new Map(defaults.map(z => [z.id, z]));
	const seen = new Set<ZoneId>();
	const out: ZoneSpec[] = [];
	for (const o of overlay) {
		const d = defaultsById.get(o.id);
		if (d == null) continue;

		seen.add(o.id);
		out.push({
			...d,
			...o,
			label: o.label ?? d.label,
			minWidth: o.minWidth ?? d.minWidth,
			flex: o.flex ?? d.flex,
			mode: o.mode ?? d.mode,
		});
	}
	for (const d of defaults) {
		if (!seen.has(d.id)) {
			out.push(d);
		}
	}
	return out;
}

// Stateful zero-scroll column layout (the new Lit renderer): treats width allocation as a zero-sum
// game so the visible zones ALWAYS sum to the available width (Σ currentWidth = target) — no flex
// drift, no horizontal scrollbar. The elastic "fill" zone absorbs slack; everything else holds its
// solved width. See `solveZoneLayout` / `dragResizeZone`.

const fillZoneFallbackOrder: readonly ZoneId[] = ['message', 'author', 'datetime', 'changes', 'sha'];

/**
 * Index of the elastic fill zone. An explicitly configured `flex` zone wins; otherwise the first
 * available content zone in Message → Author → Date → Changes → SHA order stretches. Refs is only a
 * last-resort fallback when every content zone is absent.
 */
function fillZoneIndex(zones: readonly ZoneSpec[]): number {
	const i = zones.findIndex(z => z.flex);
	if (i >= 0) return i;

	for (const id of fillZoneFallbackOrder) {
		const fallback = zones.findIndex(z => z.id === id);
		if (fallback >= 0) return fallback;
	}
	return zones.length - 1;
}

/** True when `zone` is the active fill zone for this set. */
function isFillZone(zone: ZoneSpec, zones: readonly ZoneSpec[]): boolean {
	return zones[fillZoneIndex(zones)]?.id === zone.id;
}

/** Clamp a width to a zone's [minWidth, maxWidth]; the fill zone is exempt from its max ceiling. */
function clampZoneWidth(zone: ZoneSpec, isFill: boolean, width: number): number {
	if (isFill) return Math.max(zone.minWidth, width);
	return Math.max(zone.minWidth, Math.min(zone.maxWidth ?? Infinity, width));
}

/**
 * Solve `currentWidth` for every zone so they sum EXACTLY to `targetWidth` (the zero-scroll
 * invariant). Single bulk pass (O(n)):
 *  - slack (Σ < target): grow non-fill zones back toward their preferred width first (expansion
 *    recovery), then dump the remainder into the fill zone;
 *  - deficit (Σ > target): shrink the fill zone first, then the rest right-to-left down to their floors.
 * Seeds from `currentWidth ?? width`. Rounds to whole px, parking the rounding remainder on the fill
 * zone so the sum is exact. Returns a new array (zones cloned); input is not mutated.
 */
export function solveZoneLayout(zones: readonly ZoneSpec[], targetWidth: number): ZoneSpec[] {
	const fillIdx = fillZoneIndex(zones);
	const work = zones.map((z, i) => ({
		...z,
		flex: i === fillIdx,
		currentWidth: clampZoneWidth(z, i === fillIdx, z.currentWidth ?? z.width),
	}));
	if (work.length === 0) return work;

	let total = 0;
	for (const z of work) {
		total += z.currentWidth;
	}
	let delta = targetWidth - total;

	if (delta > 0) {
		// Expansion: recover non-fill zones toward their preferred width, then the fill takes the rest.
		for (let i = 0; i < work.length && delta > 0; i++) {
			const z = work[i];
			if (i === fillIdx) continue;

			const limit = Math.min(z.maxWidth ?? Infinity, z.width);
			if (z.currentWidth < limit) {
				const grow = Math.min(delta, limit - z.currentWidth);
				z.currentWidth += grow;
				delta -= grow;
			}
		}
		if (delta > 0) {
			work[fillIdx].currentWidth += delta;
			delta = 0;
		}
	} else if (delta < 0) {
		// Deficit: shrink zones RIGHT-TO-LEFT to their floors — purely positional, so the rightmost visible
		// column yields first whatever it is (columns are reorderable) and the leftmost columns keep their
		// width longest. The fill zone is NOT privileged here (unlike expansion, where it absorbs slack), so
		// a left-of-center fill (e.g. Message) holds its width until the columns to its right are exhausted.
		let deficit = -delta;
		for (let i = work.length - 1; i >= 0 && deficit > 0; i--) {
			const z = work[i];
			if (z.currentWidth > z.minWidth) {
				const take = Math.min(deficit, z.currentWidth - z.minWidth);
				z.currentWidth -= take;
				deficit -= take;
			}
		}
		// Residual deficit means Σ minWidths > target (the list-style switch should prevent this); leave at floors.
	}

	// Whole-px rounding, parking the remainder on the fill zone so Σ == target exactly (no sub-px gap).
	let rounded = 0;
	for (const z of work) {
		z.currentWidth = Math.round(z.currentWidth);
		rounded += z.currentWidth;
	}
	const fix = Math.round(targetWidth) - rounded;
	if (fix > 0) {
		work[fillIdx].currentWidth += fix;
	} else if (fix < 0) {
		// Σ minWidths can exceed target in a narrow panel; draining it all onto fill could go negative.
		// Take from fill down to its floor first, then right-to-left across zones above theirs (mirrors
		// the deficit pass); residual (only when Σ floors ≥ target) is left at floors.
		let remaining = -fix;
		const fillZone = work[fillIdx];
		const fromFill = Math.min(remaining, Math.max(0, fillZone.currentWidth - fillZone.minWidth));
		fillZone.currentWidth -= fromFill;
		remaining -= fromFill;
		for (let i = work.length - 1; i >= 0 && remaining > 0; i--) {
			const z = work[i];
			if (z.currentWidth > z.minWidth) {
				const take = Math.min(remaining, z.currentWidth - z.minWidth);
				z.currentWidth -= take;
				remaining -= take;
			}
		}
	}
	return work;
}

/**
 * Apply a column-boundary drag: the splitter sits between zone `idx` (left) and `idx + 1` (right) and
 * cascades SYMMETRICALLY. The column on the side the boundary moves AWAY from grows; the columns on the
 * side it moves TOWARD collapse to their floors one after another (nearest the boundary first):
 *   • drag right (`deltaX > 0`): column `idx` grows; cascade-shrink `idx+1, idx+2, …` (rightward).
 *   • drag left  (`deltaX < 0`): column `idx+1` grows; cascade-shrink `idx, idx-1, …` (leftward).
 * The redistribution is zero-sum, so the zero-scroll invariant holds automatically (no whole-layout
 * re-solve). The applied amount is bounded by the growing column's headroom (the fill zone is exempt
 * from its max) AND the cascade side's total shrink capacity, so the handle stops once that side is
 * exhausted instead of overflowing. Returns the updated zones plus the ids of every column that changed
 * (to persist), or `null` for a non-boundary handle (last column). The fill zone still absorbs slack on
 * window/graph resizes via `solveZoneLayout`; drags are explicit cascades.
 */
export function dragResizeZone(
	startZones: readonly ZoneSpec[],
	idx: number,
	deltaX: number,
): { zones: ZoneSpec[]; savedIds: ZoneId[] } | null {
	if (idx < 0 || idx + 1 >= startZones.length) return null;

	const fillIdx = fillZoneIndex(startZones);
	const next = startZones.map((z, i) => ({
		...z,
		flex: i === fillIdx,
		currentWidth: z.currentWidth ?? z.width,
	}));
	const movingRight = deltaX >= 0;
	const grow = next[movingRight ? idx : idx + 1];
	// Indices that cascade-shrink, nearest the boundary first (rightward when dragging right, leftward
	// when dragging left). The growing column gains exactly what they collectively give up.
	const cascade: number[] = [];
	if (movingRight) {
		for (let j = idx + 1; j < next.length; j++) {
			cascade.push(j);
		}
	} else {
		for (let j = idx; j >= 0; j--) {
			cascade.push(j);
		}
	}
	let shrinkCap = 0;
	for (const j of cascade) {
		shrinkCap += next[j].currentWidth - next[j].minWidth;
	}
	const growMax = isFillZone(grow, startZones)
		? Number.POSITIVE_INFINITY
		: (grow.maxWidth ?? Number.POSITIVE_INFINITY);
	const amount = Math.min(Math.abs(deltaX), growMax - grow.currentWidth, shrinkCap);
	if (amount <= 0) return { zones: next, savedIds: [] };

	grow.currentWidth += amount;
	const changed: ZoneId[] = [grow.id];
	let remaining = amount;
	for (const j of cascade) {
		if (remaining <= 0) break;

		const take = Math.min(remaining, next[j].currentWidth - next[j].minWidth);
		if (take > 0) {
			next[j].currentWidth -= take;
			remaining -= take;
			changed.push(next[j].id);
		}
	}
	return { zones: next, savedIds: changed };
}

/**
 * Map a visible-list index back to its canonical position in the full `zones` array.
 * Supports both item indices (0..visible.length-1) and "gap" indices
 * (0..visible.length, where `visible.length` means "after the last visible zone").
 *
 * Needed because resize/reorder handlers operate on the canonical (unfiltered) list,
 * but the user only sees the filtered subset — the same zone has different indices in
 * the two arrays when some zones are hidden by responsive breakpoints.
 */
export function mapVisibleIndex(
	zones: readonly ZoneSpec[],
	visible: readonly ZoneSpec[],
	visibleIndex: number,
): number {
	// "After the last visible zone" → the gap right after that zone in the canonical array, NOT
	// the very end (zones.length): a drop there must land before any responsive-hidden trailing
	// zones, otherwise the moved column persists after them and reorders wrong once they reappear.
	if (visibleIndex >= visible.length) {
		const lastVisible = visible.at(-1);
		if (lastVisible == null) return zones.length;

		return zones.findIndex(z => z.id === lastVisible.id) + 1;
	}

	const targetId = visible[visibleIndex]?.id;
	if (targetId == null) return -1;
	return zones.findIndex(z => z.id === targetId);
}

/**
 * Move the zone at `fromIdx` into the gap before `toIdx`. Gap indices: 0 = before first
 * zone, N = after last zone. Returns a new array; bails out (no-op) when the move would
 * not change ordering.
 */
export function reorderZones(zones: readonly ZoneSpec[], fromIdx: number, toIdx: number): ZoneSpec[] {
	if (fromIdx < 0 || fromIdx >= zones.length) return zones.slice();

	// Account for the slice removal: when moving to a position past the source, the target
	// index shifts down by one.
	const adjustedTarget = toIdx > fromIdx ? toIdx - 1 : toIdx;
	if (adjustedTarget === fromIdx) return zones.slice();

	const next = zones.slice();
	const [moved] = next.splice(fromIdx, 1);
	next.splice(adjustedTarget, 0, moved);
	return next;
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
