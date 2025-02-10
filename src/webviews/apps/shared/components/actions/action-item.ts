import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { focusOutline } from '../styles/lit/a11y.css';
import '../overlays/tooltip';
import '../code-icon';

@customElement('action-item')
export class ActionItem extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		:host {
			box-sizing: border-box;
			display: inline-flex;
			justify-content: center;
			align-items: center;
			width: 2rem;
			height: 2rem;
			border-radius: 0.5rem;
			color: inherit;
			padding: 0.2rem;
			vertical-align: text-bottom;
			text-decoration: none;
			cursor: pointer;
		}

		:host(:hover) {
			background-color: var(--vscode-toolbar-hoverBackground);
		}
		:host(:active),
		:host([selected]) {
			background-color: var(--vscode-toolbar-activeBackground);
		}

		:host(:focus-within) {
			${focusOutline}
		}

		:host([disabled]) {
			pointer-events: none;
			opacity: 0.5;
		}

		a {
			color: inherit;
		}
		a:focus {
			outline: none;
		}
	`;

	@property()
	href?: string;

	@property()
	label?: string;

	@property()
	icon = '';

	@property({ type: Boolean })
	selected = false;

	@property({ type: Boolean })
	disabled = false;

	@query('a')
	private defaultFocusEl!: HTMLAnchorElement;

	private renderButtonContent(): TemplateResult {
		return html`<a
			role="${!this.href ? 'button' : nothing}"
			type="${!this.href ? 'button' : nothing}"
			aria-label="${this.label ?? nothing}"
			?disabled=${this.disabled}
			href=${this.href ?? nothing}
		>
			<code-icon icon="${this.icon}"></code-icon>
		</a>`;
	}

	override render() {
		if (this.selected) {
			return this.renderButtonContent();
		}
		return html` <gl-tooltip hoist content="${this.label ?? nothing}">${this.renderButtonContent()}</gl-tooltip> `;
	}

	override focus(options?: FocusOptions): void {
		this.defaultFocusEl.focus(options);
	}
}
