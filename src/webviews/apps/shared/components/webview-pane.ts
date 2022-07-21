import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './codicon';

@customElement('webview-pane')
export class WebviewPane extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			background-color: var(--color-view-background);
			color: var(--color-view-foreground);
		}

		* {
			box-sizing: border-box;
		}

		.header {
			flex: none;
			display: flex;
			background-color: var(--color-view-background);
			color: var(--color-view-header-foreground);
			border-top: 1px solid var(--vscode-panel-border);
		}

		.header:focus-within {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		.title {
			appearance: none;
			width: 100%;
			padding: 0;
			border: none;
			text-align: left;
			line-height: 2.2rem;
			font-weight: bold;
			background: transparent;
			color: inherit;
			cursor: pointer;
			outline: none;
		}

		.icon {
			font-weight: normal;
			margin: 0 0.2rem;
		}

		.content {
			overflow: auto;
			/* scrollbar-gutter: stable; */
			box-shadow: #000000 0 0.6rem 0.6rem -0.6rem inset;
			padding-top: 0.6rem;
		}

		:host([collapsable]:not([expanded])) .content {
			display: none;
		}
	`;

	@property({ type: Boolean, reflect: true })
	collapsable = false;

	@property({ type: Boolean, reflect: true })
	expanded = false;

	renderTitle() {
		if (!this.collapsable) {
			return html`<div class="title">${this.title}</div>`;
		}
		return html`<button
			type="button"
			class="title"
			aria-controls="content"
			aria-expanded=${this.expanded}
			@click="${this.toggleExpanded}"
		>
			<code-icon class="icon" icon=${this.expanded ? 'chevron-down' : 'chevron-right'}></code-icon
			><slot name="title">Section</slot>
		</button>`;
	}

	override render() {
		return html`
			<header class="header">${this.renderTitle()}</header>
			<div id="content" role="region" class="content">
				<slot></slot>
			</div>
		`;
	}

	private toggleExpanded() {
		this.expanded = !this.expanded;
	}
}
