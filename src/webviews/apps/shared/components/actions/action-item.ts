import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../overlays/tooltip';
import '../code-icon';

@customElement('action-item')
export class ActionItem extends LitElement {
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

		:host(:focus) {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
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
			color: inherit;
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

	override render() {
		return html`
			<gl-tooltip hoist content="${this.label ?? nothing}">
				<a
					role="${!this.href ? 'button' : nothing}"
					type="${!this.href ? 'button' : nothing}"
					aria-label="${this.label ?? nothing}"
					?disabled=${this.disabled}
					href=${this.href ?? nothing}
				>
					<code-icon icon="${this.icon}"></code-icon>
				</a>
			</gl-tooltip>
		`;
	}
}
