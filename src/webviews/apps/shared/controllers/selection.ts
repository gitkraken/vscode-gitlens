import type { ReactiveController, ReactiveControllerHost } from 'lit';

export type SelectionMode = 'none' | 'single' | 'multi';

export interface SelectionOptions {
	/** Selection mode. Re-read on every operation so a host can flip single<->multi reactively. */
	mode?: () => SelectionMode;
	/**
	 * The ordered list of ids in collection order — used as the coordinate space for range
	 * selection. Typically `() => collectionIndex.ids()`.
	 */
	orderedIds: () => readonly string[];
	/**
	 * Whether an id may be a *member* of a multi-selection (e.g. excludes folder/branch rows and
	 * load-more sentinels). Defaults to always-selectable. Note this constrains the multi ops
	 * (toggle/range/all) only — {@link setSingle} accepts any id so single-select behavior (which
	 * highlights folders too) is preserved.
	 */
	isSelectable?: (id: string) => boolean;
	/** Invoked after any change to the selection set (host re-renders / re-emits). */
	onChange?: () => void;
}

/**
 * Set-based selection model with an anchor for range selection — the single source of truth for
 * "what is selected" across virtualized lists and trees.
 *
 * Reusable core (L1): knows nothing about DOM, trees, or rendering. In `single` mode it behaves
 * exactly like the old `tree-view` `_lastSelectedPath` (one member, selection-follows-focus); in
 * `multi` mode it adds toggle / contiguous-range / select-all. This is the dedup target that
 * prevents every list/tree from re-implementing selection.
 */
export class SelectionController implements ReactiveController {
	private _selected: Set<string> = new Set();
	private _anchorId: string | undefined;

	constructor(
		host: ReactiveControllerHost,
		private readonly options: SelectionOptions,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		/* no-op */
	}

	hostDisconnected(): void {
		/* no-op */
	}

	get mode(): SelectionMode {
		return this.options.mode?.() ?? 'single';
	}

	get selectedIds(): ReadonlySet<string> {
		return this._selected;
	}

	get size(): number {
		return this._selected.size;
	}

	get anchorId(): string | undefined {
		return this._anchorId;
	}

	has(id: string): boolean {
		return this._selected.has(id);
	}

	private isSelectable(id: string): boolean {
		return this.options.isSelectable?.(id) ?? true;
	}

	/** Whether `id` may be a multi-selection member (per the host's predicate; default true). */
	canSelect(id: string): boolean {
		return this.isSelectable(id);
	}

	private commit(next: Set<string>): void {
		this._selected = next;
		this.options.onChange?.();
	}

	/**
	 * Replace the selection with a single id and set it as the anchor — the plain-click / keyboard
	 * selection-follows-focus path. Accepts any id (folders included) to preserve single-select.
	 */
	setSingle(id: string): void {
		this._anchorId = id;
		this.commit(new Set([id]));
	}

	/**
	 * Seed the range pivot (anchor) WITHOUT changing the selection set. Used to default the anchor to
	 * the initially focused row so a *first* Shift+click / Shift+Arrow has a pivot to range from —
	 * otherwise {@link selectRange} falls back to the clicked id and collapses to a single row. A
	 * later setSingle/toggle/selectRange/clear takes over the anchor as usual.
	 */
	setAnchor(id: string): void {
		this._anchorId = id;
	}

	/** Toggle one id in/out of the selection (Ctrl/Cmd+click). Anchors on the toggled id. */
	toggle(id: string): void {
		if (!this.isSelectable(id)) return;

		const next = new Set(this._selected);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		this._anchorId = id;
		this.commit(next);
	}

	/**
	 * Select the contiguous range from the current anchor to `id` (Shift+click). When `additive` is
	 * true the range is unioned with the existing selection (Ctrl+Shift), otherwise it replaces it.
	 * Non-selectable ids inside the range (folders/sentinels) are skipped. The anchor is preserved
	 * so successive Shift+clicks re-pivot from the same origin.
	 */
	selectRange(id: string, options?: { additive?: boolean }): void {
		const ordered = this.options.orderedIds();
		const anchor = this._anchorId ?? id;
		const from = ordered.indexOf(anchor);
		const to = ordered.indexOf(id);
		if (from === -1 || to === -1) {
			this.setSingle(id);
			return;
		}

		const [lo, hi] = from <= to ? [from, to] : [to, from];
		const next = options?.additive ? new Set(this._selected) : new Set<string>();
		for (let i = lo; i <= hi; i++) {
			const rangeId = ordered[i];
			if (this.isSelectable(rangeId)) {
				next.add(rangeId);
			}
		}
		this.commit(next);
	}

	/** Select every selectable id in the collection (Ctrl/Cmd+A). */
	selectAll(): void {
		const next = new Set<string>();
		for (const id of this.options.orderedIds()) {
			if (this.isSelectable(id)) {
				next.add(id);
			}
		}
		// Nothing selectable and nothing already selected → no-op (mirrors clear()'s guard so an
		// empty collection doesn't emit a spurious change).
		if (next.size === 0 && this._selected.size === 0) return;

		this.commit(next);
	}

	clear(): void {
		if (this._selected.size === 0) return;

		this._anchorId = undefined;
		this.commit(new Set());
	}

	/**
	 * Drop any selected/anchor ids that are no longer present — call after the collection changes
	 * (filter, collapse, model swap). Mirrors the old setter's path reconciliation: survivors keep
	 * their selection, removed rows fall out.
	 */
	pruneTo(present: ReadonlySet<string> | ((id: string) => boolean)): void {
		const keep = typeof present === 'function' ? present : (id: string) => present.has(id);

		let changed = false;
		const next = new Set<string>();
		for (const id of this._selected) {
			if (keep(id)) {
				next.add(id);
			} else {
				changed = true;
			}
		}
		if (this._anchorId != null && !keep(this._anchorId)) {
			this._anchorId = undefined;
		}
		if (changed) {
			this.commit(next);
		}
	}
}
