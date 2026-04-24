import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './code-icon.js';

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
		:host {
			--gradient-start: #7c3aed;
			--gradient-mid: #0ea5e9;
			--gradient-end: #06b6d4;

			position: relative;
			display: flex;
			flex-direction: column;
			flex: none;
		}

		/* The textarea/input + action button row. Owns the pill border + gradient treatment
		   so the footer can sit as its own "attached" band below without being wrapped by it. */
		.ai-input__row {
			display: flex;
			align-items: stretch;
			min-width: 0;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 0.6rem;
			z-index: 1;
			transition:
				border-color 0.3s,
				box-shadow 0.3s,
				background 0.3s;
		}

		/* Footer area — only visible when the consumer slots content (e.g. the model chip).
		   The has-footer host attribute is toggled by slotchange so an empty slot doesn't
		   render an empty bordered band. Rendered as its own bordered pill sitting just below
		   the input — visually attached but clearly distinct from the input pill. */
		.ai-input__footer {
			display: none;
			align-items: center;
			justify-content: flex-start;
			gap: 0.4rem;
			margin-top: -0.3rem;
			padding: 0.5rem 0.4rem 0.2rem 0.4rem;
			min-height: 0px;
			background: var(--vscode-input-background);
			border-bottom: 1px solid var(--vscode-input-border);
			border-right: 1px solid var(--vscode-input-border);
			border-left: 1px solid var(--vscode-input-border);
			border-radius: 0 0 0.6rem 0.6rem;
			color: var(--vscode-descriptionForeground);
		}

		:host([has-footer]) .ai-input__footer {
			display: flex;
		}

		/* Focus / Active: gradient border glow */
		:host([focused]) .ai-input__row,
		:host([active]) .ai-input__row {
			border-color: transparent;
			background:
				linear-gradient(var(--vscode-input-background), var(--vscode-input-background)) padding-box,
				linear-gradient(135deg, var(--gradient-start), var(--gradient-mid), var(--gradient-end)) border-box;
			box-shadow: 0 0 8px rgba(124 58 237 / 25%);
		}

		:host([focused]) .action-btn,
		:host([active]) .action-btn {
			border-right-color: var(--gradient-end);
		}

		/* Focus-in: same spinning conic gradient as busy, one rotation */
		:host([focusing]) .ai-input__row {
			border-color: transparent;
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
			transition: none;
			animation: ai-spin 2s linear 1;
		}

		/* Busy: spinning conic gradient border */
		:host([busy]) .ai-input__row {
			border-color: transparent;
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
			margin: 0;
			padding: 0.4rem 0.7rem;
			font-size: var(--vscode-font-size);
			font-family: var(--vscode-font-family);
			color: var(--vscode-input-foreground);
			background: transparent;
			border: none;
			outline: none;
		}

		textarea {
			resize: none;
			field-sizing: content;
			/* Min-height is overridden inline via the rows property so callers can request a
			   2-row default without affecting the explain inputs that want a single row. */
			min-height: 1.4em;
			max-height: 6em;
			line-height: 1.4;
			scrollbar-width: thin;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}

		textarea::-webkit-scrollbar {
			width: 6px;
		}

		textarea::-webkit-scrollbar-thumb {
			background-color: var(--vscode-scrollbarSlider-background);
			border-radius: 3px;
		}

		textarea::-webkit-scrollbar-thumb:hover {
			background-color: var(--vscode-scrollbarSlider-hoverBackground);
		}

		textarea::-webkit-scrollbar-track {
			background: transparent;
		}

		textarea::placeholder {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		input::placeholder,
		textarea::placeholder {
			color: var(--vscode-input-placeholderForeground);
		}

		input::-webkit-search-cancel-button {
			-webkit-appearance: none;
			cursor: pointer;
			width: 16px;
			height: 16px;
			background-color: var(--vscode-foreground);
			-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z'/%3E%3C/svg%3E");
			-webkit-mask-size: contain;
		}

		.action-btn {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			padding: 0.3rem 1rem 0.3rem 0.8rem;
			border: none;
			cursor: pointer;
			align-self: stretch;
			flex: none;
			font-size: var(--vscode-font-size);
			font-weight: 500;
			font-family: inherit;
			white-space: nowrap;
			background: transparent;
			color: var(--vscode-foreground);
			border-radius: 0 0.6rem 0.6rem 0;
			border-right: 1px solid transparent;
			margin-right: -1px;
			transition:
				background 0.25s,
				color 0.25s,
				border-color 0.25s,
				flex-direction 0.3s;
			z-index: 1;
		}

		.action-btn:hover:not(:disabled) {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.action-btn:hover:not(:disabled) .icon-sparkle {
			color: var(--vscode-button-foreground);
		}

		.action-btn:disabled {
			opacity: 0.6;
			cursor: default;
			pointer-events: none;
		}

		.action-btn[aria-busy='true'] {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		/* Send mode: when input is focused or has text */
		input:focus ~ .action-btn,
		input:not(:placeholder-shown) ~ .action-btn,
		textarea:focus ~ .action-btn,
		textarea:not(:placeholder-shown) ~ .action-btn {
			padding-right: 0.8rem;
			padding-left: 1rem;
			flex-direction: row-reverse;
			gap: 0.5rem;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		/* Active mode: border glow + button always active (for review/compose) */
		:host([active]) .action-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		input:focus ~ .action-btn .icon-sparkle,
		input:not(:placeholder-shown) ~ .action-btn .icon-sparkle,
		textarea:focus ~ .action-btn .icon-sparkle,
		textarea:not(:placeholder-shown) ~ .action-btn .icon-sparkle {
			transform: translateX(-100%);
			opacity: 0;
		}

		input:focus ~ .action-btn .icon-send,
		input:not(:placeholder-shown) ~ .action-btn .icon-send,
		textarea:focus ~ .action-btn .icon-send,
		textarea:not(:placeholder-shown) ~ .action-btn .icon-send {
			transform: translateX(0);
			opacity: 1;
		}

		.icon-slider {
			position: relative;
			width: 16px;
			height: 16px;
			overflow: hidden;
			flex-shrink: 0;
		}

		.icon-sparkle,
		.icon-send {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			transition:
				transform 0.3s ease,
				opacity 0.3s ease;
		}

		.icon-sparkle {
			transform: translateX(0);
			opacity: 1;
			color: #c594ff;
		}

		.icon-send {
			transform: translateX(100%);
			opacity: 0;
		}

		.action-label {
			line-height: 1;
		}
	`;

	@property({ type: Boolean, reflect: true })
	busy = false;

	@property({ type: Boolean })
	disabled = false;

	@property()
	placeholder = 'Optional guidance for the AI explanation...';

	@property({ attribute: 'button-label' })
	buttonLabel = 'Explain';

	@property({ attribute: 'busy-label' })
	busyLabel = 'Explaining changes\u2026';

	@property({ attribute: 'event-name' })
	eventName = 'gl-explain';

	@property({ type: Boolean, reflect: true })
	multiline = false;

	@property({ type: Boolean, reflect: true })
	active = false;

	/** Default visible rows for the textarea (only honored when `multiline`). */
	@property({ type: Number })
	rows = 1;

	override render(): unknown {
		const minHeight = this.rows > 1 ? `${this.rows * 1.4}em` : undefined;
		const textareaStyle = minHeight != null ? `min-height: ${minHeight}` : undefined;
		const inputPart = this.multiline
			? html`<textarea
					part="input"
					rows=${this.rows}
					style=${textareaStyle ?? nothing}
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
				${inputPart}<button
					class="action-btn"
					part="button"
					title=${this.buttonLabel}
					aria-busy=${this.busy ? 'true' : nothing}
					?disabled=${this.disabled || this.busy}
					@click=${this.onSubmit}
				>
					${this.busy
						? html`<code-icon icon="loading" modifier="spin"></code-icon>`
						: html`<span class="icon-slider"
								><code-icon class="icon-sparkle" icon="sparkle"></code-icon
								><code-icon class="icon-send" icon="send"></code-icon
							></span>`}
					<span class="action-label">${this.buttonLabel}</span>
				</button>
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
