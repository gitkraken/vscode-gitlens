import type { ScopeItem } from './gl-commits-scope-pane.js';

export type ScopeMode = 'compose' | 'review';

/**
 * Default start index. If any uncommitted (WIP) items exist, start at the first one so the default
 * selection covers only the WIP rows. Otherwise start at 0.
 */
export function getDefaultStart(items: readonly ScopeItem[]): number {
	const firstWip = items.findIndex(i => i.state === 'uncommitted');
	if (firstWip >= 0) return firstWip;
	return 0;
}

/**
 * Default end index, derived from items:
 *  - If any WIP items exist, end at the last WIP item (select WIP only).
 *  - Else, end at the last unpushed (non-pushed, non-merge-base, non-load-more) item.
 *  - Else, end at the first item.
 */
export function getDefaultEnd(items: readonly ScopeItem[]): number {
	let lastWip = -1;
	let lastUnpushed = -1;
	for (let i = 0; i < items.length; i++) {
		const state = items[i].state;
		if (state === 'uncommitted') {
			lastWip = i;
		}
		if (state !== 'pushed' && state !== 'merge-base' && state !== 'load-more') {
			lastUnpushed = i;
		}
	}
	if (lastWip >= 0) return lastWip;
	if (lastUnpushed >= 0) return lastUnpushed;
	return 0;
}

/**
 * Shallowest index the end (bottom) handle may reach. Compose-only: a selection containing the
 * unstaged row must also contain the staged row — unstaged diffs are relative to the index, so
 * composing unstaged changes without the staged ones is ill-defined (the engine cannot exclude
 * staged content from a working-directory source). Review's diff calls handle staged/unstaged
 * independently, so it has no such floor.
 */
export function getMinEndIndex(mode: ScopeMode, items: readonly ScopeItem[], rangeStart: number): number {
	if (mode !== 'compose') return rangeStart;

	const unstagedIndex = items.findIndex(i => i.id === 'unstaged');
	if (unstagedIndex < 0 || rangeStart > unstagedIndex) return rangeStart;

	const stagedIndex = items.findIndex(i => i.id === 'staged');
	return stagedIndex >= 0 ? Math.max(rangeStart, stagedIndex) : rangeStart;
}

/** Effective start: resolves stored ID to index, falls back to default-start. */
export function resolveStartIndex(items: readonly ScopeItem[], startId: string | undefined): number {
	if (startId != null) {
		const idx = items.findIndex(item => item.id === startId);
		if (idx >= 0) return idx;
	}
	return getDefaultStart(items);
}

/**
 * Effective end: resolves stored/derived end (falls back to default-end), then clamps UP to the
 * floor. Clamping here — not only in the interactive drag/keyboard/click writers — is what keeps a
 * range derived from the controlled `selection` prop (e.g. after a working-tree change adds a staged
 * row under an unstaged-ending selection) from rendering a floor-violating, unstaged-only scope.
 */
export function resolveEndIndex(
	mode: ScopeMode,
	items: readonly ScopeItem[],
	endId: string | undefined,
	rangeStart: number,
): number {
	let raw = getDefaultEnd(items);
	if (endId != null) {
		const idx = items.findIndex(item => item.id === endId);
		if (idx >= 0) {
			raw = idx;
		}
	}
	return Math.max(raw, getMinEndIndex(mode, items, rangeStart));
}

/**
 * Scans `items` for the contiguous range spanned by `selection` (a set of item IDs) and returns
 * the first/last matching indices — or `undefined` when none of the selected IDs resolve against
 * the current items. That happens when a working-changes row disappears out from under the stored
 * selection (e.g. the user stages/unstages everything while the picker is open), so callers treat
 * `undefined` as "the stored selection can no longer be honored" and fall back to the auto-derived
 * default range ({@link getDefaultStart}/{@link getDefaultEnd}).
 */
export function resolveSelectionRange(
	items: readonly ScopeItem[],
	selection: readonly string[] | undefined,
): { start: number; end: number } | undefined {
	if (!selection?.length) return undefined;

	const selected = new Set(selection);
	let start = -1;
	let end = -1;
	for (let i = 0; i < items.length; i++) {
		if (!selected.has(items[i].id)) continue;

		if (start === -1) {
			start = i;
		}
		end = i;
	}
	if (start === -1 || end === -1) return undefined;

	return { start: start, end: end };
}
