import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { focusOutline } from '../styles/lit/a11y.css';
import '../overlays/tooltip';
import '../code-icon';

@customElement('gl-action-chip')
export class ActionChip extends LitElement {
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
			min-width: 2rem;
			height: 2rem;
			border-radius: 0.5rem;
			color: inherit;
			padding: 0.2rem;
			vertical-align: text-bottom;
			text-decoration: none;
			cursor: pointer;
		}

		:host(:focus-within) {
			${focusOutline}
		}

		:host(:hover) {
			background-color: var(--vscode-toolbar-hoverBackground);
		}

		:host(:active) {
			background-color: var(--vscode-toolbar-activeBackground);
		}

		:host([disabled]) {
			pointer-events: none;
			opacity: 0.5;
		}

		a {
			display: inline-flex;
			justify-content: center;
			align-items: center;
			gap: 0.2rem;
			vertical-align: middle;
			color: inherit;
			text-decoration: none;
		}
		a:focus {
			outline: none;
		}

		::slotted(*) {
			padding-inline-end: 0.2rem;
			vertical-align: middle;
			text-transform: capitalize;
		}
	`;

	@property()
	href?: string;

	@property()
	label?: string;

	@property()
	icon = '';

	@property({ type: Boolean })
	disabled = false;

	@query('a')
	private defaultFocusEl!: HTMLAnchorElement;

	override render(): unknown {
		if (!this.label) {
			return this.renderContent();
		}

		return html`<gl-tooltip hoist content="${this.label}">${this.renderContent()}</gl-tooltip>`;
	}

	private renderContent() {
		return html`
			<a
				part="base"
				role="${!this.href ? 'button' : nothing}"
				type="${!this.href ? 'button' : nothing}"
				?disabled=${this.disabled}
				href=${this.href ?? nothing}
			>
				<code-icon part="icon" icon="${this.icon}"></code-icon><slot></slot>
			</a>
		`;
	}

	override focus(options?: FocusOptions): void {
		this.defaultFocusEl.focus(options);
	}
}
