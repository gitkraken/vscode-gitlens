import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { getAltKeySymbol } from '@env/platform.js';
import { linkStyles, ruleStyles } from '../../../plus/shared/components/vscode.css.js';
import { ModifierKeysController } from '../../controllers/modifier-keys.js';
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
				max-width: 100%;
				min-width: 0;
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

			.chip__icon-active {
				display: none;
			}
			.chip:hover:has(.chip__icon-active) .chip__icon,
			.chip:focus-visible:has(.chip__icon-active) .chip__icon {
				display: none;
			}
			.chip:hover .chip__icon-active,
			.chip:focus-visible .chip__icon-active {
				display: inline-flex;
			}

			.chip {
				display: inline-flex;
				justify-content: center;
				align-items: center;
				gap: 0.2rem;
				/* vertical-align: middle; */
				color: inherit;
				max-width: 100%;
				min-width: 2rem;
				max-width: 100%;
				height: 2rem;
				color: inherit;
				padding: 0.2rem;
				text-decoration: none;
				cursor: pointer;
				background: none;
				border: none;
				font: inherit;
				overflow: hidden;
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
			/* Drop the trailing inline padding for suffix-slotted icons — the asymmetric box
			   shifts the rotation axis off the glyph's visual center, so a spinning loading
			   codicon wobbles. Flex gap already spaces this from the preceding label. */
			::slotted([slot='suffix']) {
				padding-inline-end: 0;
			}

			:host([truncate]) {
				min-width: 0;
				max-width: 100%;
			}
			:host([truncate]) ::slotted(*) {
				display: inline-block;
				max-width: 100%;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				vertical-align: middle;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	truncate = false;

	@property()
	href?: string;

	@property({ attribute: 'alt-href' })
	altHref?: string;

	@property()
	label?: string;

	@property({ attribute: 'alt-label' })
	altLabel?: string;

	@property()
	overlay: 'tooltip' | 'popover' | 'none' = 'tooltip';

	@property()
	icon = '';

	@property({ attribute: 'alt-icon' })
	altIcon?: string;

	@property()
	activeIcon?: string;

	@property({ type: Boolean })
	disabled = false;

	@query('.chip')
	private defaultFocusEl!: HTMLElement;

	private readonly _modifiers = new ModifierKeysController(this);

	private get isAltKeyPressed(): boolean {
		return this._modifiers.altKey || this._modifiers.shiftKey;
	}

	private get effectiveIcon(): string {
		return this.isAltKeyPressed && this.altIcon ? this.altIcon : this.icon;
	}

	private get effectiveHref(): string | undefined {
		return this.isAltKeyPressed && this.altHref ? this.altHref : this.href;
	}

	private get effectiveLabel(): string | undefined {
		return this.isAltKeyPressed && this.altLabel ? this.altLabel : this.label;
	}

	private get effectiveTooltip(): string | undefined {
		if (!this.label && !this.altLabel) return undefined;
		if (this.altLabel) {
			if (this.isAltKeyPressed) return this.altLabel;
			return `${this.label}\n[${getAltKeySymbol()}] ${this.altLabel}`;
		}
		return this.label;
	}

	override render(): unknown {
		if (!this.label || this.overlay === 'none') {
			return this.renderContent();
		}

		if (this.overlay === 'popover') {
			return html`<gl-popover hoist
				>${this.renderContent()}
				<div slot="content">${handleUnsafeOverlayContent(this.label)}</div></gl-popover
			>`;
		}

		return html`<gl-tooltip content="${this.effectiveTooltip}">${this.renderContent()}</gl-tooltip>`;
	}

	private renderContent() {
		const slot = this.overlay === 'popover' ? 'anchor' : nothing;
		const icon = this.effectiveIcon;
		const iconHtml = html`<code-icon
				class="chip__icon"
				part="icon"
				icon="${icon}"
				modifier="${ifDefined(icon === 'loading' ? 'spin' : '')}"
			></code-icon
			>${this.activeIcon
				? html`<code-icon class="chip__icon-active" part="active-icon" icon="${this.activeIcon}"></code-icon>`
				: nothing}`;

		const href = this.effectiveHref;
		const ariaLabel = this.effectiveLabel;
		if (href) {
			return html`
				<a
					class="chip"
					part="base"
					?disabled=${this.disabled}
					href=${href}
					slot=${slot}
					aria-label=${ifDefined(ariaLabel)}
				>
					${iconHtml}<slot></slot><slot name="suffix"></slot>
				</a>
			`;
		}

		return html`
			<button
				class="chip"
				part="base"
				type="button"
				?disabled=${this.disabled}
				slot=${slot}
				aria-label=${ifDefined(ariaLabel)}
			>
				${iconHtml}<slot></slot><slot name="suffix"></slot>
			</button>
		`;
	}

	override focus(options?: FocusOptions): void {
		this.defaultFocusEl.focus(options);
	}
}
