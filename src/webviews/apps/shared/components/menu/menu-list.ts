import type { PropertyValueMap } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { elementBase } from '../styles/lit/base.css';

@customElement('menu-list')
export class MenuList extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				width: max-content;
				background-color: var(--vscode-menu-background);
				border: 1px solid var(--vscode-menu-border);
				padding-bottom: 0.6rem;
			}
		`,
	];

	protected override firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		this.role = 'listbox';
	}

	override render() {
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'menu-list': MenuList;
	}
}
