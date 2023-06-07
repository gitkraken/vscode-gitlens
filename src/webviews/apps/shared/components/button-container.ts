import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { elementBase } from './styles/lit/base.css';

@customElement('button-container')
export class ButtonContainer extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
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
				gap: 0.4rem;
				width: 100%;
				max-width: 30rem;
			}
		`,
	];

	@property({ type: Boolean })
	editor = false;

	override render() {
		return html`<div class="group"><slot></slot></div>`;
	}
}
