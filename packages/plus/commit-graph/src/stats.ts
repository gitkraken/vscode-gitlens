/**
 * Pure math for the Changes column's per-row diffstat visualizations (numbers/squares/bar/bipolar).
 * No DOM, no rendering framework, no GitLens imports — keep it that way so it stays unit-testable
 * in the Node runner and reusable by any renderer.
 */

/** A row's file/line diffstat counts driving every Changes-column visualization. */
export interface RowStats {
	files: number;
	additions: number;
	deletions: number;
}

export type ChangesColumnMode = 'numbers' | 'squares' | 'bar' | 'bipolar';

function isChangesColumnMode(mode: string): mode is ChangesColumnMode {
	return mode === 'numbers' || mode === 'squares' || mode === 'bar' || mode === 'bipolar';
}

/** Narrow a persisted/free-form mode string to a known {@link ChangesColumnMode}; unknown values default to `'bar'`. */
export function changesModeOrDefault(mode: string | undefined): ChangesColumnMode {
	return mode != null && isChangesColumnMode(mode) ? mode : 'bar';
}

/**
 * Width-driven degradation of the Changes cell as the column narrows:
 * - `full`    — files icon + count + magnitude viz (the default cell)
 * - `compact` — count + viz (files icon dropped)
 * - `mini`    — viz track only (count dropped)
 * - `icon`    — a single centered glyph (the count survives on the row's hover card + aria-label)
 */
export type ChangesColumnStage = 'full' | 'compact' | 'mini' | 'icon';

/** Column width (px) at/above which the cell renders `full`. */
export const changesStageFull = 110;
/** Column width (px) at/above which the cell renders `compact`. */
export const changesStageCompact = 76;
/** Column width (px) at/above which the cell renders `mini`; below it renders the `icon` glyph. */
export const changesStageMini = 44;

/** Map a solved column width to its {@link ChangesColumnStage}. */
export function changesStageForWidth(width: number): ChangesColumnStage {
	if (width >= changesStageFull) return 'full';
	if (width >= changesStageCompact) return 'compact';
	if (width >= changesStageMini) return 'mini';
	return 'icon';
}

/** Churn (additions + deletions) ceiling — beyond this, visual magnitude saturates at 1. */
export const changesChurnClamp = 1600;
const sqrtChurnClamp = Math.sqrt(changesChurnClamp);
/** Pixel width of the bar/bipolar track. */
export const changesTrackWidth = 78;

/** Square-root-scaled magnitude (0..1) for a churn amount, clamped at {@link changesChurnClamp}. */
export function changesMagnitude(churn: number): number {
	if (churn <= 0) return 0;
	return Math.min(1, Math.sqrt(churn) / sqrtChurnClamp);
}

export interface ChangesBarWidths {
	barWidth: number;
	addedWidth: number;
	deletedWidth: number;
}

/** Single-track bar widths: overall bar sized by total-churn magnitude, split proportionally added/deleted. */
export function computeChangesBarWidths(additions: number, deletions: number): ChangesBarWidths {
	const total = additions + deletions;
	const mag = changesMagnitude(total);
	const barWidth = Math.max(6, mag * changesTrackWidth);
	const safeTotal = total || 1;
	const addedWidth = (additions / safeTotal) * barWidth;
	const deletedWidth = (deletions / safeTotal) * barWidth;
	return { barWidth: barWidth, addedWidth: addedWidth, deletedWidth: deletedWidth };
}

export type ChangesSquareFill = 'added' | 'deleted' | 'empty';

/**
 * Always exactly 5 cells: leading `added`, then `deleted`, remainder `empty`, split by additions/deletions
 * share, with either side's minority sliver guaranteed at least 1 cell (and the majority capped so the
 * minority's guaranteed cell always fits).
 */
export function computeChangesSquares(additions: number, deletions: number): readonly ChangesSquareFill[] {
	const total = additions + deletions || 1;
	const greens = Math.min(
		deletions > 0 ? 4 : 5,
		Math.max(additions > 0 ? 1 : 0, Math.round((5 * additions) / total)),
	);
	const reds = Math.min(Math.max(deletions > 0 ? 1 : 0, Math.round((5 * deletions) / total)), 5 - greens);

	const cells: ChangesSquareFill[] = [];
	for (let i = 0; i < 5; i++) {
		cells.push(i < greens ? 'added' : i < greens + reds ? 'deleted' : 'empty');
	}
	return cells;
}

export interface ChangesBipolarWidths {
	addedWidth: number;
	deletedWidth: number;
}

/** Two-sided widths: added/deleted each scaled independently (not against each other) to a half-track. */
export function computeChangesBipolarWidths(additions: number, deletions: number): ChangesBipolarWidths {
	const half = changesTrackWidth / 2;
	return { addedWidth: changesMagnitude(additions) * half, deletedWidth: changesMagnitude(deletions) * half };
}

/** File-count label for the cell's files segment, capped so a huge count never blows out the column. */
export function formatChangesFiles(files: number): string {
	return files > 999 ? '999+' : String(files);
}

/**
 * Added/deleted line label for the `numbers` mode. Exact by default; when `compact` (the column has
 * narrowed past `full`), four-digit-plus counts abbreviate to `"1.8k"` / `"12k"` so both sides keep
 * fitting instead of clipping mid-number.
 */
export function formatChangesLines(lines: number, compact: boolean): string {
	if (!compact || lines < 1000) return String(lines);

	const k = lines / 1000;
	return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : String(Math.round(k))}k`;
}

export interface ChangesRingArcs {
	/** End of the additions arc, in degrees clockwise from 12 o'clock (start is 0). */
	addDeg: number;
	/** Start of the deletions arc, in degrees clockwise from 12 o'clock (it runs from here to 360). */
	delFromDeg: number;
}

/**
 * Conic-gradient stops for the icon-stage "churn ring" (the `bar`/`bipolar` collapse). One total-churn
 * sweep — sized by {@link changesMagnitude} like `bar`, NOT each side independently — split by the
 * additions/deletions ratio: additions arc clockwise from 12 o'clock (`0 → addDeg`), deletions arc
 * counter-clockwise from 12 o'clock (`delFromDeg → 360`), the gap between them left as the track. Deletions
 * living on the opposite side of the axis makes add/delete positional (grayscale-safe, no notch needed).
 */
export function computeChangesRingArcs(additions: number, deletions: number): ChangesRingArcs {
	const total = additions + deletions;
	const sweep = changesMagnitude(total) * 360;
	const addDeg = total > 0 ? sweep * (additions / total) : 0;
	const delDeg = sweep - addDeg;
	return { addDeg: addDeg, delFromDeg: 360 - delDeg };
}
