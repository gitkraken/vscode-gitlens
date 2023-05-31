import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { focusOutline } from './styles/lit/a11y.css';
import { elementBase } from './styles/lit/base.css';

@customElement('gk-button')
export class GKButton extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				--button-foreground: var(--vscode-button-foreground);
				--button-background: var(--vscode-button-background);
				--button-hover-background: var(--vscode-button-hoverBackground);
				--button-padding: 0.4rem 1.1rem;
				--button-border: var(--vscode-button-border, transparent);

				display: inline-block;
				border: none;
				font-family: inherit;
				font-size: inherit;
				line-height: 1.694;
				text-align: center;
				text-decoration: none;
				user-select: none;
				background: var(--button-background);
				color: var(--button-foreground);
				cursor: pointer;
				border: 1px solid var(--button-border);
				border-radius: var(--gk-action-radius);
			}

			:host(:not([href])) {
				padding: var(--button-padding);
			}

			:host([href]) > a {
				display: inline-block;
				padding: var(--button-padding);

				color: inherit;
				text-decoration: none;

				width: 100%;
				height: 100%;
			}

			:host(:hover) {
				background: var(--button-hover-background);
			}

			:host(:focus) {
				${focusOutline}
			}

			:host([full]) {
				width: 100%;
			}

			:host([appearance='secondary']) {
				--button-background: var(--vscode-button-secondaryBackground);
				--button-foreground: var(--vscode-button-secondaryForeground);
				--button-hover-background: var(--vscode-button-secondaryHoverBackground);
			}

			:host([appearance='toolbar']) {
				--button-background: transparent;
				--button-foreground: var(--vscode-foreground);
				--button-hover-background: var(--vscode-toolbar-hoverBackground);
				--button-padding: 0.45rem 0.4rem 0.14rem 0.4rem;
				line-height: 1.64;
			}

			:host([appearance='alert']) {
				--button-background: transparent;
				--button-border: var(--color-alert-infoBorder);
				--button-foreground: var(--color-button-foreground);
				--button-hover-background: var(--color-alert-infoBorder);
				--button-padding: 0.4rem;
				line-height: 1.64;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	full = false;

	@property()
	href?: string;

	@property({ reflect: true })
	override get role() {
		return this.href ? 'link' : 'button';
	}

	@property()
	appearance?: string;

	@property({ type: Number, reflect: true })
	override tabIndex = 0;

	override render() {
		const main = html`<slot></slot>`;
		return this.href != null ? html`<a href=${this.href}>${main}</a>` : main;
	}
}
