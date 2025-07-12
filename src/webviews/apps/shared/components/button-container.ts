import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { elementBase } from './styles/lit/base.css';

@customElement('button-container')
export class ButtonContainer extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				--button-group-gap: 0.4rem;
				--button-max-width: 30rem;
				--button-group-max-width: 30rem;
				display: block;
				max-width: var(--button-max-width, 30rem);
				margin-inline: auto;
				text-align: left;
				transition: max-width 0.2s ease-out;
			}

			:host([grouping='gap-wide']) {
				--button-group-gap: 1rem;
			}

			:host([grouping='split']) {
				--button-group-gap: 0.1rem;
			}

			@media (min-width: 640px) {
				:host([layout='shift']) {
					--button-max-width: 100%;
				}
			}

			:host([layout='full']) {
				--button-max-width: 100%;
				--button-group-max-width: 100%;
			}

			.group {
				display: inline-flex;
				gap: var(--button-group-gap, 0.4rem);
				width: 100%;
				max-width: var(--button-group-max-width, 30rem);
			}

			:host([grouping='split']) ::slotted(*:not(:first-child)) {
				border-top-left-radius: 0;
				border-bottom-left-radius: 0;
			}
			:host([grouping='split']) ::slotted(*:not(:last-child)) {
				border-top-right-radius: 0;
				border-bottom-right-radius: 0;
			}
		`,
	];

	@property({ type: Boolean })
	editor = false;

	@property({ reflect: true })
	layout: 'shift' | 'editor' | 'full' = 'shift';

	@property({ reflect: true })
	grouping: 'gap' | 'split' | 'gap-wide' = 'gap';

	override render(): unknown {
		return html`<div class="group"><slot></slot></div>`;
	}
}
