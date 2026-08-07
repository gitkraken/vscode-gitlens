import type { PropertyValueMap } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GlTooltip } from './overlays/tooltip.js';
import { focusOutlineButton } from './styles/lit/a11y.css.js';
import { elementBase } from './styles/lit/base.css.js';
import './overlays/tooltip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-button': GlButton;
	}
}

/**
 * A button that renders as a `<button>`, or as an `<a>` when `href` is set.
 *
 * @tag gl-button
 *
 * @slot - The button label.
 * @slot prefix - Content before the label, typically a `code-icon`.
 * @slot suffix - Content after the label, typically a `code-icon`.
 * @slot tooltip - Rich tooltip content. Use instead of the `tooltip` property when the tooltip needs markup.
 *
 * @cssproperty --button-foreground - Text color. Default `var(--vscode-button-foreground)`.
 * @cssproperty --button-background - Background color. Default `var(--vscode-button-background)`.
 * @cssproperty --button-hover-background - Background color on hover. Default `var(--vscode-button-hoverBackground)`.
 * @cssproperty --button-border - Border color. Default `var(--vscode-button-border, transparent)`.
 * @cssproperty --button-width - Host and control width. Default `max-content`. Ignored when `full` is set.
 * @cssproperty --button-padding - Control padding. Default `0.4rem`.
 * @cssproperty --button-padding-inline - Horizontal padding for the default and `secondary` appearances only. Default `0.8rem`.
 * @cssproperty --button-gap - Gap between the prefix, label, and suffix slots. Default `0.6rem`.
 * @cssproperty --button-line-height - Line height of the host and control. Default `1.35`.
 * @cssproperty --button-compact-padding - Control padding when `density="compact"`. Default `0.4rem`.
 * @cssproperty --button-tight-padding - Control padding when `density="tight"`. Default `0.4rem 0.8rem`.
 * @cssproperty --button-input-padding - Control padding when `appearance="input"`. Default `0.1rem`.
 * @cssproperty --button-input-height - Control height when `appearance="input"`. Default `1.8rem`.
 */
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
				/* Base color variables - can be overridden by variant */
				--button-foreground: var(--vscode-button-foreground);
				--button-background: var(--vscode-button-background);
				--button-hover-background: var(--vscode-button-hoverBackground);
				--button-border: var(--vscode-button-border, transparent);

				/* Layout variables */
				--button-width: max-content;
				--button-padding: 0.4rem;
				--button-gap: 0.6rem;
				--button-compact-padding: 0.4rem;
				--button-input-padding: 0.1rem;
				--button-tight-padding: 0.4rem 0.8rem;
				--button-line-height: 1.35;

				display: inline-block;
				width: var(--button-width);
				font-family: inherit;
				font-size: inherit;
				line-height: var(--button-line-height);
				color: var(--button-foreground);
				text-align: center;
				text-decoration: none;
				cursor: pointer;
				user-select: none;
				background: var(--button-background);
				border: none;
				border: var(--gl-border-width) solid var(--button-border);
				border-radius: var(--gl-radius-sm);
				-webkit-font-smoothing: auto;
			}

			.control {
				box-sizing: border-box;
				display: inline-flex;
				flex-direction: row;
				gap: var(--button-gap);
				align-items: center;
				justify-content: center;
				width: var(--button-width);
				max-width: 100%;
				height: 100%;
				padding: var(--button-padding);
				font-family: inherit;
				font-size: inherit;
				line-height: var(--button-line-height);
				color: inherit;
				text-decoration: none;
				cursor: pointer;
			}

			/* When truncate is enabled, allow the control to shrink */
			:host([truncate]) .control {
				min-width: 0;
			}

			button.control {
				appearance: none;
				background: transparent;
				border: none;
			}

			.control:focus {
				outline: none;
			}

			.label {
				display: inline-flex;
				align-items: center;
				max-width: 100%;
			}

			/* Text truncation option - enabled via truncate attribute */
			:host([truncate]) .label {
				display: block; /* Change from flex to block for ellipsis to work */
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			:host(:hover) {
				background: var(--button-hover-background);
			}

			:host(:focus-within) {
				${focusOutlineButton}
			}

			:host([appearance='input']),
			:host([role='checkbox']:focus-within),
			:host([aria-checked]:focus-within) {
				outline-offset: -1px;
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

			:host([appearance='input']),
			:host([appearance='toolbar']) {
				--button-background: transparent;
				--button-foreground: var(--vscode-foreground);
				--button-hover-background: var(--vscode-toolbar-hoverBackground);
				--button-border: transparent;
			}

			:host([appearance='alert']) {
				--button-background: transparent;
				--button-border: var(--color-alert-infoBorder);
				--button-foreground: var(--color-alert-infoForeground);
				--button-hover-background: var(--color-alert-infoBorder);
				--button-line-height: 1.64;

				width: max-content;
			}

			:host([appearance='alert']:hover) {
				--button-foreground: var(--vscode-button-foreground);
			}

			/* Text-link appearance — renders like an inline hyperlink rather than a button */
			:host([appearance='link']) {
				--button-background: transparent;
				--button-foreground: var(--vscode-textLink-foreground);
				--button-hover-background: transparent;
				--button-border: transparent;
				--button-padding: 0;

				width: max-content;
				border-radius: 0;
			}

			:host([appearance='link']:hover) {
				--button-foreground: var(--vscode-textLink-activeForeground);
			}

			/* Underline only the text label on hover — leave prefix/suffix icon slots undecorated */
			:host([appearance='link']:hover) .label {
				text-decoration: underline;
			}

			/* Variant property for semantic states - appearance controls structure, variant controls color */

			/* Solid buttons (default and secondary) with variants get full color treatment */
			:host([variant='danger']) {
				--button-foreground: var(--vscode-inputValidation-errorForeground, #f48771);
				--button-background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
				--button-hover-background: color-mix(
					in srgb,
					#000 30%,
					var(--vscode-inputValidation-errorBorder, #be1100)
				);
				--button-border: var(--vscode-inputValidation-errorBorder, #be1100);
			}

			:host([variant='warning']) {
				--button-foreground: var(--vscode-inputValidation-warningForeground, #fc6);
				--button-background: var(--vscode-inputValidation-warningBackground, #352a05);
				--button-hover-background: color-mix(
					in srgb,
					#000 30%,
					var(--vscode-inputValidation-warningBorder, #b89500)
				);
				--button-border: var(--vscode-inputValidation-warningBorder, #b89500);
			}

			:host([variant='success']) {
				--button-foreground: #fff;
				--button-background: color-mix(in srgb, #000 40%, var(--vscode-testing-iconPassed, #73c991));
				--button-hover-background: color-mix(in srgb, #000 30%, var(--vscode-testing-iconPassed, #73c991));
				--button-border: color-mix(in srgb, #000 40%, var(--vscode-testing-iconPassed, #73c991));
			}

			/* Transparent appearances (toolbar, input, alert) with variants only change foreground color */

			/* These come after the main variant rules to override background/border back to transparent */
			:host([appearance='toolbar'][variant='danger']),
			:host([appearance='input'][variant='danger']),
			:host([appearance='alert'][variant='danger']) {
				--button-foreground: var(--vscode-errorForeground, #f48771);
				--button-background: transparent;
				--button-border: transparent;
			}

			:host([appearance='toolbar'][variant='warning']),
			:host([appearance='input'][variant='warning']),
			:host([appearance='alert'][variant='warning']) {
				--button-foreground: var(--vscode-editorWarning-foreground, #cca700);
				--button-background: transparent;
				--button-border: transparent;
			}

			:host([appearance='toolbar'][variant='success']),
			:host([appearance='input'][variant='success']),
			:host([appearance='alert'][variant='success']) {
				--button-foreground: var(--vscode-testing-iconPassed, #73c991);
				--button-background: transparent;
				--button-border: transparent;
			}

			:host([appearance='input']) .control {
				gap: var(--gl-space-2);
				height: var(--button-input-height, 1.8rem);
				padding: var(--button-input-padding);
				--button-line-height: 1.1;
			}

			:host([appearance='input'][href]) > a,
			:host([appearance='toolbar'][href]) > a {
				display: flex;
				align-items: center;
			}

			:host([appearance='alert'][href]) > a {
				display: block;
				width: max-content;
			}

			/* Give solid-filled buttons a bit more horizontal breathing room. Exposed via a
	   CSS var so consumers (e.g. compose-mode commit checkbox) can collapse to a
	   square icon button. */
			:host(:not([appearance])) .control,
			:host([appearance='secondary']) .control {
				padding-inline: var(--button-padding-inline, 0.8rem);
			}

			:host([density='compact']) .control {
				padding: var(--button-compact-padding);
			}

			:host([density='tight']) .control {
				padding: var(--button-tight-padding);
			}

			:host([density='tight']) .control ::slotted(code-icon) {
				--code-icon-size: 11px;
				--code-icon-v-align: unset;
			}

			:host([aria-checked]:hover:not([disabled], [aria-checked='true'])) {
				background-color: var(--vscode-inputOption-hoverBackground);
			}

			:host([disabled]) {
				pointer-events: none;
				cursor: not-allowed;
				opacity: 0.4;
			}

			:host([disabled][aria-checked='true']) {
				opacity: 0.8;
			}

			:host([aria-checked='true']) {
				color: var(--vscode-inputOption-activeForeground);
				background-color: var(--vscode-inputOption-activeBackground);
				border-color: var(--vscode-inputOption-activeBorder);
			}

			gl-tooltip {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 100%;
				height: 100%;
			}
		`,
	];

	@query('.control')
	protected control!: HTMLElement;

	/**
	 * Visual treatment. Controls chrome and structure; use `variant` for semantic state color and
	 * `density` for size. On the transparent appearances (`toolbar`, `input`, `alert`) a `variant`
	 * only recolors the text — the background and border stay transparent.
	 *
	 * Unset (default) — solid, filled with VS Code's primary button color. The main action on a
	 * surface; there should generally be only one.
	 *
	 * `secondary` — solid, in VS Code's muted button color. The lesser action sitting next to a
	 * default button (Cancel, Dismiss, a second choice in the same row).
	 *
	 * `toolbar` — no chrome until hover. Icon actions in view headers, row hover actions, and
	 * action bars, where a filled button would be visual noise.
	 *
	 * `input` — `toolbar`, but sized to sit inside a text field's chrome: fixed height, tighter
	 * padding and gap, and an inset focus ring so it doesn't collide with the field's border. For
	 * affordances rendered within a field — clear buttons, mode toggles, token pickers. Often
	 * paired with `role="checkbox"` + `aria-checked` for the toggles.
	 *
	 * `alert` — outlined in the info-alert color, filling on hover. For the call to action inside
	 * an alert or feature-gate banner, where a solid button would fight the banner's background.
	 *
	 * `link` — renders as an inline hyperlink: text-link colors, no padding or radius, and the
	 * label (not the prefix/suffix icons) underlines on hover. For an action inside prose that
	 * should read as a link. Combine with `href` for real navigation; use it without `href` when
	 * the action runs a command but belongs visually in the sentence.
	 *
	 * @summary Visual treatment. Unset is the primary filled button.
	 */
	@property({ reflect: true })
	appearance?: 'alert' | 'secondary' | 'toolbar' | 'input' | 'link';

	@property({ reflect: true })
	variant?: 'danger' | 'warning' | 'success';

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property({ reflect: true })
	density?: 'compact' | 'tight';

	@property({ type: Boolean, reflect: true })
	full = false;

	/**
	 * Setting `href` switches the host `role` to `link` and renders an anchor; otherwise the
	 * host is a `button`. Setting `aria-checked` turns it into a toggle, picking up VS Code's
	 * input-option colors.
	 */
	@property()
	href?: string;

	@property()
	tooltip?: string;

	@property()
	tooltipPlacement?: GlTooltip['placement'] = 'bottom';

	@property({ type: Boolean, reflect: true })
	truncate = false;

	@property({ type: String, attribute: 'aria-label' })
	override ariaLabel: string | null = null;

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.setAttribute('role', this.href ? 'link' : 'button');
		if (this.disabled) {
			this.setAttribute('aria-disabled', this.disabled.toString());
		}
	}

	protected override willUpdate(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		if (changedProperties.has('href')) {
			this.setAttribute('role', this.href ? 'link' : 'button');
		}

		if (changedProperties.has('disabled')) {
			// Reflect the NEW disabled state — `changedProperties.get('disabled')` is the PREVIOUS value,
			// which set `aria-disabled` inverted on every toggle (announced enabled buttons as disabled).
			if (this.disabled) {
				this.setAttribute('aria-disabled', 'true');
			} else {
				this.removeAttribute('aria-disabled');
			}
		}

		super.willUpdate(changedProperties);
	}

	protected override render(): unknown {
		if (this.tooltip) {
			return html`<gl-tooltip .content=${this.tooltip} placement=${ifDefined(this.tooltipPlacement)}
				>${this.renderControl()}</gl-tooltip
			>`;
		}

		if (this.querySelectorAll('[slot="tooltip"]').length > 0) {
			return html`<gl-tooltip placement=${ifDefined(this.tooltipPlacement)}>
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
				aria-label=${ifDefined(this.ariaLabel)}
				tabindex="${ifDefined(this.disabled === false ? undefined : -1)}"
				href=${this.href}
				@keypress=${(e: KeyboardEvent) => this.onLinkKeypress(e)}
				><slot name="prefix"></slot><slot class="label"></slot><slot name="suffix"></slot
			></a>`;
		}
		return html`<button
			class="control"
			role=${ifDefined(this.role)}
			aria-label=${ifDefined(this.ariaLabel)}
			aria-checked=${ifDefined(this.ariaChecked)}
			?disabled=${this.disabled}
		>
			<slot name="prefix"></slot><slot class="label"></slot><slot name="suffix"></slot>
		</button>`;
	}

	private onLinkKeypress(e: KeyboardEvent) {
		if (e.key === ' ') {
			this.control.click();
		}
	}

	override focus(options?: FocusOptions): void {
		this.control.focus(options);
	}

	override blur(): void {
		this.control.blur();
	}

	override click(): void {
		this.control.click();
	}
}
