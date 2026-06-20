import type { PropertyValueMap } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { elementBase } from '../styles/lit/base.css.js';

@customElement('menu-item')
export class MenuItem extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
				height: auto;
				padding: 0 0.6rem;
				font-family: inherit;
				line-height: 2.2rem;
				color: var(--vscode-menu-foreground);
				text-align: left;
				cursor: pointer;
				background-color: var(--vscode-menu-background);
				border: none;
				border-radius: var(--menu-item-radius, var(--gl-radius-sm));
				-webkit-font-smoothing: auto;
			}

			:host([role='option']:hover:not([aria-selected='true'])),
			:host([role='option']:focus-visible:not([aria-selected='true'])) {
				color: var(--vscode-menu-selectionForeground);
				outline: none;
				background-color: color-mix(
					in oklch,
					var(--vscode-menu-selectionBackground) 50%,
					var(--vscode-menu-background)
				);
			}

			:host([disabled]) {
				pointer-events: none;
				cursor: default;
				opacity: 0.5;
			}

			:host([aria-selected='true']) {
				color: var(--vscode-menu-selectionForeground);
				background-color: var(--vscode-menu-selectionBackground);
				opacity: 1;
			}

			:host([href]) {
				padding-inline: 0;
			}

			a {
				display: block;
				padding: 0 0.6rem;
				color: inherit;
				text-decoration: none;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property({ reflect: true })
	href?: string;

	@property({ reflect: true })
	// eslint-disable-next-line lit/no-native-attributes
	override role = 'option';

	updateInteractiveState(): void {
		this.tabIndex = this.disabled ? -1 : this.role === 'option' ? 0 : -1;
	}

	protected override updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		if (changedProperties.has('disabled') || changedProperties.has('role')) {
			this.updateInteractiveState();
		}
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('keydown', this.onKeydown);
	}

	override disconnectedCallback(): void {
		this.removeEventListener('keydown', this.onKeydown);
		super.disconnectedCallback?.();
	}

	private readonly onKeydown = (e: KeyboardEvent): void => {
		if (this.disabled) return;
		if (e.target !== this) return;
		if (e.key !== 'Enter' && e.key !== ' ') return;

		e.preventDefault();
		this.click();
	};

	override render(): unknown {
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
