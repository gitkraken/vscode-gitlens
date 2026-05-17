import type WaPopup from '@awesome.me/webawesome/dist/components/popup/popup.js';
import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { handleUnsafeOverlayContent } from './overlays.utils.js';
import '@awesome.me/webawesome/dist/components/popup/popup.js';

let _tooltipIdCounter = 0;

const dismissibleStack: GlTooltip[] = [];
function isTopDismissible(tooltip: GlTooltip): boolean {
	return dismissibleStack.at(-1) === tooltip;
}

@customElement('gl-tooltip')
export class GlTooltip extends LitElement {
	static override styles = css`
		:host {
			--max-width: var(--gl-tooltip-max-width, 320px);

			display: contents;
			max-width: inherit;
			overflow: inherit;
			text-transform: var(--gl-tooltip-text-transform, none);
		}

		.tooltip {
			--arrow-size: var(--wa-tooltip-arrow-size);
			--arrow-color: var(--wa-tooltip-background-color);
			/* tells wa-popup to overlap the arrow with the inside edge of our 1px body
			   border, so the arrow base aligns with the body's content area instead of
			   sitting on top of the border line */
			--popup-border-width: 1px;
		}

		.tooltip::part(popup) {
			z-index: var(--wa-z-index-tooltip);
			pointer-events: none;
		}

		/* Suppress the corner-flash that happens on first open: wa-popup adds the popup
		   to the DOM with active=true a microtask BEFORE floating-ui computes its position,
		   so the popup briefly renders at top:0/left:0 (page corner) for one paint frame.
		   wa-popup sets data-current-placement once positioned — gate visibility on that
		   so the user never sees the unpositioned frame. Verified live: the unpositioned
		   frame lands at (0,0) ~1ms before the positioned frame lands at the anchor. */
		.tooltip:not([data-current-placement]) .tooltip__body {
			visibility: hidden;
		}

		.tooltip__body {
			max-width: min(var(--auto-size-available-width, 100vw), var(--max-width));
			border: 1px solid var(--gl-tooltip-border-color);
			border-radius: var(--wa-tooltip-border-radius);
			background-color: var(--wa-tooltip-background-color);
			box-shadow: 0 2px 8px var(--gl-tooltip-shadow);
			color: var(--wa-tooltip-color);
			font-family: var(--wa-tooltip-font-family);
			font-size: var(--wa-tooltip-font-size);
			font-weight: var(--wa-tooltip-font-weight);
			line-height: var(--wa-tooltip-line-height);
			padding: var(--wa-tooltip-padding);
			text-align: start;
			text-transform: var(--gl-tooltip-text-transform, none);
			white-space: normal;
			user-select: none;
			-webkit-user-select: none;
		}

		/* Style hr inside the tooltip body. The slot[name=content] selector matches
		   fallback content, which is where handleUnsafeOverlayContent puts the hr it
		   generates from "\n\n" in a .content string (e.g. gl-copy-container's tooltip).
		   Slotted content from consumers lives in their light DOM and isn't reachable
		   from here — those consumers need their own [slot=content] hr rule. */
		slot[name='content'] hr {
			border: none;
			border-top: 1px solid var(--color-foreground--25);
			margin: 0.4rem 0;
		}
	`;

	@property()
	content?: string;

	@property({ reflect: true })
	placement: WaPopup['placement'] = 'bottom';

	@property({ type: Boolean })
	disabled: boolean = false;

	@property({ type: Number })
	distance: number = 8;

	@property({ type: Number, attribute: 'show-delay' })
	showDelay: number = 500;

	@property({ type: Number, attribute: 'hide-delay' })
	hideDelay: number = 0;

	@property({ type: Boolean, attribute: 'hide-on-click' })
	hideOnClick?: boolean;

	@query('wa-popup')
	private popup!: WaPopup;

	@state() private suppressed: boolean = false;
	@state() private open: boolean = false;

	private readonly bodyId = `gl-tooltip-${++_tooltipIdCounter}`;
	private hoverTimeout: ReturnType<typeof setTimeout> | undefined;
	private eventController: AbortController | undefined;
	private anchorEl: Element | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.eventController = new AbortController();
		const { signal } = this.eventController;

		// Listen on the host so events bubble from BOTH the slotted anchor (light DOM)
		// and the popup body (shadow DOM) — needed so mouseout from the popup body to
		// elsewhere correctly schedules a hide.
		this.addEventListener('mouseover', this.onMouseOver, { signal: signal });
		this.addEventListener('mouseout', this.onMouseOut, { signal: signal });
		this.addEventListener('focusin', this.onFocusIn, { signal: signal });
		this.addEventListener('focusout', this.onFocusOut, { signal: signal });
		this.addEventListener('mousedown', this.onMouseDown, { signal: signal });
		this.addEventListener('click', this.onClick, { signal: signal });
		window.addEventListener('mouseup', this.onMouseUp, { signal: signal });
		window.addEventListener('dragstart', this.onDragStart, { capture: true, signal: signal });
		window.addEventListener('dragend', this.onDragEnd, { capture: true, signal: signal });
	}

	override disconnectedCallback(): void {
		this.eventController?.abort();
		this.eventController = undefined;
		this.detachAnchor();
		this.unregisterDismissible();
		clearTimeout(this.hoverTimeout);
		super.disconnectedCallback?.();
	}

	override updated(changedProperties: Map<string, unknown>): void {
		if (changedProperties.has('open')) {
			if (this.open) {
				this.registerDismissible();
			} else {
				this.unregisterDismissible();
			}
		}
		if (changedProperties.has('disabled') && this.disabled && this.open) {
			this.open = false;
		}
	}

	private readonly onAnchorSlotChange = (e: Event): void => {
		const slot = e.target as HTMLSlotElement;
		const next = slot.assignedElements({ flatten: true })[0];
		if (next === this.anchorEl) return;

		this.detachAnchor();
		this.attachAnchor(next);
	};

	private attachAnchor(el: Element | undefined): void {
		if (el == null) return;

		this.anchorEl = el;
		this.addAriaDescribedBy(el, this.bodyId);
	}

	private detachAnchor(): void {
		if (this.anchorEl == null) return;

		this.removeAriaDescribedBy(this.anchorEl, this.bodyId);
		// Listeners are scoped to the eventController signal; nothing else to remove.
		this.anchorEl = undefined;
	}

	private addAriaDescribedBy(element: Element, id: string): void {
		const current = element.getAttribute('aria-describedby') ?? '';
		const ids = current.split(/\s+/).filter(Boolean);
		if (ids.includes(id)) return;

		ids.push(id);
		element.setAttribute('aria-describedby', ids.join(' '));
	}

	private removeAriaDescribedBy(element: Element, id: string): void {
		const current = element.getAttribute('aria-describedby') ?? '';
		const ids = current.split(/\s+/).filter(Boolean);
		const remaining = ids.filter(x => x !== id);
		if (remaining.length === 0) {
			element.removeAttribute('aria-describedby');
		} else {
			element.setAttribute('aria-describedby', remaining.join(' '));
		}
	}

	private registerDismissible(): void {
		if (dismissibleStack.includes(this)) return;

		dismissibleStack.push(this);
		document.addEventListener('keydown', this.onDocumentKeyDown, {
			signal: this.eventController?.signal,
		});
	}

	private unregisterDismissible(): void {
		const i = dismissibleStack.indexOf(this);
		if (i !== -1) {
			dismissibleStack.splice(i, 1);
		}
		document.removeEventListener('keydown', this.onDocumentKeyDown);
	}

	private readonly onDocumentKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape' || !this.open || !isTopDismissible(this)) return;

		e.preventDefault();
		e.stopPropagation();
		this.open = false;
	};

	private readonly onMouseOver = (): void => {
		if (this.disabled || this.suppressed) return;

		clearTimeout(this.hoverTimeout);
		this.hoverTimeout = setTimeout(() => {
			this.open = true;
		}, this.showDelay);
	};

	private readonly onMouseOut = (): void => {
		// Don't dismiss if the pointer is still over the anchor or moved onto the tooltip itself.
		if (this.anchorEl?.matches(':hover') || this.matches(':hover')) return;

		clearTimeout(this.hoverTimeout);
		this.hoverTimeout = setTimeout(() => {
			this.open = false;
		}, this.hideDelay);
	};

	private readonly onFocusIn = (): void => {
		if (this.disabled || this.suppressed) return;

		clearTimeout(this.hoverTimeout);
		this.open = true;
	};

	private readonly onFocusOut = (): void => {
		clearTimeout(this.hoverTimeout);
		this.open = false;
	};

	private readonly onMouseDown = (_e: MouseEvent): void => {
		this.suppressed = true;
		this.open = false;
	};

	private readonly onMouseUp = (_e: MouseEvent): void => {
		this.suppressed = false;
	};

	private readonly onDragStart = (_e: DragEvent): void => {
		this.suppressed = true;
		this.open = false;
	};

	private readonly onDragEnd = (_e: DragEvent): void => {
		this.suppressed = false;
	};

	private readonly onClick = (_e: MouseEvent): void => {
		if (this.hideOnClick) {
			this.open = false;
		}
	};

	async hide(): Promise<void> {
		this.open = false;
		await this.updateComplete;
	}

	async show(): Promise<void> {
		if (this.disabled || this.suppressed) return;

		this.open = true;
		await this.updateComplete;
	}

	override render(): unknown {
		return html`<wa-popup
			part="base"
			exportparts="
				popup:base__popup,
				arrow:base__arrow
			"
			class="tooltip"
			placement=${this.placement}
			distance=${this.distance}
			?active=${this.open && !this.disabled && !this.suppressed}
			flip
			flip-padding="3"
			shift
			shift-padding="3"
			auto-size="horizontal"
			auto-size-padding="3"
			arrow
			hover-bridge
		>
			<slot slot="anchor" @slotchange=${this.onAnchorSlotChange}></slot>
			<div
				part="body"
				id=${this.bodyId}
				class="tooltip__body"
				role="tooltip"
				aria-live=${this.open ? 'polite' : 'off'}
			>
				<slot name="content">${handleUnsafeOverlayContent(this.content)}</slot>
			</div>
		</wa-popup>`;
	}
}
