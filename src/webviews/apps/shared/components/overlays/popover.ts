import type SlPopup from '@shoelace-style/shoelace/dist/components/popup/popup.js';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import { parseDuration, waitForEvent } from '../../dom';
import { GlElement, observe } from '../element';

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

type LastOf<T> = UnionToIntersection<T extends any ? () => T : never> extends () => infer R ? R : never;
type Push<T extends any[], V> = [...T, V];
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type TriggerCombinationHelper<T extends TriggerType, U extends TriggerType[] = []> = {
	[K in T]: K extends LastOf<U>
		? TriggerCombinationHelper<Exclude<T, K>, Push<U, K>>
		: `${U extends [] ? '' : `${U[number]} `}${K}` | TriggerCombinationHelper<Exclude<T, K>, Push<U, K>>;
}[T];

type Triggers = TriggerCombinationHelper<TriggerType>;

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

@customElement('gl-popover')
export class GlPopover extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
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
			/* max-height: var(--auto-size-available-height);
			overflow: auto; */
			pointer-events: all;
		}

		.popover[data-current-placement^='top'] .popover__body,
		.popover[data-current-placement^='bottom'] .popover__body {
			width: max-content;
		}

		/* .popover::part(hover-bridge) {
			background: tomato;
			opacity: 1;
			z-index: 10000000000;
		} */
	`;

	private closeWatcher!: CloseWatcher | null;
	private hoverTimeout!: ReturnType<typeof setTimeout>;

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

	get currentPlacement() {
		return (this.popup?.getAttribute('data-current-placement') ?? this.placement) as SlPopup['placement'];
	}

	constructor() {
		super();

		this.addEventListener('blur', this.handleTriggerBlur, true);
		this.addEventListener('focus', this.handleTriggerFocus, true);
		this.addEventListener('click', this.handleTriggerClick);
		this.addEventListener('mouseover', this.handleMouseOver);
		this.addEventListener('mouseout', this.handleMouseOut);
	}

	override disconnectedCallback() {
		// Cleanup this event in case the popover is removed while open
		this.closeWatcher?.destroy();
		document.removeEventListener('focusin', this.handlePopupBlur);
		window.removeEventListener('webview-blur', this.handleWebviewBlur, false);
		document.removeEventListener('keydown', this.handleDocumentKeyDown);
	}

	override firstUpdated() {
		this.body.hidden = !this.open;

		// If the popover is visible on init, update its position
		if (this.open) {
			this.popup.active = true;
			this.popup.reposition();
		}
	}

	private handleTriggerBlur = (e: FocusEvent) => {
		if (this.open && this.hasTrigger('focus')) {
			const composedPath = e.composedPath();
			if (composedPath.includes(this)) return;

			void this.hide();
		}
	};

	private handleTriggerClick = () => {
		if (this.hasTrigger('click')) {
			if (this.open) {
				void this.hide();
			} else {
				void this.show();
			}
		}
	};

	private handleTriggerFocus = () => {
		if (this.hasTrigger('focus')) {
			void this.show();
		}
	};

	private handleDocumentKeyDown = (e: KeyboardEvent) => {
		// Pressing escape when a popover is open should dismiss it
		if (e.key === 'Escape') {
			e.stopPropagation();
			void this.hide();
		}
	};

	private handlePopupBlur = (e: FocusEvent) => {
		const composedPath = e.composedPath();
		if (!composedPath.includes(this)) {
			void this.hide();
		}
	};

	private handleWebviewBlur = () => {
		void this.hide();
	};

	private handleMouseOver = () => {
		if (this.hasTrigger('hover')) {
			clearTimeout(this.hoverTimeout);

			const delay = parseDuration(getComputedStyle(this).getPropertyValue('--show-delay'));
			this.hoverTimeout = setTimeout(() => this.show(), delay);
		}
	};

	private handleMouseOut = (e: MouseEvent) => {
		if (this.hasTrigger('hover')) {
			clearTimeout(this.hoverTimeout);

			const composedPath = e.composedPath();
			if (composedPath[composedPath.length - 2] === this) return;

			if (this.hasPopupFocus()) return;

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
	handleOpenChange() {
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

			this.body.hidden = false;
			this.popup.active = true;
			this.popup.reposition();

			this.emit('gl-popover-after-show');
		} else {
			document.removeEventListener('focusin', this.handlePopupBlur);
			window.removeEventListener('webview-blur', this.handleWebviewBlur, false);

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
	async handleOptionsChange() {
		if (this.hasUpdated) {
			await this.updateComplete;
			this.popup.reposition();
		}
	}

	@observe('disabled')
	handleDisabledChange() {
		if (this.disabled && this.open) {
			void this.hide();
		}
	}

	/** Shows the popover. */
	async show() {
		if (this.open) return undefined;

		this.open = true;
		return waitForEvent(this, 'gl-popover-after-show');
	}

	/** Hides the popover */
	async hide() {
		if (!this.open) return undefined;

		this.open = false;
		return waitForEvent(this, 'gl-popover-after-hide');
	}

	override render() {
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
			auto-size="horizontal"
			auto-size-padding="3"
			flip-padding="3"
			flip
			shift
			?arrow=${this.arrow}
			hover-bridge
		>
			<div slot="anchor" aria-describedby="popover">
				<slot name="anchor"></slot>
			</div>

			<div
				part="body"
				id="popover"
				class="popover__body"
				role="tooltip"
				aria-live=${this.open ? 'polite' : 'off'}
			>
				<slot name="content"></slot>
			</div>
		</sl-popup>`;
	}
}
