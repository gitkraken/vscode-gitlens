import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

const accordionTagName = 'gl-accordion';

@customElement(accordionTagName)
export class GlAccordion extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		:host {
			display: block;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			font-weight: var(--vscode-font-weight);
			background-color: var(--gl-accordion-content-background, var(--vscode-editor-background));
			color: var(--vscode-foreground);
		}

		/*
		details {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			overflow: hidden;
		}
		*/

		.header {
			padding: 8px 12px;
			background-color: var(--gl-accordion-header-background, var(--vscode-sideBar-background));
			cursor: pointer;
			user-select: none;
			list-style: none;
			outline: none;
			display: flex;
			align-items: center;
			gap: 0.6rem;
		}

		.header::-webkit-details-marker {
			display: none;
		}

		.label {
			flex: 1;
			display: block;
		}

		.icon {
			flex: none;
			width: 20px;
			color: var(--vscode-foreground);
			opacity: 0.6;
		}

		.header:hover {
			background-color: var(--vscode-list-hoverBackground);
		}

		.header:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		.content {
			padding: 12px;
			background-color: var(--gl-accordion-content-background, var(--vscode-editor-background));
		}
	`;

	@property({ type: Boolean }) open = false;

	get headerId() {
		return `gl-accordion-header-${this.id ?? Math.random().toString(36).substring(2, 9)}`;
	}

	override render() {
		return html`
			<details ?open=${this.open} @toggle=${this._handleToggle} role="region" aria-labelledby=${this.headerId}>
				<summary part="header" class="header" id=${this.headerId} role="button" aria-expanded=${this.open}>
					<slot class="label" name="header"></slot>
					<code-icon class="icon" icon=${this.open ? 'chevron-down' : 'chevron-right'}></code-icon>
				</summary>
				<div part="content" class="content">
					<slot></slot>
				</div>
			</details>
		`;
	}

	private _handleToggle(e: Event) {
		const details = e.target as HTMLDetailsElement;
		this.open = details.open;
		this.dispatchEvent(
			new CustomEvent('gl-toggle', {
				detail: { open: this.open },
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[accordionTagName]: GlAccordion;
	}
}
