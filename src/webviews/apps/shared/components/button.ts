import type { PropertyValueMap } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { focusOutlineButton } from './styles/lit/a11y.css';
import { elementBase } from './styles/lit/base.css';
import './overlays/tooltip';

declare global {
	interface HTMLElementTagNameMap {
		'gl-button': GlButton;
	}
}

@customElement('gl-button')
export class GlButton extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		css`
			:host {
				--button-foreground: var(--color-button-foreground);
				--button-background: var(--color-button-background);
				--button-hover-background: var(--vscode-button-hoverBackground);
				--button-padding: 0.4rem 1.1rem;
				--button-compact-padding: 0.6rem 0.8rem;
				--button-line-height: 1.694;
				--button-border: var(--vscode-button-border, transparent);

				display: inline-block;
				border: none;
				font-family: inherit;
				font-size: inherit;
				line-height: var(--button-line-height);
				text-align: center;
				text-decoration: none;
				user-select: none;
				background: var(--button-background);
				color: var(--button-foreground);
				cursor: pointer;
				border: 1px solid var(--button-border);
				border-radius: var(--gk-action-radius, 0.3rem);
			}

			.control {
				display: inline-block;
				padding: var(--button-padding);

				color: inherit;
				text-decoration: none;

				width: max-content;
				height: 100%;
				cursor: pointer;
			}

			button.control {
				appearance: none;
				background: transparent;
				border: none;
			}

			.control:focus {
				outline: none;
			}

			:host(:hover) {
				background: var(--button-hover-background);
			}

			:host(:focus-within) {
				${focusOutlineButton}
			}

			:host([full]),
			:host([full]) .control {
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
				--button-padding: 0.4rem;
				--button-line-height: 1.6;
				--button-border: transparent;
			}

			:host([appearance='alert']) {
				--button-background: transparent;
				--button-border: var(--color-alert-infoBorder);
				--button-foreground: var(--color-button-foreground);
				--button-hover-background: var(--color-alert-infoBorder);
				--button-line-height: 1.64;
				width: max-content;
			}

			:host-context(.vscode-light):host([appearance='alert']:not(:hover)),
			:host-context(.vscode-high-contrast-light):host([appearance='alert']:not(:hover)) {
				--button-foreground: var(--color-foreground);
			}

			:host([appearance='toolbar'][href]) > a {
				display: flex;
				align-items: center;
			}

			:host([appearance='alert'][href]) > a {
				display: block;
				width: max-content;
			}

			:host([density='compact']) .control {
				padding: var(--button-compact-padding);
			}

			:host([density='tight']) {
				line-height: 1;
			}

			:host([density='tight']) .control {
				padding: var(--button-compact-padding);
				line-height: 1;
			}

			:host([density='tight']) .control ::slotted(code-icon) {
				--code-icon-size: 11px;
				--code-icon-v-align: unset;
			}

			:host([disabled]) {
				opacity: 0.4;
				cursor: not-allowed;
				pointer-events: none;
			}
		`,
	];

	@query('.control')
	protected control!: HTMLElement;

	@property()
	appearance?: string;

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property({ reflect: true })
	density?: 'compact' | 'tight';

	@property({ type: Boolean, reflect: true })
	full = false;

	@property()
	href?: string;

	@property({ reflect: true })
	override get role() {
		return this.href ? 'link' : 'button';
	}

	@property()
	tooltip?: string;

	protected override updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		if (changedProperties.has('disabled')) {
			this.setAttribute('aria-disabled', this.disabled.toString());
		}
	}

	protected override render() {
		if (this.tooltip) {
			return html`<gl-tooltip .content=${this.tooltip}>${this.renderControl()}</gl-tooltip>`;
		}

		if (this.querySelectorAll('[slot="tooltip"]').length > 0) {
			return html`<gl-tooltip>
				${this.renderControl()}
				<slot name="tooltip" slot="content"></slot>
			</gl-tooltip>`;
		}

		return this.renderControl();
	}

	private renderControl() {
		if (this.href != null) {
			return html`<a
				class="control"
				tabindex="${this.disabled === false ? 0 : -1}"
				href=${this.href}
				@keypress=${(e: KeyboardEvent) => this.onLinkKeypress(e)}
				><slot></slot
			></a>`;
		}
		return html`<button class="control" ?disabled=${this.disabled}><slot></slot></button>`;
	}

	private onLinkKeypress(e: KeyboardEvent) {
		if (e.key === ' ') {
			this.control.click();
		}
	}

	override focus(options?: FocusOptions) {
		this.control.focus(options);
	}

	override blur() {
		this.control.blur();
	}

	override click() {
		this.control.click();
	}
}
