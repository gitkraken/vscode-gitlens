import type SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { setDefaultAnimation } from '@shoelace-style/shoelace/dist/utilities/animation-registry.js';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { handleUnsafeOverlayContent } from './overlays.utils';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

setDefaultAnimation('tooltip.show', null);
setDefaultAnimation('tooltip.hide', null);

@customElement('gl-tooltip')
export class GlTooltip extends LitElement {
	static override styles = css`
		sl-tooltip {
			--max-width: var(--gl-tooltip-max-width, 320px);
			--hide-delay: 0ms;
			--show-delay: var(--gl-tooltip-show-delay, 500ms);
		}

		sl-tooltip::part(base__popup) {
			pointer-events: none;
		}

		sl-tooltip::part(body) {
			border: 1px solid var(--gl-tooltip-border-color);
			box-shadow: 0 2px 8px var(--gl-tooltip-shadow);
		}

		sl-tooltip::part(base__arrow) {
			border: 1px solid var(--gl-tooltip-border-color);
			z-index: 1;
		}

		:host {
			text-transform: var(--gl-tooltip-text-transform, inherit);
		}

		:host([data-current-placement^='top']) sl-tooltip::part(base__arrow) {
			border-top-width: 0;
			border-left-width: 0;
		}

		:host([data-current-placement^='bottom']) sl-tooltip::part(base__arrow) {
			border-bottom-width: 0;
			border-right-width: 0;
		}

		:host([data-current-placement^='left']) sl-tooltip::part(base__arrow) {
			border-bottom-width: 0;
			border-left-width: 0;
		}

		:host([data-current-placement^='right']) sl-tooltip::part(base__arrow) {
			border-top-width: 0;
			border-right-width: 0;
		}

		[slot='content'] hr {
			border: none;
			border-top: 1px solid var(--color-foreground--25);
		}
	`;

	@property()
	content?: string;

	@property({ reflect: true })
	placement?: SlTooltip['placement'] = 'bottom';

	@property({ type: Boolean })
	disabled: boolean = false;

	@property({ type: Number })
	distance?: number;

	@property({ type: Boolean, attribute: 'hide-on-click' })
	hideOnClick?: boolean;

	@property({ type: Boolean })
	hoist?: boolean;

	private observer: MutationObserver | undefined;
	@state() private suppressed: boolean = false;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('dragstart', this.onDragStart, { capture: true });
		window.addEventListener('dragend', this.onDragEnd, { capture: true });
	}

	override firstUpdated(): void {
		this.observer = new MutationObserver(mutations => {
			for (const mutation of mutations) {
				if (mutation.type === 'attributes' && mutation.attributeName === 'data-current-placement') {
					const placement = (mutation.target as any).getAttribute('data-current-placement');
					if (placement) {
						this.setAttribute('data-current-placement', placement);
					} else {
						this.removeAttribute('data-current-placement');
					}
				}
			}
		});

		const target: any = this.shadowRoot?.querySelector('sl-tooltip')?.shadowRoot;
		// TODO: sometimes sl-tooltip might not be upgraded yet, need to look at watching for the upgrade
		if (!target) return;

		this.observer.observe(target, {
			attributes: true,
			attributeFilter: ['data-current-placement'],
			subtree: true,
		});
	}

	override disconnectedCallback(): void {
		this.observer?.disconnect();
		this.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('dragstart', this.onDragStart, { capture: true });
		window.removeEventListener('dragend', this.onDragEnd, { capture: true });
		super.disconnectedCallback?.();
	}

	private onMouseDown = (_e: MouseEvent) => {
		this.suppressed = true;
		void this.hide();
	};

	private onMouseUp = (_e: MouseEvent) => {
		this.suppressed = false;
	};

	private onDragStart = (_e: DragEvent) => {
		this.suppressed = true;
		void this.hide();
	};

	private onDragEnd = (_e: DragEvent) => {
		this.suppressed = false;
	};

	async hide(): Promise<void> {
		const slTooltip = this.shadowRoot?.querySelector<SlTooltip>('sl-tooltip');
		return slTooltip?.hide();
	}

	async show(): Promise<void> {
		const slTooltip = this.shadowRoot?.querySelector<SlTooltip>('sl-tooltip');
		return slTooltip?.show();
	}

	override render(): unknown {
		return html`<sl-tooltip
			.placement=${this.placement}
			?disabled=${this.disabled || this.suppressed}
			.distance=${this.distance ?? nothing}
			hoist
		>
			<slot></slot>
			<div slot="content">
				<slot name="content">${handleUnsafeOverlayContent(this.content)}</slot>
			</div>
		</sl-tooltip>`;
	}
}
