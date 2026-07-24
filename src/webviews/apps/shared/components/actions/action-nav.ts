import { css, html, LitElement } from 'lit';
import { customElement, queryAssignedElements } from 'lit/decorators.js';

const focusableSelector = 'a[href], button, [tabindex]';

@customElement('action-nav')
export class ActionNav extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			align-items: center;
			user-select: none;
		}
	`;

	private _slotSubscriptionsDisposer?: () => void;
	private _disabledObserver?: MutationObserver;
	/** The resolved focusable controls (one per slotted child) that participate in roving. */
	private _items: HTMLElement[] = [];

	@queryAssignedElements({ flatten: true })
	private actionNodes!: HTMLElement[];

	override firstUpdated(): void {
		// Respect an explicitly-provided role (e.g. role="toolbar" for a roving toolbar); otherwise
		// keep the historical navigation-region default.
		if (!this.hasAttribute('role')) {
			this.role = 'navigation';
		}
	}

	override disconnectedCallback(): void {
		this._slotSubscriptionsDisposer?.();
		this._disabledObserver?.disconnect();

		super.disconnectedCallback?.();
	}

	override render(): unknown {
		return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
	}

	/**
	 * Resolves a slotted child to the element that actually receives focus. Focus-delegating
	 * components (gl-button, action-item, gl-copy-container) are focusable as their host, so they
	 * resolve to themselves. Transparent wrappers that render `display: contents` and do NOT delegate
	 * focus (e.g. gl-tooltip) resolve to the single focusable control they wrap — otherwise the
	 * roving tabindex we set on the wrapper would be ignored while the wrapped control kept its own.
	 */
	private resolveFocusable(node: HTMLElement): HTMLElement {
		if (node.shadowRoot != null && !node.shadowRoot.delegatesFocus) {
			return node.querySelector<HTMLElement>(focusableSelector) ?? node;
		}
		return node;
	}

	private isDisabled(el: HTMLElement): boolean {
		return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
	}

	private handleSlotChange(_e?: Event) {
		this._slotSubscriptionsDisposer?.();
		this._disabledObserver?.disconnect();

		const items = this.actionNodes.map(node => this.resolveFocusable(node));
		this._items = items;
		if (items.length < 1) return;

		const handleKeydown = this.handleKeydown.bind(this);
		const size = `${items.length}`;
		const subs = items.map((element, i) => {
			element.setAttribute('aria-posinset', `${i + 1}`);
			element.setAttribute('aria-setsize', size);
			if (items.length >= 2) {
				element.addEventListener('keydown', handleKeydown, false);
			}
			return {
				dispose: () => {
					element?.removeEventListener('keydown', handleKeydown, false);
				},
			};
		});

		// Give the roving tabindex to the first enabled control (matching the previous "first child"
		// behavior, but skipping disabled controls so Tab never lands on a dead stop).
		this.setActiveItem(this.defaultItem());

		// A control's disabled state can flip without any node being added/removed — e.g. Match Case
		// greys out when regex is off, Next disables at the last result — so no slotchange fires.
		// Watch the disabled attributes so the roving tabindex is never stranded on a disabled control.
		const observer = new MutationObserver(() => this.handleDisabledChange());
		for (const element of items) {
			observer.observe(element, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
		}
		this._disabledObserver = observer;

		this._slotSubscriptionsDisposer = () => {
			subs?.forEach(({ dispose }) => dispose());
		};
	}

	private firstEnabledItem(): HTMLElement | undefined {
		return this._items.find(el => !this.isDisabled(el));
	}

	/** The control that should hold the roving tabindex: the first ENABLED one, or — when every control is
	 *  disabled — the first control, so the toolbar always keeps exactly one tab stop (WAI-ARIA: a toolbar
	 *  with no focusable stop drops out of the tab order entirely). */
	private defaultItem(): HTMLElement | undefined {
		return this.firstEnabledItem() ?? this._items[0];
	}

	private setActiveItem(active: HTMLElement | undefined) {
		for (const el of this._items) {
			el.setAttribute('tabindex', el === active ? '0' : '-1');
		}
	}

	private handleDisabledChange() {
		const active = this._items.find(el => el.getAttribute('tabindex') === '0');
		// Only intervene when the current stop is gone or has become disabled; otherwise preserve the
		// user's roving position.
		if (active == null || this.isDisabled(active)) {
			this.setActiveItem(this.defaultItem());
		}
	}

	private handleKeydown(e: KeyboardEvent) {
		const items = this._items;
		if (items.length < 2) return;

		const current = e.currentTarget as HTMLElement;
		const currentIndex = items.indexOf(current);
		if (currentIndex === -1) return;

		let nextIndex: number | undefined;
		switch (e.key) {
			case 'ArrowLeft':
				nextIndex = this.nextEnabledIndex(currentIndex, -1);
				break;
			case 'ArrowRight':
				nextIndex = this.nextEnabledIndex(currentIndex, 1);
				break;
			case 'Home':
				nextIndex = this.nextEnabledIndex(-1, 1);
				break;
			case 'End':
				nextIndex = this.nextEnabledIndex(items.length, -1);
				break;
			default:
				return;
		}

		if (nextIndex == null || nextIndex === currentIndex) return;

		const next = items[nextIndex];
		e.preventDefault();
		e.stopPropagation();
		current.setAttribute('tabindex', '-1');
		next.setAttribute('tabindex', '0');
		next.focus();
	}

	/**
	 * Returns the index of the next enabled item starting from `from` and moving by `step` (±1),
	 * wrapping around cyclically. Returns undefined when no item is enabled.
	 */
	private nextEnabledIndex(from: number, step: number): number | undefined {
		const { length } = this._items;
		if (length === 0) return undefined;

		for (let i = 1; i <= length; i++) {
			const index = (((from + i * step) % length) + length) % length;
			if (!this.isDisabled(this._items[index])) return index;
		}
		return undefined;
	}
}
