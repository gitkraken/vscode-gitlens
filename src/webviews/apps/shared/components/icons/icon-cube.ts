import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../code-icon.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-icon-cube': GlIconCube;
	}
}

@customElement('gl-icon-cube')
export class GlIconCube extends LitElement {
	static override styles = [
		css`
			:host {
				--gl-icon-cube-color: var(--color-foreground);
				--gl-icon-cube-background: color-mix(in srgb, var(--gl-icon-cube-color) 10%, transparent);
				--gl-icon-cube-size: 1.6rem;

				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: calc(var(--gl-icon-cube-size) * 1.6);
				aspect-ratio: 1;
				background: var(--gl-icon-cube-background);
				border-radius: 0.6rem;
			}

			:host([appearance='brand']) {
				--gl-icon-cube-color: #fff;
				--gl-icon-cube-background: var(--gl-gradient-brand);
			}

			code-icon {
				font-size: var(--gl-icon-cube-size);
				color: var(--gl-icon-cube-color);
			}
		`,
	];

	@property({ type: String, reflect: true })
	appearance?: 'brand';

	@property()
	icon: string = '';

	override render() {
		return html`<code-icon icon=${this.icon}></code-icon>`;
	}
}
