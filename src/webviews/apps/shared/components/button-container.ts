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
				--button-group-wide-gap: 1rem;
				display: block;
				max-width: 30rem;
				margin-right: auto;
				margin-left: auto;
				text-align: left;
				transition: max-width 0.2s ease-out;
			}

			@media (min-width: 640px) {
				:host(:not([editor])) {
					max-width: 100%;
				}
			}

			.group {
				display: inline-flex;
				gap: var(--button-group-gap);
				width: 100%;
				max-width: 30rem;
			}

			:host([gap='wide']) .group {
				gap: var(--button-group-wide-gap);
			}
		`,
	];

	@property({ type: Boolean })
	editor = false;

	@property({ reflect: true })
	gap?: 'wide';

	override render() {
		return html`<div class="group"><slot></slot></div>`;
	}
}
