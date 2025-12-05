import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import '../../shared/components/button';
import '../../shared/components/code-icon';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-narrow-card': GlFeatureNarrowCard;
	}
}

@customElement('gl-feature-narrow-card')
export class GlFeatureNarrowCard extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: 0.7em;
				width: 12em;
				min-width: 12em;
				text-align: initial;
			}

			.image ::slotted(img) {
				max-height: 2.23em;
				border-radius: 0.6em;
			}

			::slotted(p:last-child) {
				margin-top: 0.5em;
			}

			.content {
				display: block;
			}

			@media (max-width: 400px) {
				.content {
					margin-left: 0.3em;
					margin-right: 0.3em;
				}
			}

			@media (max-width: 300px) {
			}
		`,
	];

	override render(): unknown {
		return html`
			<div class="image">
				<slot name="image"></slot>
			</div>
			<div class="content">
				<slot></slot>
			</div>
		`;
	}
}
