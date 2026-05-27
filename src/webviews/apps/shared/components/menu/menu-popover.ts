import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { GlElement } from '../element.js';
import type { GlPopover } from '../overlays/popover.js';
import type { MenuItem } from './menu-item.js';
import '../code-icon.js';
import '../overlays/popover.js';
import './menu-item.js';
import './menu-list.js';

export interface GlMenuPopoverItem {
	label: string;
	value: string;
	selected?: boolean;
	disabled?: boolean;
}

/**
 * @tag gl-menu-popover
 *
 * A menu rendered inside a `gl-popover` (menu appearance). Consumers supply the trigger via the
 * `anchor` slot and the menu options via the `items` property — this component owns the popover
 * wiring, the dismiss-on-select behavior, and keyboard navigation.
 *
 * Items are rendered into this component's own shadow DOM (rather than accepted as slotted
 * `menu-item` light children) on purpose: slotting menu content through an extra shadow boundary
 * into `gl-popover`'s top-layer popup breaks pointer hit-testing — clicks fall through to the
 * content behind the menu. Rendering them here keeps the same slot depth as a plain `gl-popover`
 * usage, which hit-tests correctly.
 *
 * @slot anchor - The element that triggers the menu
 * @fires gl-menu-select - Fired with `{ value }` when an item is chosen (click or Enter/Space)
 */
@customElement('gl-menu-popover')
export class GlMenuPopover extends GlElement {
	static override styles = css`
		:host {
			display: contents;
		}

		/* Strip menu-list's standalone chrome (its own border + asymmetric bottom padding) — inside
		   the popover's menu-mode body it just needs a small symmetric vertical pad so the first/
		   last item clear the body padding. */
		menu-list {
			padding: 0.2rem 0;
			border: 0;
			background: transparent;
		}

		menu-item {
			display: flex;
			align-items: center;
			gap: 0.4rem;
		}

		/* Fixed-width check column so labels align whether or not an item is selected — the
		   unselected items render a blank icon that occupies the column invisibly. */
		menu-item code-icon {
			flex: 0 0 1.4rem;
		}
	`;

	@query('gl-popover')
	private _popover?: GlPopover;

	@property({ type: Array })
	items: GlMenuPopoverItem[] = [];

	@property()
	placement: GlPopover['placement'] = 'bottom-end';

	@property({ type: Boolean })
	disabled: boolean = false;

	/**
	 * When set, the menu stays open after a selection (e.g. the timeline period menu, where the
	 * user sweeps through ranges) — outside-click and Escape still dismiss via `gl-popover`. The
	 * default (unset) is dismiss-on-select, which is what most menus want.
	 */
	@property({ type: Boolean, attribute: 'keep-open-on-select' })
	keepOpenOnSelect: boolean = false;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('keydown', this.handleKeydown);
		this.addEventListener('gl-popover-after-show', this.handleAfterShow);
		this.addEventListener('gl-popover-after-hide', this.handleAfterHide);
	}

	override disconnectedCallback(): void {
		this.removeEventListener('keydown', this.handleKeydown);
		this.removeEventListener('gl-popover-after-show', this.handleAfterShow);
		this.removeEventListener('gl-popover-after-hide', this.handleAfterHide);
		super.disconnectedCallback?.();
	}

	private get _menuItems(): MenuItem[] {
		return [...(this.shadowRoot?.querySelectorAll('menu-item') ?? [])];
	}

	/** On open, focus the selected item (or the first enabled one) so arrow keys work immediately.
	 *  Deferred to the next frame: focusing synchronously on `after-show` races the trigger click's
	 *  own focus handling and the popup's first layout, and the `.focus()` doesn't stick. */
	private readonly handleAfterShow = (): void => {
		requestAnimationFrame(() => {
			if (this._popover?.open !== true) return;

			const items = this._menuItems.filter(i => !i.disabled);
			const selected = items.find(i => i.getAttribute('aria-selected') === 'true');
			(selected ?? items[0])?.focus();
		});
	};

	/**
	 * On close, return focus to the trigger — but only if focus is still inside the (closing) menu
	 * (e.g. closed via Escape or a selection). If the user clicked elsewhere, leave focus alone.
	 */
	private readonly handleAfterHide = (): void => {
		if (this._menuItems.some(i => i.matches(':focus'))) {
			this.querySelector<HTMLElement>('[slot="anchor"]')?.focus();
		}
	};

	/** ArrowUp/ArrowDown/Home/End rove focus among the (enabled) items; Enter/Space are handled by
	 *  `menu-item` itself (→ `click` → {@link onItemClick}). */
	private readonly handleKeydown = (e: KeyboardEvent): void => {
		if (this._popover?.open !== true) return;

		const { key } = e;
		if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;

		const items = this._menuItems.filter(i => !i.disabled);
		if (items.length === 0) return;

		e.preventDefault();

		const current = items.findIndex(i => i.matches(':focus'));
		let next: number;
		if (key === 'Home') {
			next = 0;
		} else if (key === 'End') {
			next = items.length - 1;
		} else if (key === 'ArrowDown') {
			next = current < 0 ? 0 : (current + 1) % items.length;
		} else {
			next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
		}
		items[next]?.focus();
	};

	private onItemClick(item: GlMenuPopoverItem, e: Event): void {
		if (item.disabled) return;

		// Stop the click at the item: if it reaches `gl-popover`'s own click handler, that handler
		// sees the popover as already-closed (once we `hide()` below) and immediately re-opens it
		// via `show('click')`. Stopping propagation lets us hide synchronously with no race — a
		// deferred hide (`queueMicrotask`/`setTimeout`) is unreliable because event phases and
		// microtask draining interleave differently across input sources.
		e.stopPropagation();

		this.emit('gl-menu-select', { value: item.value });

		if (!this.keepOpenOnSelect) {
			void this._popover?.hide();
		}
	}

	override render(): unknown {
		return html`<gl-popover
			appearance="menu"
			placement=${this.placement}
			trigger="click"
			?disabled=${this.disabled}
			.arrow=${false}
			.distance=${2}
		>
			<slot name="anchor" slot="anchor"></slot>
			<menu-list slot="content">
				${this.items.map(
					item =>
						html`<menu-item
							aria-selected=${item.selected ? 'true' : 'false'}
							?disabled=${item.disabled}
							@click=${(e: Event) => this.onItemClick(item, e)}
						>
							<code-icon icon=${item.selected ? 'check' : 'blank'}></code-icon>
							<span>${item.label}</span>
						</menu-item>`,
				)}
			</menu-list>
		</gl-popover>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-menu-popover': GlMenuPopover;
	}

	interface GlobalEventHandlersEventMap {
		'gl-menu-select': CustomEvent<{ value: string }>;
	}
}
