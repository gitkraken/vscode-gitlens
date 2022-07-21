import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

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
			overflow: hidden;
			border-radius: 0.25em;
			width: 100%;
			height: calc(1em * var(--skeleton-line-height, 1.2) * var(--skeleton-lines, 1));
			background-color: var(--color-background--lighten-15);
		}

		.skeleton::before {
			content: '';
			position: absolute;
			display: block;
			top: 0;
			right: 0;
			bottom: 0;
			left: 0;
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

	override render() {
		const style = `--skeleton-lines: ${this.lines};`;
		return html`<div class="skeleton" style=${style}></div>`;
	}
}
