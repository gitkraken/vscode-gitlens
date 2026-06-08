import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { cspStyleMap } from './csp-style-map.directive.js';

// height: calc(1em * var(--skeleton-line-height, 1.2) * var(--skeleton-lines, 1));
// background-color: var(--color-background--lighten-30);
@customElement('skeleton-loader')
export class SkeletonLoader extends LitElement {
	static override styles = css`
		:host {
			--skeleton-line-height: 1.2;
			--skeleton-lines: 1;
		}

		.skeleton {
			position: relative;
			display: block;
			width: 100%;
			height: calc(1em * var(--skeleton-line-height, 1.2) * var(--skeleton-lines, 1));
			overflow: hidden;
			background-color: var(--color-background--lighten-15);
			border-radius: 0.25em;
		}

		.skeleton::before {
			position: absolute;
			inset: 0;
			display: block;
			content: '';
			background-image: linear-gradient(
				to right,
				transparent 0%,
				var(--color-background--lighten-15) 20%,
				var(--color-background--lighten-30) 60%,
				transparent 100%
			);
			transform: translateX(-100%);
			animation: skeleton-loader 2s ease-in-out infinite;
		}

		@keyframes skeleton-loader {
			100% {
				transform: translateX(100%);
			}
		}
	`;

	@property({ type: Number })
	lines = 1;

	override render(): unknown {
		return html`<div class="skeleton" style=${cspStyleMap({ '--skeleton-lines': String(this.lines) })}></div>`;
	}
}
