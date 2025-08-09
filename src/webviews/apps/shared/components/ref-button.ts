import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitReference } from '../../../../git/models/reference';
import { pickerIconStyles, refButtonBaseStyles } from './ref.css';
import './button';
import './ref-name';

@customElement('gl-ref-button')
export class GlRefButton extends LitElement {
	static override styles = [
		refButtonBaseStyles,
		css`
			:host {
				--font-weight: normal;
			}

			gl-button {
				max-width: 100%;
			}

			gl-ref-name:not([icon]) {
				padding-left: 0.2rem;
			}
		`,
		pickerIconStyles,
	];

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property({ type: String, reflect: true })
	href?: string;

	@property({ type: Boolean, reflect: true })
	icon = false;

	@property({ type: Object })
	ref?: GitReference;

	@property({ type: Number })
	size: number = 16;

	@property({ type: Boolean })
	worktree = false;

	override render(): unknown {
		return html`<gl-button appearance="toolbar" href=${ifDefined(this.href)} ?disabled=${this.disabled}
			>${this.ref == null
				? html`<slot name="empty">&lt;missing&gt;</slot>`
				: html`<gl-ref-name
						part="label"
						?icon=${this.icon}
						.ref=${this.ref}
						.size=${this.size}
						?worktree=${this.worktree}
					></gl-ref-name>`}<code-icon
				slot="suffix"
				class="picker-icon"
				icon="chevron-down"
				size="10"
			></code-icon
			><slot name="tooltip" slot="tooltip"></slot
		></gl-button>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-ref-button': GlRefButton;
	}
}
