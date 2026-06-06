import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ReadonlyCollectionIndex } from './collection-index.js';
import type { VirtualScrollController } from './virtual-scroll.js';

/**
 * How focus is surfaced to assistive tech:
 *  - `activedescendant`: keyboard focus stays on the scroll container; the active row is advertised
 *    via `aria-activedescendant` (the tree / combobox model). The host renders the attribute.
 *  - `roving`: DOM focus moves to the active row element itself (the listbox/option model).
 */
export type FocusStrategy = 'activedescendant' | 'roving';

export interface FocusOptions {
	index: ReadonlyCollectionIndex;
	scroll?: VirtualScrollController;
	strategy?: FocusStrategy;
	/** The focusable scroll container (activedescendant strategy focuses this). */
	getContainer?: () => HTMLElement | undefined;
	/** Resolve the row element for an id (roving strategy). Defaults to `[data-id="..."]` under the container. */
	getElementForId?: (id: string) => HTMLElement | undefined;
	onChange?: () => void;
}

/**
 * Tracks the focused row (the keyboard cursor) independently of selection, and moves/scrolls it.
 *
 * Reusable core (L1). In `activedescendant` mode it reproduces `tree-view`'s container-focus +
 * `aria-activedescendant` model (`_focusedItemPath` / `_focusedItemIndex` / `focusItemAtIndex` /
 * `getCurrentFocusedIndex`). Selection-follows-focus is NOT baked in here — the host decides whether
 * a focus move also updates the selection (single mode does; multi mode's Ctrl+Arrow does not).
 */
export class FocusController implements ReactiveController {
	private _focusedId: string | undefined;
	private _focusedIndex = -1;
	private _containerHasFocus = false;
	private _connected = false;

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options: FocusOptions,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		this._connected = true;
	}

	hostDisconnected(): void {
		this._connected = false;
	}

	get strategy(): FocusStrategy {
		return this.options.strategy ?? 'activedescendant';
	}

	get focusedId(): string | undefined {
		return this._focusedId;
	}

	get focusedIndex(): number {
		return this._focusedIndex;
	}

	/**
	 * Raw cursor mutators — set state WITHOUT scrolling or notifying, mirroring a plain field
	 * assignment. For hosts migrating incrementally that drive `requestUpdate`/scroll themselves.
	 */
	setFocusedId(id: string | undefined): void {
		this._focusedId = id;
	}

	setFocusedIndex(index: number): void {
		this._focusedIndex = index;
	}

	get containerHasFocus(): boolean {
		return this._containerHasFocus;
	}

	setContainerHasFocus(value: boolean): void {
		if (this._containerHasFocus === value) return;

		this._containerHasFocus = value;
		this.host.requestUpdate();
	}

	/** Resolve the current focused index, preferring the live path lookup over the cached index. */
	currentIndex(): number {
		const index = this.options.index;
		if (this._focusedId != null) {
			const i = index.indexOf(this._focusedId);
			if (i !== -1) return i;
		}
		if (this._focusedIndex >= 0 && this._focusedIndex < index.size) {
			return this._focusedIndex;
		}
		return index.size > 0 ? 0 : -1;
	}

	/** Focus the row at `index` (clamped), scroll it into view, and notify. */
	focusIndex(index: number, options?: { scroll?: boolean; restoreFocus?: boolean }): void {
		const count = this.options.index.size;
		if (count === 0) return;

		const clamped = Math.max(0, Math.min(index, count - 1));
		const id = this.options.index.idAt(clamped);
		if (id == null) return;

		this._focusedId = id;
		this._focusedIndex = clamped;
		this.options.onChange?.();
		this.host.requestUpdate();

		if (options?.scroll !== false) {
			this.options.scroll?.scrollToIndex(clamped, { restoreFocus: options?.restoreFocus ?? true });
		}
	}

	/** Focus a specific id (no-op if absent). */
	setFocused(id: string, options?: { scroll?: boolean }): void {
		const i = this.options.index.indexOf(id);
		if (i === -1) return;

		this.focusIndex(i, { scroll: options?.scroll });
	}

	move(delta: number, options?: { scroll?: boolean }): void {
		const next = this.currentIndex() + delta;
		this.focusIndex(next, { scroll: options?.scroll });
	}

	first(): void {
		this.focusIndex(0);
	}

	last(): void {
		this.focusIndex(this.options.index.size - 1);
	}

	pageBy(direction: 1 | -1, pageSize: number): void {
		this.move(direction * Math.max(1, pageSize));
	}

	/**
	 * Move actual DOM focus onto the focused row (roving) or container (activedescendant), scrolling
	 * first so the element exists in the virtualized window. Mirrors the rebase/list dance:
	 * scroll -> rAF -> focus by `[data-id]`.
	 */
	focusElement(id?: string): void {
		const targetId = id ?? this._focusedId;
		if (targetId == null) return;

		const i = this.options.index.indexOf(targetId);
		if (i !== -1) {
			this.options.scroll?.scrollToIndex(i, { restoreFocus: false });
		}

		requestAnimationFrame(() => {
			// The host may have disconnected between the scroll request and this frame; don't
			// steal focus back to a torn-down/re-purposed container.
			if (!this._connected) return;

			if (this.strategy === 'roving') {
				const el =
					this.options.getElementForId?.(targetId) ??
					this.options.getContainer?.()?.querySelector<HTMLElement>(`[data-id="${cssEscape(targetId)}"]`);
				el?.focus();
			} else {
				this.options.getContainer?.()?.focus();
			}
		});
	}

	/**
	 * Reconcile focus after the collection changes (filter/collapse/model swap): keep the focused id
	 * if it survives, else fall back to the nearest positional neighbor, else clear. Mirrors the old
	 * `set model` reconciliation.
	 */
	reconcile(): void {
		const index = this.options.index;
		if (this._focusedId != null) {
			const i = index.indexOf(this._focusedId);
			if (i !== -1) {
				this._focusedIndex = i;
				return;
			}

			if (index.size > 0) {
				const clamped = Math.max(0, Math.min(this._focusedIndex, index.size - 1));
				this._focusedIndex = clamped;
				this._focusedId = index.idAt(clamped);
			} else {
				this._focusedId = undefined;
				this._focusedIndex = -1;
			}
		} else if (index.size > 0) {
			this._focusedId = index.idAt(0);
			this._focusedIndex = 0;
		}
	}

	/** Seed focus to the first row if nothing is focused yet (e.g. on container/filter focus). */
	seedFirstIfUnset(): void {
		if (this._focusedId != null) return;
		if (this.options.index.size === 0) return;

		this._focusedId = this.options.index.idAt(0);
		this._focusedIndex = 0;
	}
}

/** Minimal CSS.escape fallback for attribute selectors (ids can contain `/`, `.`, etc.). */
function cssEscape(value: string): string {
	const cssApi = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
	return cssApi?.escape != null ? cssApi.escape(value) : value.replace(/["\\]/g, '\\$&');
}
