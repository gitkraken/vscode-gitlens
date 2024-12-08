import type SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import { setDefaultAnimation } from '@shoelace-style/shoelace/dist/utilities/animation-registry.js';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

setDefaultAnimation('tooltip.show', null);
setDefaultAnimation('tooltip.hide', null);

@customElement('gl-tooltip')
export class GlTooltip extends LitElement {
	static override styles = css`
		sl-tooltip {
			--max-width: 320px;
			--hide-delay: 0ms;
			--show-delay: 500ms;
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
	`;

	@property()
	content?: string;

	@property({ reflect: true })
	placement?: SlTooltip['placement'] = 'bottom';

	@property({ type: Boolean })
	disabled: boolean = false;

	@property({ type: Number })
	distance?: number;

	@property({ type: Boolean })
	hoist?: boolean;

	private observer: MutationObserver | undefined;
	override firstUpdated() {
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

	override disconnectedCallback() {
		this.observer?.disconnect();
	}

	override render() {
		return html`<sl-tooltip
			.placement=${this.placement}
			?disabled=${this.disabled}
			.distance=${this.distance ?? nothing}
			hoist
		>
			<slot></slot>
			<div slot="content">
				<slot name="content">${this.content}</slot>
			</div>
		</sl-tooltip>`;
	}
}
