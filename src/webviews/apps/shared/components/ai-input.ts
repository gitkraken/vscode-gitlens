import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { cspStyleMap } from './csp-style-map.directive.js';
import { focusOutlineButton } from './styles/lit/a11y.css.js';
import './code-icon.js';
import './overlays/tooltip.js';

try {
	CSS.registerProperty({
		name: '--angle',
		syntax: '<angle>',
		inherits: false,
		initialValue: '0deg',
	});
} catch {}

@customElement('gl-ai-input')
export class GlAiInput extends LitElement {
	static override styles = css`
		/* The host is the unified panel: it owns the pill border + gradient treatment so the input
		   row and footer read as one rounded AI surface (children round their own outer corners to
		   match, since the tooltips can't live under an overflow:hidden ancestor). */
		:host {
			--gradient-start: var(--gl-ai-accent-1);
			--gradient-mid: var(--gl-ai-accent-2);
			--gradient-end: var(--gl-ai-accent-3);
			--ai-action-fill: linear-gradient(135deg, var(--gradient-start), var(--gradient-mid), var(--gradient-end));

			position: relative;
			display: flex;
			flex: none;
			flex-direction: column;
			min-width: 0;
			background: var(--vscode-input-background);
			border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
			border-radius: var(--gl-radius-md);
			transition:
				border-color var(--gl-duration-x-slow),
				box-shadow var(--gl-duration-x-slow),
				background var(--gl-duration-x-slow);
		}

		/* The textarea/input + action button row, sitting inside the unified panel (the host). */
		.ai-input__row {
			position: relative;
			z-index: 1;
			display: flex;
			align-items: stretch;
			min-width: 0;
		}

		/* Footer — only shown when the consumer slots content (e.g. the model chip). Sits inside
		   the unified panel, set off by a hairline divider + a whisper of accent tint. The
		   has-footer host attribute is toggled by slotchange so an empty slot renders nothing. */
		.ai-input__footer {
			display: none;
			align-items: center;
			min-height: 0;
			padding: 0.2rem 0.5rem;
			color: var(--vscode-descriptionForeground);
			background: color-mix(in srgb, var(--gl-ai-accent-1) 5%, transparent);
			border-top: var(--gl-border-width) solid var(--vscode-input-border, transparent);
			border-radius: 0 0 var(--gl-radius-md) var(--gl-radius-md);
		}

		:host([has-footer]) .ai-input__footer {
			display: flex;
		}

		/* Let the slotted chip span the footer so its trailing content (consumption rate) can
		   sit at the far end. */
		.ai-input__footer slot {
			display: flex;
			flex: 1;
			min-width: 0;
		}

		.ai-input__footer ::slotted(*) {
			flex: 1;
			min-width: 0;
		}

		/* Floating footer — hangs flush off the input's bottom on focus (attached, not a detached
		   popup), overlaying content below so it never reserves a row. For compact inputs (Explain). */
		:host([floating-footer]) .ai-input__footer {
			position: absolute;
			top: calc(100% - var(--gl-border-width));
			right: 0;
			left: 0;
			z-index: 2;
			background: color-mix(in srgb, var(--gl-ai-accent-1) 5%, var(--vscode-input-background));
			border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
			border-radius: 0 0 var(--gl-radius-md) var(--gl-radius-md);
			opacity: 0;
			transform: translateY(-0.2rem);
			pointer-events: none;
			transition:
				opacity var(--gl-duration-fast),
				transform var(--gl-duration-fast);
		}

		:host([floating-footer]:focus-within) .ai-input__footer {
			opacity: 1;
			transform: none;
			pointer-events: auto;
		}

		/* While the attached footer shows, square the panel's bottom so the two read as one surface. */
		:host([floating-footer]:focus-within) {
			border-bottom-right-radius: 0;
			border-bottom-left-radius: 0;
		}

		@media (prefers-reduced-motion: reduce) {
			:host([floating-footer]) .ai-input__footer {
				transition: none;
				transform: none;
			}
		}

		/* Hover / Focus / Active: gradient border glow on the unified panel */
		:host(:hover),
		:host([focused]),
		:host([active]) {
			background:
				linear-gradient(var(--vscode-input-background), var(--vscode-input-background)) padding-box,
				linear-gradient(135deg, var(--gradient-start), var(--gradient-mid), var(--gradient-end)) border-box;
			border-color: transparent;
			box-shadow: 0 0 8px rgb(124 58 237 / 25%);
		}

		/* Focus-in: same spinning conic gradient as busy, one rotation */
		:host([focusing]) {
			background:
				linear-gradient(var(--vscode-input-background), var(--vscode-input-background)) padding-box,
				conic-gradient(
						from var(--angle, 0deg),
						var(--gradient-start),
						var(--gradient-mid),
						var(--gradient-end),
						var(--gradient-start)
					)
					border-box;
			border-color: transparent;
			transition: none;
			animation: ai-spin 2s linear 1;
		}

		/* Busy: spinning conic gradient border */
		:host([busy]) {
			background:
				linear-gradient(var(--vscode-input-background), var(--vscode-input-background)) padding-box,
				conic-gradient(
						from var(--angle, 0deg),
						var(--gradient-start),
						var(--gradient-mid),
						var(--gradient-end),
						var(--gradient-start)
					)
					border-box;
			border-color: transparent;
			animation: ai-spin 2s linear infinite;
		}

		@keyframes ai-spin {
			to {
				--angle: 360deg;
			}
		}

		input,
		textarea {
			flex: 1;
			width: 0;
			min-width: 0;
			max-width: none;
			padding: 0.4rem 0.7rem;
			margin: 0;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-input-foreground);
			outline: none;
			background: transparent;
			border: none;
		}

		textarea {
			/* min-height comes from --gl-ai-input-min-height (set on the host via CSSOM in
		   updated()) so callers can request a 2-row default without affecting the explain
		   inputs that want a single row. */
			min-height: var(--gl-ai-input-min-height, 1.4em);
			max-height: 6em;
			line-height: 1.4;
			resize: none;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
			scrollbar-width: thin;
			field-sizing: content;
		}

		textarea::-webkit-scrollbar {
			width: 6px;
		}

		textarea::-webkit-scrollbar-thumb {
			background-color: var(--vscode-scrollbarSlider-background);
			border-radius: var(--gl-radius-sm);
		}

		textarea::-webkit-scrollbar-thumb:hover {
			background-color: var(--vscode-scrollbarSlider-hoverBackground);
		}

		textarea::-webkit-scrollbar-track {
			background: transparent;
		}

		textarea::placeholder {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		input::placeholder,
		textarea::placeholder {
			color: var(--vscode-input-placeholderForeground);
		}

		input::-webkit-search-cancel-button {
			width: 16px;
			height: 16px;
			-webkit-appearance: none;
			cursor: pointer;
			background-color: var(--vscode-foreground);
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z'/%3E%3C/svg%3E");
			-webkit-mask-size: contain;
		}

		/* Inset floating pill — sits centered inside the panel with a small gap on all sides
		   (matches the design) rather than filling the panel's right edge. */
		.action-btn {
			z-index: 1;
			display: flex;
			flex: none;
			gap: 0.5rem;
			align-items: center;
			align-self: center;
			padding: 0.3rem 1rem 0.3rem 0.8rem;
			margin: 0.3rem;
			font-family: inherit;
			font-size: var(--vscode-font-size);
			font-weight: 500;
			color: var(--vscode-foreground);
			white-space: nowrap;
			cursor: pointer;
			background: transparent;
			border: none;
			border-radius: var(--gl-radius-md);
			transition:
				background var(--gl-duration-slow),
				color var(--gl-duration-slow),
				box-shadow var(--gl-duration-slow),
				flex-direction var(--gl-duration-x-slow);
		}

		/* Soft accent glow under the pill whenever it's filled (active / hover / focus / text / busy). */
		:host([active]) .action-btn,
		:host([busy]) .action-btn,
		.action-btn:hover:not(:disabled),
		:host(:hover) .action-btn:not(:disabled),
		.action-btn:focus:not(:disabled),
		:host([focused]) .action-btn,
		:host([has-value]) .action-btn {
			box-shadow: 0 1px 6px color-mix(in srgb, var(--gl-ai-accent-1) 30%, transparent);
		}

		/* Hovering anywhere in the row lights up the button too, so the pill responds as
	   one cohesive surface (the row's conic border already reacts to :host(:hover)). */
		.action-btn:hover:not(:disabled),
		:host(:hover) .action-btn:not(:disabled) {
			color: var(--vscode-button-foreground);
			background: var(--ai-action-fill);
		}

		.action-btn:hover:not(:disabled) .icon-sparkle,
		:host(:hover) .action-btn:not(:disabled) .icon-sparkle {
			color: var(--vscode-button-foreground);
		}

		/* Keyboard-visible focus ring on the button (fill + sparkle→send morph handled above). */
		.action-btn:focus-visible {
			${focusOutlineButton}
		}

		.action-btn:disabled {
			pointer-events: none;
			cursor: default;
			opacity: 0.6;
		}

		/* Unavailable state — uses aria-disabled (not native disabled) so the button stays hoverable
		   and its reason tooltip can show; onSubmit + tabindex guard activation/focus. Flat + muted,
		   no gradient / glow / send-morph. Higher specificity than the active / has-value / hover
		   fills so it wins in every state. Busy is a separate natively-disabled "working" state
		   (dimmed spinner) handled by the base rule above + the aria-busy fill. */
		:host(:not([busy])) .action-btn[aria-disabled='true'] {
			flex-direction: row;
			padding: 0.3rem 1rem 0.3rem 0.8rem;
			color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
			background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			box-shadow: none;
			opacity: 1;
			cursor: default;
		}

		:host(:not([busy])) .action-btn[aria-disabled='true'] .icon-sparkle {
			color: inherit;
			opacity: 1;
			transform: translateX(0);
		}

		:host(:not([busy])) .action-btn[aria-disabled='true'] .icon-send {
			opacity: 0;
			transform: translateX(100%);
		}

		.action-btn[aria-busy='true'] {
			color: var(--vscode-button-foreground);
			background: var(--ai-action-fill);
		}

		/* Send mode: morph sparkle→send + fill when the input or the button has focus, or there's
		   text — for every AI mode. Keyed off host attributes + button focus because the button is
		   nested in gl-tooltip, so the input ~ .action-btn sibling combinator can't reach it. */
		:host([focused]) .action-btn,
		:host([has-value]) .action-btn,
		.action-btn:focus {
			flex-direction: row-reverse;
			gap: 0.5rem;
			padding-right: var(--gl-space-8);
			padding-left: var(--gl-space-10);
			color: var(--vscode-button-foreground);
			background: var(--ai-action-fill);
		}

		/* Active mode: border glow + button always active (for review/compose) */
		:host([active]) .action-btn {
			color: var(--vscode-button-foreground);
			background: var(--ai-action-fill);
		}

		:host([active]) .action-btn .icon-sparkle {
			color: var(--vscode-button-foreground);
		}

		:host([focused]) .action-btn .icon-sparkle,
		:host([has-value]) .action-btn .icon-sparkle,
		.action-btn:focus .icon-sparkle {
			opacity: 0;
			transform: translateX(-100%);
		}

		:host([focused]) .action-btn .icon-send,
		:host([has-value]) .action-btn .icon-send,
		.action-btn:focus .icon-send {
			opacity: 1;
			transform: translateX(0);
		}

		.icon-slider {
			position: relative;
			flex-shrink: 0;
			width: 16px;
			height: 16px;
			overflow: hidden;
		}

		.icon-sparkle,
		.icon-send {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			transition:
				transform var(--gl-duration-x-slow) ease,
				opacity var(--gl-duration-x-slow) ease;
		}

		.icon-sparkle {
			color: #c594ff;
			opacity: 1;
			transform: translateX(0);
		}

		.icon-send {
			opacity: 0;
			transform: translateX(100%);
		}

		.action-label {
			line-height: 1;
		}
	`;

	@property({ type: Boolean, reflect: true })
	busy = false;

	@property({ type: Boolean })
	disabled = false;

	/** One-shot initial value. Written into the internal input on `firstUpdated`; subsequent
	 *  prop changes are intentionally ignored so we never stomp on user typing. Re-mount the
	 *  element (e.g. via Lit's `key` directive) to reseed. */
	@property()
	value?: string;

	@property()
	placeholder = 'Optional guidance for the AI explanation...';

	@property({ attribute: 'button-label' })
	buttonLabel = 'Explain';

	@property({ attribute: 'button-tooltip' })
	buttonTooltip?: string;

	/** Tooltip shown on the action button while disabled, explaining why (e.g. "Add files to compose"). */
	@property({ attribute: 'disabled-reason' })
	disabledReason?: string;

	@property({ attribute: 'busy-label' })
	busyLabel = 'Explaining changes\u2026';

	@property({ attribute: 'event-name' })
	eventName = 'gl-explain';

	@property({ type: Boolean, reflect: true })
	multiline = false;

	@property({ type: Boolean, reflect: true })
	active = false;

	/** Overlay the footer on focus instead of reserving a persistent row, so compact inputs
	 *  (e.g. Explain) don't lose vertical space to it. Requires slotted footer content. */
	@property({ type: Boolean, reflect: true, attribute: 'floating-footer' })
	floatingFooter = false;

	/** Default visible rows for the textarea (only honored when `multiline`). */
	@property({ type: Number })
	rows = 1;

	/** Optional history value recalled by pressing ArrowUp from the start of an empty input or
	 *  from cursor position 0. When set, gives the user a one-key "load the run's prompt back into
	 *  this input" affordance — used by the compose panel's Refine input to recall the prompt that
	 *  produced the current plan. Undefined means recall is disabled. */
	@property()
	recall?: string;

	/** Programmatically focus the inner input/textarea. Called by hosts that want to land
	 *  caret here on entry (e.g. compose/review mode toggle). */
	override focus(options?: FocusOptions): void {
		this.inputEl?.focus(options);
	}

	override render(): unknown {
		// `cspStyleMap` treats `null` as "remove", so single-row falls back to the CSS default.
		const minHeight = this.rows > 1 ? `${this.rows * 1.4}em` : null;
		const inputPart = this.multiline
			? html`<textarea
					part="input"
					rows=${this.rows}
					style=${cspStyleMap({ '--gl-ai-input-min-height': minHeight })}
					aria-label=${this.placeholder}
					placeholder=${this.busy ? this.busyLabel : this.placeholder}
					?disabled=${this.disabled || this.busy}
					@input=${this.onInput}
					@focus=${this.onFocusChange}
					@blur=${this.onFocusChange}
					@keydown=${this.onKeydown}
				></textarea>`
			: html`<input
					type="search"
					part="input"
					size="1"
					aria-label=${this.placeholder}
					placeholder=${this.busy ? this.busyLabel : this.placeholder}
					?disabled=${this.disabled || this.busy}
					@input=${this.onInput}
					@focus=${this.onFocusChange}
					@blur=${this.onFocusChange}
					@keydown=${this.onKeydown}
				/>`;

		return html`<div class="ai-input__row">
				${inputPart}<gl-tooltip
					content=${this.disabled && this.disabledReason
						? this.disabledReason
						: (this.buttonTooltip ?? this.buttonLabel)}
					placement="bottom"
					><button
						class="action-btn"
						part="button"
						aria-label=${this.buttonLabel}
						aria-busy=${this.busy ? 'true' : nothing}
						aria-disabled=${this.disabled && !this.busy ? 'true' : nothing}
						tabindex=${this.disabled && !this.busy ? -1 : nothing}
						?disabled=${this.busy}
						@click=${this.onSubmit}
					>
						${this.busy
							? html`<code-icon icon="loading" modifier="spin"></code-icon>`
							: html`<span class="icon-slider"
									><code-icon class="icon-sparkle" icon="sparkle"></code-icon
									><code-icon class="icon-send" icon="send"></code-icon
								></span>`}
						<span class="action-label">${this.buttonLabel}</span>
					</button></gl-tooltip
				>
			</div>
			<div class="ai-input__footer" part="footer">
				<slot name="footer" @slotchange=${this.onFooterSlotChange}></slot>
			</div>`;
	}

	private onFooterSlotChange = (e: Event): void => {
		const slot = e.target as HTMLSlotElement;
		const hasContent = slot.assignedElements({ flatten: true }).length > 0;
		this.toggleAttribute('has-footer', hasContent);
	};

	private get inputEl(): HTMLInputElement | HTMLTextAreaElement | null | undefined {
		return this.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
	}

	override firstUpdated(): void {
		const input = this.inputEl;
		if (input == null || this.value == null) return;

		input.value = this.value;
		this.toggleAttribute('has-value', Boolean(this.value));
	}

	private onInput(): void {
		this.toggleAttribute('has-value', Boolean(this.inputEl?.value));
	}

	private onFocusChange(): void {
		const focused = this.inputEl === this.shadowRoot?.activeElement;
		const wasFocused = this.hasAttribute('focused');
		this.toggleAttribute('focused', focused);

		// One-shot conic spin on focus gain; keep conic gradient while focused
		if (focused && !wasFocused && !this.busy) {
			this.toggleAttribute('focusing', true);
		} else if (!focused) {
			this.removeAttribute('focusing');
		}
	}

	private onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			// Shift+Enter: always insert newline (let browser handle)
			if (e.shiftKey) return;

			// Enter or Ctrl/Cmd+Enter: submit
			e.preventDefault();
			this.onSubmit();
			return;
		}

		// ArrowUp from an EMPTY input (cursor at position 0, nothing typed yet) loads `recall`.
		// Gated on empty because: (a) cursor-at-0 on a textarea with content is reachable via Home
		// or click, and replacing the user's typed text would be destructive + undo-stack-unfriendly;
		// (b) position-0 alone doesn't distinguish "blank input" from "I just want to move the
		// caret", whereas empty-input is unambiguous "give me the last prompt".
		if (e.key === 'ArrowUp' && this.recall != null && this.recall !== '') {
			const input = this.inputEl;
			if (input == null) return;
			if (input.value !== '') return;

			e.preventDefault();
			input.value = this.recall;
			input.setSelectionRange(this.recall.length, this.recall.length);
			this.toggleAttribute('has-value', true);
		}
	}

	private onSubmit(): void {
		if (this.disabled || this.busy) return;

		const prompt = this.inputEl?.value?.trim() || undefined;

		this.dispatchEvent(
			new CustomEvent(this.eventName, { detail: { prompt: prompt }, bubbles: true, composed: true }),
		);
	}
}
