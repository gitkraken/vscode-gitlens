import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { linkStyles, ruleStyles } from '../../../plus/shared/components/vscode.css.js';
import { handleUnsafeOverlayContent } from '../overlays/overlays.utils.js';
import { focusOutline } from '../styles/lit/a11y.css.js';
import '../overlays/popover.js';
import '../overlays/tooltip.js';
import '../code-icon.js';

@customElement('gl-action-chip')
export class ActionChip extends LitElement {
	static override styles = [
		linkStyles,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
				justify-content: center;
				align-items: center;
				vertical-align: text-bottom;
				border-radius: 0.5rem;
			}

			* {
				box-sizing: border-box;
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

			.chip {
				display: inline-flex;
				justify-content: center;
				align-items: center;
				gap: 0.2rem;
				/* vertical-align: middle; */
				color: inherit;
				min-width: 2rem;
				height: 2rem;
				color: inherit;
				padding: 0.2rem;
				text-decoration: none;
				cursor: pointer;
				background: none;
				border: none;
				font: inherit;
			}
			.chip:hover {
				text-decoration: none;
			}
			.chip:focus {
				outline: none;
			}

			a:not(.chip) {
				text-decoration: underline;
			}

			::slotted(*) {
				padding-inline-end: 0.2rem;
				vertical-align: middle;
				text-transform: var(--chip-text-transform, capitalize);
			}
		`,
	];

	@property()
	href?: string;

	@property()
	label?: string;

	@property()
	overlay: 'tooltip' | 'popover' = 'tooltip';

	@property()
	icon = '';

	@property({ type: Boolean })
	disabled = false;

	@query('.chip')
	private defaultFocusEl!: HTMLElement;

	override render(): unknown {
		if (!this.label) {
			return this.renderContent();
		}

		if (this.overlay === 'popover') {
			return html`<gl-popover hoist
				>${this.renderContent()}
				<div slot="content">${handleUnsafeOverlayContent(this.label)}</div></gl-popover
			>`;
		}

		return html`<gl-tooltip hoist content="${this.label}">${this.renderContent()}</gl-tooltip>`;
	}

	private renderContent() {
		const slot = this.overlay === 'popover' ? 'anchor' : nothing;
		const iconHtml = html`<code-icon
			part="icon"
			icon="${this.icon}"
			modifier="${ifDefined(this.icon === 'loading' ? 'spin' : '')}"
		></code-icon>`;

		if (this.href) {
			return html`
				<a class="chip" part="base" ?disabled=${this.disabled} href=${this.href} slot=${slot}>
					${iconHtml}<slot></slot>
				</a>
			`;
		}

		return html`
			<button class="chip" part="base" type="button" ?disabled=${this.disabled} slot=${slot}>
				${iconHtml}<slot></slot>
			</button>
		`;
	}

	override focus(options?: FocusOptions): void {
		this.defaultFocusEl.focus(options);
	}
}
