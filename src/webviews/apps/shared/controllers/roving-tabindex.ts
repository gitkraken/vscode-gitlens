import type { ReactiveController, ReactiveControllerHost } from 'lit';

export interface RovingTabindexItem {
	/** Stable identity for the item (icon type, branch id, …). Survives re-renders so the active
	 *  tab stop is restored rather than reset to the first item on every render. */
	key: string;
	/** The element that receives the roving `tabindex` and `.focus()`. For delegatesFocus hosts
	 *  (`gl-button`, `gl-graph-overview-card`) this is the host; for plain controls it's the control. */
	element: HTMLElement;
}

export interface RovingTabindexOptions {
	/** The roving items in visual (DOM) order — VISIBLE only. Called after every host update and on
	 *  each key/focus event, so it must reflect the current DOM (folds, filters, …). */
	getItems: () => RovingTabindexItem[];
	/** 'vertical' → ArrowUp/ArrowDown; 'horizontal' → ArrowLeft/ArrowRight. Default 'vertical'. */
	orientation?: 'vertical' | 'horizontal';
	/** Key to prefer as the resting tab stop when none has been focused yet (or the tracked one is gone),
	 *  instead of the first item — e.g. a nav rail's ACTIVE panel icon. Falls back to the first item when
	 *  the key isn't present. */
	getDefaultKey?: () => string | undefined;
}

/**
 * ARIA roving-tabindex for a single toolbar group: exactly one item is in the tab order
 * (`tabindex=0`), the rest are `tabindex=-1` (reachable only by arrow keys). Arrow keys rove
 * cyclically, Home/End jump to first/last. Enter/Space are left to the items' native activation.
 *
 * The active stop is tracked by a stable {@link RovingTabindexItem.key} and re-asserted after every
 * host update (`hostUpdated`), so it survives the frequent re-renders these components do — falling
 * back to the first item only when the tracked item is gone.
 *
 * Wire {@link onKeydown} and {@link onFocusin} on the group container in the host's template.
 */
export class RovingTabindexController implements ReactiveController {
	private activeKey: string | undefined;

	constructor(
		host: ReactiveControllerHost,
		private readonly options: RovingTabindexOptions,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		/* no-op */
	}

	hostDisconnected(): void {
		/* no-op */
	}

	/** Re-assert exactly one `tabindex=0` among the current items after each render. */
	hostUpdated(): void {
		const items = this.options.getItems();
		if (items.length === 0) {
			this.activeKey = undefined;
			return;
		}

		let active: RovingTabindexItem | undefined;
		if (this.activeKey != null) {
			active = items.find(i => i.key === this.activeKey);
			if (active == null) {
				// The user's tracked stop folded away / was removed — re-home to the default (or first) and
				// persist it.
				active = this.defaultItem(items);
				this.activeKey = active.key;
			}
		} else {
			// No user interaction yet: track the default (e.g. the active-panel icon) on EVERY render
			// WITHOUT locking it — so the resting stop follows the default until the user actually focuses
			// or arrows (which sets `activeKey`). Locking here would latch onto whatever rendered first
			// (before late-laid-out items appear) and never re-evaluate.
			active = this.defaultItem(items);
		}

		for (const item of items) {
			// Guard the write: reassigning the same tabindex still churns the attribute + invalidates
			// `[tabindex]` selectors, and `active` rarely changes across the frequent host re-renders.
			const next = item === active ? 0 : -1;
			if (item.element.tabIndex !== next) {
				item.element.tabIndex = next;
			}
		}
	}

	/** The preferred resting item: the caller's default key (e.g. the active-panel icon) if present, else
	 *  the first item. */
	private defaultItem(items: RovingTabindexItem[]): RovingTabindexItem {
		const defaultKey = this.options.getDefaultKey?.();
		return items.find(i => i.key === defaultKey) ?? items[0];
	}

	/** Keep the tab stop on the last-focused item (so a click or programmatic focus updates it). */
	readonly onFocusin = (e: FocusEvent): void => {
		const item = this.itemFromEvent(e, this.options.getItems());
		if (item != null) {
			this.activeKey = item.key;
		}
	};

	readonly onKeydown = (e: KeyboardEvent): void => {
		// A modifier held with the key means the consumer reserved that combo (e.g. the graph column
		// header's Shift+Arrow reorder/resize) — leave it for the item's own handler, don't rove.
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

		let action: 'prev' | 'next' | 'first' | 'last' | undefined;
		const vertical = (this.options.orientation ?? 'vertical') === 'vertical';
		switch (e.key) {
			case 'ArrowUp':
				if (vertical) {
					action = 'prev';
				}
				break;
			case 'ArrowDown':
				if (vertical) {
					action = 'next';
				}
				break;
			case 'ArrowLeft':
				if (!vertical) {
					action = 'prev';
				}
				break;
			case 'ArrowRight':
				if (!vertical) {
					action = 'next';
				}
				break;
			case 'Home':
				action = 'first';
				break;
			case 'End':
				action = 'last';
				break;
		}
		if (action == null) return;

		const items = this.options.getItems();
		if (items.length === 0) return;

		const current = this.itemFromEvent(e, items);
		if (current == null) return; // Key came from something that isn't a roving item — leave it alone.

		e.preventDefault();
		e.stopPropagation();

		const i = items.indexOf(current);
		const n = items.length;
		const target =
			action === 'first'
				? items[0]
				: action === 'last'
					? items[n - 1]
					: action === 'prev'
						? items[(i - 1 + n) % n]
						: items[(i + 1) % n];

		this.activeKey = target.key;
		for (const item of items) {
			const next = item === target ? 0 : -1;
			if (item.element.tabIndex !== next) {
				item.element.tabIndex = next;
			}
		}
		target.element.focus();
	};

	/** Resolve which roving item an event originated from (events cross shadow boundaries from the
	 *  items' inner controls, so match against the composed path rather than `e.target`). */
	private itemFromEvent(e: Event, items: RovingTabindexItem[]): RovingTabindexItem | undefined {
		const path = e.composedPath();
		return items.find(item => path.includes(item.element));
	}
}
