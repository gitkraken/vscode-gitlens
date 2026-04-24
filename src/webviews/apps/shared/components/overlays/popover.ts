import type SlPopup from '@shoelace-style/shoelace/dist/components/popup/popup.js';
import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { parseDuration, waitForEvent } from '../../dom.js';
import { GlElement, observe } from '../element.js';
import { scrollableBase } from '../styles/lit/base.css.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import '../shoelace-stub.js';

// Adapted from shoelace tooltip

declare const CloseWatcher: CloseWatcher;
interface CloseWatcher extends EventTarget {
	// eslint-disable-next-line @typescript-eslint/no-misused-new
	new (options?: CloseWatcherOptions): CloseWatcher;
	requestClose(): void;
	close(): void;
	destroy(): void;

	oncancel: (event: Event) => void | null;
	onclose: (event: Event) => void | null;
}
interface CloseWatcherOptions {
	signal: AbortSignal;
}

type TriggerType = 'hover' | 'focus' | 'click' | 'manual';
type Combine<T extends string, U extends string = T> = T extends any ? T | `${T} ${Combine<Exclude<U, T>>}` : never;
type Triggers = Combine<TriggerType>;

declare global {
	interface HTMLElementTagNameMap {
		'gl-popover': GlPopover;
	}

	interface GlobalEventHandlersEventMap {
		'gl-popover-show': CustomEvent<void>;
		'gl-popover-after-show': CustomEvent<void>;
		'gl-popover-hide': CustomEvent<void>;
		'gl-popover-after-hide': CustomEvent<void>;
	}
}

type ResizeHandle = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const allResizeHandles: readonly ResizeHandle[] = [
	'top',
	'right',
	'bottom',
	'left',
	'top-left',
	'top-right',
	'bottom-left',
	'bottom-right',
] as const;

/**
 * Returns true if this handle sits on an edge anchored to the trigger — either by the placement's main axis (the side
 * opposite `placement`) or by its cross-axis alignment (`-start` pins the start edge, `-end` pins the end edge).
 * Dragging an anchored edge fights Floating UI and causes the opposite edge to move instead.
 */
function isHandleAnchored(handle: ResizeHandle, placement: string | undefined): boolean {
	if (!placement) return false;
	const [side, align] = placement.split('-');

	// Main axis: the edge opposite the placement side.
	let mainAnchored: 'top' | 'right' | 'bottom' | 'left' | undefined;
	switch (side) {
		case 'top':
			mainAnchored = 'bottom';
			break;
		case 'right':
			mainAnchored = 'left';
			break;
		case 'bottom':
			mainAnchored = 'top';
			break;
		case 'left':
			mainAnchored = 'right';
			break;
	}

	// Cross axis: -start pins the start edge (top for h-placements, left for v-placements);
	// -end pins the end edge (bottom / right).
	let crossAnchored: 'top' | 'right' | 'bottom' | 'left' | undefined;
	const horizontal = side === 'left' || side === 'right';
	if (align === 'start') {
		crossAnchored = horizontal ? 'top' : 'left';
	} else if (align === 'end') {
		crossAnchored = horizontal ? 'bottom' : 'right';
	}

	const matches = (anchored: 'top' | 'right' | 'bottom' | 'left' | undefined) =>
		anchored != null &&
		(handle === anchored || handle.startsWith(`${anchored}-`) || handle.endsWith(`-${anchored}`));

	return matches(mainAnchored) || matches(crossAnchored);
}

function parseResizeHandles(value: string | undefined): ResizeHandle[] {
	if (!value) return [];
	const result = new Set<ResizeHandle>();
	for (const token of value.trim().split(/\s+/)) {
		switch (token) {
			case 'horizontal':
				result.add('right');
				break;
			case 'vertical':
				result.add('bottom');
				break;
			case 'both':
				result.add('right');
				result.add('bottom');
				result.add('bottom-right');
				break;
			case 'all':
				for (const h of allResizeHandles) {
					result.add(h);
				}
				break;
			default:
				if ((allResizeHandles as readonly string[]).includes(token)) {
					result.add(token as ResizeHandle);
				}
		}
	}
	return [...result];
}

/**
 * @tag gl-popover
 *
 * @slot anchor - The element that triggers the popover
 * @slot content - The content of the popover
 *
 * @csspart base - Styles the sl-popup element itself
 * @csspart arrow - Styles the arrow's container
 * @csspart popup - Styles the popup's container
 * @csspart body - Styles the element that wraps the content slot
 *
 * @fires gl-popover-show - Fired when the popover is shown
 * @fires gl-popover-after-show - Fired after the popover is shown
 * @fires gl-popover-hide - Fired when the popover is hidden
 * @fires gl-popover-after-hide - Fired after the popover is hidden
 */

@customElement('gl-popover')
export class GlPopover extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	/** static registry to track all open popovers */
	private static readonly openPopovers = new Set<GlPopover>();

	private static closeOthers(openingPopover: GlPopover): void {
		for (const popover of GlPopover.openPopovers) {
			if (
				popover === openingPopover ||
				// Check if the popover contains the opening popover
				Boolean(popover.compareDocumentPosition(openingPopover) & Node.DOCUMENT_POSITION_CONTAINS)
			) {
				continue;
			}

			void popover.hide();
		}
	}

	static override styles = [
		scrollableBase,
		css`
			:host {
				--hide-delay: 0ms;
				--show-delay: 500ms;

				display: contents;
			}

			.popover {
				--arrow-size: var(--sl-tooltip-arrow-size);
				--arrow-color: var(--sl-tooltip-background-color);
			}

			.popover::part(popup) {
				z-index: var(--sl-z-index-tooltip);
			}

			.popover::part(arrow) {
				border: 1px solid var(--gl-tooltip-border-color);
				z-index: 1;
			}

			.popover[placement^='top']::part(popup) {
				transform-origin: bottom;
			}

			.popover[placement^='bottom']::part(popup) {
				transform-origin: top;
			}

			.popover[placement^='left']::part(popup) {
				transform-origin: right;
			}

			.popover[placement^='right']::part(popup) {
				transform-origin: left;
			}

			.popover[data-current-placement^='top']::part(arrow) {
				border-top-width: 0;
				border-left-width: 0;
				clip-path: polygon(0 50%, 100% 0, 100% 100%, 0 100%);
			}

			.popover[data-current-placement^='bottom']::part(arrow) {
				border-bottom-width: 0;
				border-right-width: 0;
				clip-path: polygon(0 0, 100% 0, 100% 50%, 0 100%);
			}

			.popover[data-current-placement^='left']::part(arrow) {
				border-bottom-width: 0;
				border-left-width: 0;
				clip-path: polygon(0 0, 100% 0, 100% 100%, 70% 100%, 0 30%);
			}

			.popover[data-current-placement^='right']::part(arrow) {
				border-top-width: 0;
				border-right-width: 0;
				clip-path: polygon(0 0, 0 100%, 100% 100%, 100% 70%, 30% 0);
			}

			.popover__body {
				display: block;
				width: fit-content;
				border: 1px solid var(--gl-tooltip-border-color);
				border-radius: var(--sl-tooltip-border-radius);
				box-shadow: 0 2px 8px var(--gl-tooltip-shadow);
				background-color: var(--sl-tooltip-background-color);
				font-family: var(--sl-tooltip-font-family);
				font-size: var(--sl-tooltip-font-size);
				font-weight: var(--sl-tooltip-font-weight);
				line-height: var(--sl-tooltip-line-height);
				text-align: start;
				white-space: normal;
				color: var(--sl-tooltip-color);
				padding: var(--sl-tooltip-padding);
				user-select: none;
				-webkit-user-select: none;
				max-width: min(var(--auto-size-available-width), var(--max-width, 70vw));
				pointer-events: all;
			}

			:host([auto-size-vertical]) .popover__body {
				max-height: var(--auto-size-available-height);
				display: flex;
				flex-direction: column;
				overflow: hidden;
			}

			:host([resize]) .popover__body {
				position: relative;
			}

			.popover__resizer {
				position: absolute;
				background-color: transparent;
				transition: background-color 0.1s ease-out;
				touch-action: none;
				z-index: 1;
			}

			/* Edges — 4px thick bars */
			.popover__resizer--top {
				top: 0;
				left: 0;
				right: 0;
				height: 4px;
				cursor: ns-resize;
			}
			.popover__resizer--right {
				top: 0;
				right: 0;
				bottom: 0;
				width: 4px;
				cursor: ew-resize;
			}
			.popover__resizer--bottom {
				left: 0;
				right: 0;
				bottom: 0;
				height: 4px;
				cursor: ns-resize;
			}
			.popover__resizer--left {
				top: 0;
				left: 0;
				bottom: 0;
				width: 4px;
				cursor: ew-resize;
			}

			/* Corners — 12px squares, layered above edges */
			.popover__resizer--top-left,
			.popover__resizer--top-right,
			.popover__resizer--bottom-left,
			.popover__resizer--bottom-right {
				width: 12px;
				height: 12px;
				z-index: 2;
			}
			.popover__resizer--top-left {
				top: 0;
				left: 0;
				cursor: nwse-resize;
			}
			.popover__resizer--top-right {
				top: 0;
				right: 0;
				cursor: nesw-resize;
			}
			.popover__resizer--bottom-left {
				bottom: 0;
				left: 0;
				cursor: nesw-resize;
			}
			.popover__resizer--bottom-right {
				bottom: 0;
				right: 0;
				cursor: nwse-resize;
			}

			/* Extended hit area for easier grabbing on edges */
			.popover__resizer--top::after,
			.popover__resizer--right::after,
			.popover__resizer--bottom::after,
			.popover__resizer--left::after {
				content: '';
				position: absolute;
			}
			.popover__resizer--top::after {
				left: 0;
				right: 0;
				top: -4px;
				bottom: -2px;
			}
			.popover__resizer--right::after {
				top: 0;
				bottom: 0;
				left: -2px;
				right: -4px;
			}
			.popover__resizer--bottom::after {
				left: 0;
				right: 0;
				top: -2px;
				bottom: -4px;
			}
			.popover__resizer--left::after {
				top: 0;
				bottom: 0;
				left: -4px;
				right: -2px;
			}

			.popover__resizer:hover,
			:host([dragging]) .popover__resizer--active {
				transition-delay: 0.2s;
				background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
			}
			:host([dragging]) .popover__resizer--active {
				transition-delay: 0s;
			}

			/* Override scrollbar thumb to not inherit border-color from the popover
			   body's visible border, which conflicts with the scrollableBase trick */
			.popover__body::-webkit-scrollbar-thumb {
				border-color: transparent;
			}
			:host(:hover) .popover__body::-webkit-scrollbar-thumb,
			:host(:focus-within) .popover__body::-webkit-scrollbar-thumb {
				border-color: var(--vscode-scrollbarSlider-background);
			}

			.popover[data-current-placement^='top'] .popover__body,
			.popover[data-current-placement^='bottom'] .popover__body {
				width: max-content;
			}

			:host([appearance='menu']) {
				--sl-tooltip-padding: var(--sl-spacing-2x-small);
				--sl-tooltip-font-size: var(--vscode-font-size);
				--sl-tooltip-background-color: var(--vscode-menu-background);
				--arrow-color: var(--vscode-menu-background);
			}

			[slot='anchor'] {
				width: var(--gl-popover-anchor-width, fit-content);
				max-width: 100%;
				overflow: hidden;
			}

			/* .popover::part(hover-bridge) {
				background: tomato;
				opacity: 0.5;
				z-index: 10000000000;
			} */
		`,
	];

	private closeWatcher!: CloseWatcher | null;
	private hoverTimeout!: ReturnType<typeof setTimeout>;
	private resizeObserver?: ResizeObserver;

	@query('#popover')
	body!: HTMLElement;

	@query('sl-popup')
	popup!: SlPopup;

	@property({ reflect: true })
	placement: SlPopup['placement'] = 'bottom';

	@property({ type: Object })
	anchor?: string | HTMLElement | { getBoundingClientRect: () => Omit<DOMRect, 'toJSON'> };

	@property({ reflect: true, type: Boolean })
	disabled: boolean = false;

	@property({ type: Number })
	distance: number = 8;

	@property({ reflect: true, type: Boolean })
	open: boolean = false;

	@property({ reflect: true, type: Boolean })
	arrow: boolean = true;

	/** When true, constrains the popover's height to the available viewport space and enables vertical scrolling. */
	@property({ reflect: true, type: Boolean, attribute: 'auto-size-vertical' })
	autoSizeVertical: boolean = false;

	/**
	 * When set, exposes drag-resize grips on the popover body. Accepts a space-separated list of
	 * edges/corners, or one of the shortcut keywords.
	 *
	 * Tokens: `top`, `right`, `bottom`, `left`, `top-left`, `top-right`, `bottom-left`, `bottom-right`.
	 * Shortcuts: `horizontal` (right), `vertical` (bottom), `both` (right + bottom + bottom-right corner),
	 * `all` (all 4 edges + 4 corners).
	 */
	@property({ reflect: true })
	resize?: string;

	/** The distance in pixels from which to offset the popover along its target. */
	@property({ type: Number })
	skidding = 0;

	@property()
	trigger: Triggers = 'hover focus';

	/**
	 * Enable this option to prevent the popover from being clipped when the component is placed inside a container with
	 * `overflow: auto|hidden|scroll`. Hoisting uses a fixed positioning strategy that works in many, but not all,
	 * scenarios.
	 */
	@property({ type: Boolean })
	hoist = false;

	@property({ reflect: true })
	appearance?: 'menu';

	@state() private suppressed: boolean = false;

	@state() private _resolvedPlacement?: SlPopup['placement'];

	get currentPlacement(): SlPopup['placement'] {
		return (this.popup?.getAttribute('data-current-placement') ?? this.placement) as SlPopup['placement'];
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.addEventListener('blur', this.handleTriggerBlur, true);
		this.addEventListener('focus', this.handleTriggerFocus, true);
		this.addEventListener('click', this.handleTriggerClick);
		this.addEventListener('mousedown', this.handleTriggerMouseDown);
		this.addEventListener('mouseover', this.handleMouseOver);
		this.addEventListener('mouseout', this.handleMouseOut);

		// Listen for drag events to hide popover before drag image is captured
		window.addEventListener('mouseup', this.handleMouseUp);
		window.addEventListener('dragstart', this.handleDragStart, { capture: true });
		window.addEventListener('dragend', this.handleDragEnd, { capture: true });
	}

	override disconnectedCallback(): void {
		this.removeEventListener('blur', this.handleTriggerBlur, true);
		this.removeEventListener('focus', this.handleTriggerFocus, true);
		this.removeEventListener('click', this.handleTriggerClick);
		this.removeEventListener('mousedown', this.handleTriggerMouseDown);
		this.removeEventListener('mouseover', this.handleMouseOver);
		this.removeEventListener('mouseout', this.handleMouseOut);

		// Cleanup this event in case the popover is removed while open
		this.closeWatcher?.destroy();
		document.removeEventListener('focusin', this.handlePopupBlur);
		window.removeEventListener('webview-blur', this.handleWebviewBlur, false);
		document.removeEventListener('keydown', this.handleDocumentKeyDown);
		document.removeEventListener('mousedown', this.handleDocumentMouseDown);
		window.removeEventListener('mouseup', this.handleMouseUp);
		window.removeEventListener('dragstart', this.handleDragStart, { capture: true });
		window.removeEventListener('dragend', this.handleDragEnd, { capture: true });

		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;

		// Remove this popover from the registry when it's disconnected
		GlPopover.openPopovers.delete(this);

		super.disconnectedCallback?.();
	}

	override firstUpdated(): void {
		this.body.hidden = !this.open;

		// If the popover is visible on init, update its position
		if (this.open) {
			this.popup.active = true;
			this.popup.reposition();
		}

		this.updateResizeObserver();
	}

	private updateResizeObserver(): void {
		if (this.resize != null) {
			if (this.resizeObserver == null && this.body != null) {
				this.resizeObserver = new ResizeObserver(() => this.popup?.reposition());
				this.resizeObserver.observe(this.body);
			}
		} else if (this.resizeObserver != null) {
			this.resizeObserver.disconnect();
			this.resizeObserver = undefined;
		}
	}

	override render(): unknown {
		const resolvedPlacement = this._resolvedPlacement ?? this.placement;
		const handles = parseResizeHandles(this.resize).filter(h => !isHandleAnchored(h, resolvedPlacement));
		return html`<sl-popup
			part="base"
			exportparts="
				popup:base__popup,
				arrow:base__arrow
			"
			class="popover"
			.anchor=${this.anchor}
			placement=${this.placement}
			distance=${this.distance}
			skidding=${this.skidding}
			strategy=${this.hoist ? 'fixed' : 'absolute'}
			auto-size=${this.autoSizeVertical ? 'both' : 'horizontal'}
			auto-size-padding="3"
			flip-padding="3"
			flip
			shift
			?arrow=${this.arrow}
			hover-bridge
			@sl-reposition=${this.handleReposition}
		>
			<div slot="anchor" aria-describedby="popover">
				<slot name="anchor"></slot>
			</div>

			<div
				part="body"
				id="popover"
				class="popover__body scrollable ${this.appearance === 'menu' ? 'is-menu' : ''}"
				role="tooltip"
				aria-live=${this.open ? 'polite' : 'off'}
			>
				<slot name="content"></slot>
				${handles.map(
					h =>
						html`<div
							class="popover__resizer popover__resizer--${h}"
							role="separator"
							aria-orientation=${h === 'top' || h === 'bottom' ? 'horizontal' : 'vertical'}
							aria-label="Resize"
							data-handle=${h}
							@pointerdown=${this.handleResizePointerDown}
						></div>`,
				)}
			</div>
		</sl-popup>`;
	}

	private handleReposition = (): void => {
		const p = this.popup?.getAttribute('data-current-placement') as SlPopup['placement'] | null;
		if (p != null && p !== this._resolvedPlacement) {
			this._resolvedPlacement = p;
		}
	};

	private handleResizePointerDown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		const handle = e.currentTarget as HTMLElement;
		const pos = handle.dataset.handle as ResizeHandle | undefined;
		if (pos == null) return;
		e.preventDefault();

		const growsRight = pos === 'right' || pos === 'top-right' || pos === 'bottom-right';
		const growsLeft = pos === 'left' || pos === 'top-left' || pos === 'bottom-left';
		const growsDown = pos === 'bottom' || pos === 'bottom-left' || pos === 'bottom-right';
		const growsUp = pos === 'top' || pos === 'top-left' || pos === 'top-right';

		const body = this.body;
		const startX = e.clientX;
		const startY = e.clientY;
		const startRect = body.getBoundingClientRect();
		const startWidth = startRect.width;
		const startHeight = startRect.height;

		handle.setPointerCapture(e.pointerId);
		handle.classList.add('popover__resizer--active');
		this.toggleAttribute('dragging', true);

		const onMove = (ev: PointerEvent) => {
			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			if (growsRight) {
				body.style.width = `${Math.max(0, startWidth + dx)}px`;
			} else if (growsLeft) {
				body.style.width = `${Math.max(0, startWidth - dx)}px`;
			}
			if (growsDown) {
				body.style.height = `${Math.max(0, startHeight + dy)}px`;
			} else if (growsUp) {
				body.style.height = `${Math.max(0, startHeight - dy)}px`;
			}
			this.popup?.reposition();
		};

		const cleanup = () => {
			this.toggleAttribute('dragging', false);
			handle.classList.remove('popover__resizer--active');
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('lostpointercapture', cleanup);
			handle.removeEventListener('pointerup', cleanup);
		};

		handle.addEventListener('pointermove', onMove, { passive: true });
		handle.addEventListener('lostpointercapture', cleanup);
		handle.addEventListener('pointerup', cleanup);
	};

	private _triggeredBy: TriggerType | undefined;
	/** Shows the popover. */
	async show(triggeredBy?: TriggerType): Promise<void> {
		if (this.open || this.suppressed) {
			// Allow click to upgrade from hover to "pin" the popover open
			if (triggeredBy === 'click' && this._triggeredBy === 'hover') {
				this._triggeredBy = triggeredBy;
			}
			return undefined;
		}
		if (this._triggeredBy == null || triggeredBy !== 'hover') {
			this._triggeredBy = triggeredBy;
		}

		// Close other popovers before showing this one, unless this popover is a descendant of an open popover
		GlPopover.closeOthers(this);

		this.open = true;
		// Add this popover to the registry when it's opened
		GlPopover.openPopovers.add(this);

		return waitForEvent(this, 'gl-popover-after-show');
	}

	/** Hides the popover */
	async hide(): Promise<void> {
		this._triggeredBy = undefined;
		if (!this.open) return undefined;

		this.open = false;
		// Remove this popover from the registry when it's closed
		GlPopover.openPopovers.delete(this);

		return waitForEvent(this, 'gl-popover-after-hide');
	}

	private readonly handleTriggerBlur = (e: FocusEvent) => {
		if (this.open && this.hasTrigger('focus')) {
			if (e.relatedTarget && this.contains(e.relatedTarget as Node)) return;

			void this.hide();
		}
	};

	private readonly handleTriggerClick = (e: MouseEvent) => {
		if (this.hasTrigger('click')) {
			if (this.open && this._triggeredBy !== 'hover') {
				if (this._skipHideOnClick) {
					this._skipHideOnClick = false;
					return;
				}

				const composedPath = e.composedPath();
				if (composedPath.includes(this.body)) return;

				void this.hide();
			} else {
				void this.show('click');
			}
		}
	};

	private _skipHideOnClick = false;
	private readonly handleTriggerMouseDown = (e: MouseEvent) => {
		if (this.hasTrigger('click') && this.hasTrigger('focus') && !this.matches(':focus-within')) {
			this._skipHideOnClick = true;
		} else {
			this._skipHideOnClick = false;
		}

		// Suppress and hide hover-triggered popovers on mousedown to prevent them from being included
		// in drag images — but not when the mousedown originates inside the popover body, so users can
		// interact with controls in a hover-opened popover.
		if (this.open && this._triggeredBy === 'hover' && !e.composedPath().includes(this.body)) {
			this.suppressed = true;
			void this.hide();
		}
	};

	private readonly handleMouseUp = () => {
		this.suppressed = false;
	};

	private readonly handleDragStart = () => {
		this.suppressed = true;
		void this.hide();
	};

	private readonly handleDragEnd = () => {
		this.suppressed = false;
	};

	private readonly handleTriggerFocus = () => {
		if (this.hasTrigger('focus')) {
			if (this.open && this._triggeredBy !== 'hover' && !this.hasPopupFocus()) {
				void this.hide();
			} else {
				void this.show('focus');
			}
		}
	};

	private readonly handleDocumentKeyDown = (e: KeyboardEvent) => {
		// Pressing escape when a popover is open should dismiss it
		if (e.key === 'Escape') {
			e.stopPropagation();
			void this.hide();
		}
	};

	private readonly handlePopupBlur = (e: FocusEvent) => {
		const composedPath = e.composedPath();
		if (!composedPath.includes(this) && !composedPath.includes(this.body)) {
			void this.hide();
		}
	};

	private readonly handleWebviewBlur = () => {
		void this.hide();
	};

	private readonly handleDocumentMouseDown = (e: MouseEvent) => {
		const composedPath = e.composedPath();
		if (!composedPath.includes(this) && !composedPath.includes(this.body)) {
			void this.hide();
		}
	};

	private readonly handleMouseOver = () => {
		if (this.hasTrigger('hover')) {
			clearTimeout(this.hoverTimeout);

			const delay = parseDuration(getComputedStyle(this).getPropertyValue('--show-delay'));
			this.hoverTimeout = setTimeout(() => this.show('hover'), delay);
		}
	};

	private readonly handleMouseOut = () => {
		if (this.hasTrigger('hover')) {
			clearTimeout(this.hoverTimeout);

			if (this.hasPopupFocus() || this._triggeredBy !== 'hover') return;

			const delay = parseDuration(getComputedStyle(this).getPropertyValue('--hide-delay'));
			this.hoverTimeout = setTimeout(() => this.hide(), delay);
		}
	};

	private hasPopupFocus() {
		return this.matches(':has([slot="content"]:focus-within)');
	}

	private hasTrigger(triggerType: string) {
		const triggers = this.trigger.split(' ');
		return triggers.includes(triggerType);
	}

	@observe('open', { afterFirstUpdate: true })
	handleOpenChange(): void {
		if (this.open) {
			if (this.disabled) return;

			// Show

			this.emit('gl-popover-show');
			if ('CloseWatcher' in window) {
				this.closeWatcher?.destroy();
				this.closeWatcher = new CloseWatcher();
				this.closeWatcher.onclose = () => void this.hide();
			} else {
				document.addEventListener('keydown', this.handleDocumentKeyDown);
			}
			document.addEventListener('focusin', this.handlePopupBlur);
			window.addEventListener('webview-blur', this.handleWebviewBlur, false);

			if (this.hasTrigger('click') || this.hasTrigger('focus')) {
				document.addEventListener('mousedown', this.handleDocumentMouseDown);
			}

			this.body.hidden = false;
			this.popup.active = true;
			this.popup.reposition();

			this.emit('gl-popover-after-show');
		} else {
			document.removeEventListener('focusin', this.handlePopupBlur);
			window.removeEventListener('webview-blur', this.handleWebviewBlur, false);
			document.removeEventListener('mousedown', this.handleDocumentMouseDown);

			// Hide

			this.emit('gl-popover-hide');
			this.closeWatcher?.destroy();
			document.removeEventListener('keydown', this.handleDocumentKeyDown);

			this.popup.active = false;
			this.body.hidden = true;

			this.emit('gl-popover-after-hide');
		}
	}

	@observe(['distance', 'hoist', 'placement', 'skidding'])
	async handleOptionsChange(): Promise<void> {
		if (this.hasUpdated) {
			await this.updateComplete;
			this.popup.reposition();
		}
	}

	@observe('resize', { afterFirstUpdate: true })
	handleResizeChange(): void {
		this.updateResizeObserver();
	}

	@observe('disabled')
	handleDisabledChange(): void {
		if (this.disabled && this.open) {
			void this.hide();
		}
	}
}
