import type { PropertyValueMap } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { elementBase } from '../styles/lit/base.css';

@customElement('menu-item')
export class MenuItem extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
				font-family: inherit;
				border: none;
				padding: 0 0.6rem;
				cursor: pointer;
				color: var(--vscode-menu-foreground);
				background-color: var(--vscode-menu-background);
				text-align: left;
				height: auto;
				line-height: 2.2rem;
			}

			:host([role='option']:hover) {
				color: var(--vscode-menu-selectionForeground);
				background-color: var(--vscode-menu-selectionBackground);
			}

			:host([disabled]) {
				pointer-events: none;
				cursor: default;
				opacity: 0.5;
			}

			:host([aria-selected='true']) {
				opacity: 1;
				color: var(--vscode-menu-selectionForeground);
				background-color: var(--vscode-menu-background);
			}

			:host([href]) {
				padding-inline: 0;
			}

			a {
				display: block;
				color: inherit;
				text-decoration: none;
				padding: 0 0.6rem;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property({ reflect: true })
	href?: string;

	@property({ reflect: true })
	override role = 'option';

	updateInteractiveState() {
		this.tabIndex = this.disabled ? -1 : this.role === 'option' ? 0 : -1;
	}

	protected override updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		if (changedProperties.has('disabled') || changedProperties.has('role')) {
			this.updateInteractiveState();
		}
	}

	override render() {
		if (this.href) {
			return html`<a href=${this.href}><slot></slot></a>`;
		}
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'menu-item': MenuItem;
	}
}
