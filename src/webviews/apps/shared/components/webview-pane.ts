import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { scrollableBase } from './styles/lit/base.css.js';
import './code-icon.js';
import './progress.js';

export interface WebviewPaneExpandedChangeEventDetail {
	expanded: boolean;
}

@customElement('webview-pane')
export class WebviewPane extends LitElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: flex;
				flex-direction: column;

				/* background-color: var(--vscode-sideBar-background); */
				min-height: 23px;
			}

			* {
				box-sizing: border-box;
			}

			.header {
				position: relative;
				display: flex;
				flex: none;
				color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
				background-color: var(--vscode-sideBarSectionHeader-background);
				border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
			}

			:host([collapsable]) .header:focus-within {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.label {
				display: flex;
				flex-direction: row;
				align-items: center;
				width: 100%;
				height: 2.2rem;
				padding: 0;
				text-overflow: ellipsis;
				font-family: var(--font-family);
				font-size: 1.1rem;
				line-height: 2.2rem;
				color: inherit;
				text-align: left;
				appearance: none;
				user-select: none;
				outline: none;
				background: transparent;
				border: none;
			}

			:host([collapsable]) .label {
				cursor: pointer;
			}

			.title {
				flex: 1;
				width: 0;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: bold;
				text-transform: uppercase;
				white-space: nowrap;
			}

			:host(:not([collapsable])) .title {
				margin-left: var(--gl-space-8);
			}

			.subtitle {
				margin-left: var(--gl-space-10);
			}

			.subtitle::slotted(*) {
				opacity: 0.6;
			}

			.icon {
				margin: 0 var(--gl-space-2);
				font-weight: normal;
			}

			.content {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;

				/*
	scrollbar-gutter: stable;
	box-shadow: #000000 0 0.6rem 0.6rem -0.6rem inset;
	*/
				padding-top: var(--gl-space-6);
				overflow: auto;
			}

			:host([collapsable]:not([expanded])) .content,
			:host([collapsable][expanded='false']) .content {
				display: none;
			}

			slot[name='actions']::slotted(*) {
				flex: none;
				margin-left: auto;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	collapsable = false;

	@property({ type: Boolean, reflect: true })
	expanded = false;

	@property({ type: Boolean, reflect: true })
	loading = false;

	private renderTitle() {
		if (!this.collapsable) {
			return html`<div class="label">
				<span class="title"><slot name="title">Section</slot></span>
				<span class="subtitle"><slot name="subtitle"></slot></span>
			</div>`;
		}
		return html`<button
			type="button"
			class="label"
			aria-controls="content"
			aria-expanded=${this.expanded}
			@click="${this.toggleExpanded}"
		>
			<code-icon class="icon" icon=${this.expanded ? 'chevron-down' : 'chevron-right'}></code-icon
			><span class="title"><slot name="title">Section</slot></span>
			<span class="subtitle"><slot name="subtitle"></slot></span>
		</button>`;
	}

	override render(): unknown {
		return html`
			<header class="header" part="header">
				${this.renderTitle()}
				<slot name="actions"></slot>
				<progress-indicator ?active="${this.loading}"></progress-indicator>
			</header>
			<div id="content" role="region" part="content" class="content scrollable">
				<slot></slot>
			</div>
		`;
	}

	private toggleExpanded() {
		this.expanded = !this.expanded;

		this.dispatchEvent(
			new CustomEvent<WebviewPaneExpandedChangeEventDetail>('expanded-change', {
				detail: {
					expanded: this.expanded,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'webview-pane': WebviewPane;
	}
}
