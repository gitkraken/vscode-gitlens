import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import '../../shared/components/button';
import '../../shared/components/code-icon';

declare global {
	interface HTMLElementTagNameMap {
		'gl-scrollable-features': GlScrollableFeatures;
	}
}

@customElement('gl-scrollable-features')
export class GlScrollableFeatures extends LitElement {
	static override styles = [
		css`
			:host {
				--side-shadowed-padding: 1em;

				position: relative;
				max-width: 100%;
			}

			:host::before,
			:host::after {
				content: ' ';
				position: absolute;
				top: 0;
				width: var(--side-shadowed-padding);
				height: 100%;
			}

			:host::before {
				left: 0;
				background: linear-gradient(to left, transparent 0%, var(--vscode-editor-background) 83%);
			}
			:host::after {
				right: 0;
				background: linear-gradient(to right, transparent 0%, var(--vscode-editor-background) 83%);
			}

			.content {
				box-sizing: border-box;
				padding: 0 var(--side-shadowed-padding);
				display: flex;
				gap: 1em;
				overflow-x: auto;
				overflow-y: hidden;
				scrollbar-width: none;
			}
		`,
	];

	override render(): unknown {
		return html`<div class="content"><slot></slot></div>`;
	}
}
