import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import '../../shared/components/button';
import '../../shared/components/code-icon';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-card': GlFeatureCard;
	}
}

@customElement('gl-feature-card')
export class GlFeatureCard extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				gap: 1em;
			}

			.image {
				flex: 1 1 50%;
				width: 50%;
			}

			.content {
				margin-top: 0.5em;
				flex: 1 0 50%;
				display: flex;
				flex-direction: column;
				gap: 0.5em;
			}

			@media (max-width: 640px) {
				:host {
					flex-direction: column;
				}

				.image {
					width: 100%;
				}

				.content {
					margin-top: 0;
					margin-left: 0.3em;
					margin-right: 0.3em;
				}

				::slotted(*) {
					width: 100%;
				}
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
