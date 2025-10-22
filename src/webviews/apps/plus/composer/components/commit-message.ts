import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import { debounce } from '../../../../../system/function/debounce';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';

@customElement('gl-commit-message')
export class CommitMessage extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		scrollableBase,
		boxSizingBase,
		focusableBaseStyles,
		css`
			:host {
				display: contents;
			}

			.commit-message {
				max-width: 80rem;
			}

			.commit-message__text,
			.commit-message__input {
				border-radius: 0.2rem;
				font-family: inherit;
				font-size: 1.3rem;
				line-height: 2rem;
				color: var(--vscode-input-foreground);
				-webkit-font-smoothing: auto;
			}

			.commit-message__text {
				border: 1px solid var(--vscode-panel-border);
				background: var(--color-background);
				margin-block: 0;
			}

			.commit-message__text.placeholder {
				color: var(--vscode-input-placeholderForeground);
				font-style: italic;
			}

			.commit-message__text .scrollable {
				display: block;
				overflow-y: auto;
			}

			.commit-message__text .scrollable,
			.commit-message__input {
				padding: 0.5rem;
				min-height: 1lh;
				max-height: 10lh;
			}

			.commit-message__field {
				position: relative;
			}

			.commit-message__input {
				box-sizing: content-box;
				width: calc(100% - 1rem);
				border: 1px solid var(--vscode-input-border);
				background: var(--vscode-input-background);
				vertical-align: middle;
				field-sizing: content;
				resize: none;
			}

			.commit-message__input::-webkit-scrollbar {
				width: 10px;
			}

			.commit-message__input::-webkit-scrollbar-track {
				background: transparent;
			}

			.commit-message__input::-webkit-scrollbar-thumb {
				background-color: transparent;
				border-color: transparent;
				border-right-style: inset;
				border-right-width: calc(100vw + 100vh);
				border-radius: unset !important;
			}

			.commit-message__input:hover::-webkit-scrollbar-thumb,
			.commit-message__input:focus-within::-webkit-scrollbar-thumb {
				border-color: var(--vscode-scrollbarSlider-background);
			}

			.commit-message__input::-webkit-scrollbar-thumb:hover {
				border-color: var(--vscode-scrollbarSlider-hoverBackground);
			}

			.commit-message__input::-webkit-scrollbar-thumb:active {
				border-color: var(--vscode-scrollbarSlider-activeBackground);
			}

			.commit-message__input:has(~ .commit-message__ai-button) {
				padding-right: 3rem;
				width: calc(100% - 3.5rem);
			}

			.commit-message__input.has-explanation {
				border-bottom-left-radius: 0;
				border-bottom-right-radius: 0;
			}

			.commit-message__input::placeholder {
				color: var(--vscode-input-placeholderForeground);
				-webkit-font-smoothing: auto;
			}

			.commit-message__input[aria-valid='false'] {
				border-color: var(--vscode-inputValidation-errorBorder);
			}

			.commit-message__input:disabled {
				opacity: 0.4;
				cursor: not-allowed;
				pointer-events: none;
			}

			.commit-message__explanation {
				padding: 0.8rem 1.6rem;
				font-size: 1.2rem;
				line-height: 1.4;
				border: 1px solid var(--vscode-panel-border);
				border-top: none;
				border-radius: 0 0 0.4rem 0.4rem;
				background: var(--vscode-multiDiffEditor-headerBackground);
				color: var(--vscode-input-foreground);
				margin-block: 0;
			}

			.commit-message__explanation-block {
				margin-block: 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.commit-message__explanation:focus-visible,
			.commit-message__explanation:hover {
				.commit-message__explanation-block {
					text-overflow: unset;
					overflow: visible;
					white-space: normal;
				}
			}

			.commit-message__explanation-text {
				color: var(--color-foreground--75);
			}

			.message {
				/* position: absolute;
				top: 100%;
				left: 0;
				width: 100%; */
				padding: 0.4rem;
				transform: translateY(-0.1rem);
				z-index: 1000;
				background-color: var(--vscode-inputValidation-infoBackground);
				border: 1px solid var(--vscode-inputValidation-infoBorder);
				color: var(--gl-search-input-foreground);
				font-size: 1.2rem;
				line-height: 1.4;
			}

			.message:empty {
				display: none;
			}

			.commit-message__input[aria-valid='false'] + .message {
				background-color: var(--vscode-inputValidation-errorBackground);
				border-color: var(--vscode-inputValidation-errorBorder);
			}

			.commit-message__field {
				position: relative;
			}

			.commit-message__ai-button {
				position: absolute;
				top: 0.3rem;
				right: 0.3rem;
				z-index: 1;
			}
		`,
	];

	@property({ type: String, attribute: 'commit-id', reflect: true })
	commitId?: string;

	@property({ type: String })
	message?: string;

	@property({ type: String })
	explanation?: string;

	@property({ type: String, attribute: 'explanation-label' })
	explanationLabel?: string = 'Auto-composition Summary:';

	@property({ type: String })
	placeholder: string = 'Enter commit message...';

	@property({ type: Boolean, reflect: true })
	editable: boolean = false;

	@property({ type: Boolean, attribute: 'ai-enabled', reflect: true })
	aiEnabled: boolean = false;

	@property({ type: String })
	aiDisabledReason: string | null = null;

	@property({ type: Boolean, reflect: true })
	generating: boolean = false;

	@query('#focusable')
	focusableElement!: HTMLTextAreaElement | HTMLParagraphElement;

	@state()
	validityMessage?: string;

	protected override updated(changedProperties: PropertyValues): void {
		if (changedProperties.has('message')) {
			this.checkValidity();
		}
	}

	override render() {
		return html`<div class="commit-message">
			${when(
				this.editable,
				() => this.renderEditable(),
				() => this.renderReadOnly(),
			)}
			${this.renderExplanation()}
		</div>`;
	}

	private renderEditable() {
		return html`
			<div class="commit-message__field">
				<textarea
					id="focusable"
					class="commit-message__input${this.explanation ? ' has-explanation' : ''}"
					.value=${this.message ?? ''}
					.placeholder=${this.placeholder}
					rows="3"
					aria-valid=${this.validityMessage ? 'false' : 'true'}
					?invalid=${this.validityMessage ? 'true' : 'false'}
					@input=${this.onMessageInput}
				></textarea>
				${this.renderHelpText()}
				${when(
					this.aiEnabled,
					() =>
						html`<gl-button
							class="commit-message__ai-button"
							appearance="toolbar"
							?disabled=${this.generating}
							.tooltip=${this.generating ? 'Generating...' : 'Generate commit message with AI'}
							@click=${() => this.onGenerateCommitMessageClick()}
						>
							<code-icon
								.icon=${this.generating ? 'loading' : 'sparkle'}
								.modifier=${this.generating ? 'spin' : ''}
							></code-icon>
						</gl-button>`,
					() =>
						html`<gl-button
							class="commit-message__ai-button"
							appearance="toolbar"
							.tooltip=${this.aiDisabledReason || 'AI features are disabled'}
						>
							<code-icon icon="sparkle"></code-icon>
						</gl-button>`,
				)}
			</div>
		`;
	}

	private renderHelpText() {
		return html`<div class="message" id="help-text" aria-live="polite">${this.validityMessage}</div>`;
	}

	private renderReadOnly() {
		let displayMessage = 'Draft commit (add a commit message)';
		let isPlaceholder = true;
		if (this.message && this.message.trim().length > 0) {
			displayMessage = this.message.replace(/\n/g, '<br/>');
			isPlaceholder = false;
		}

		return html`<p id="focusable" class="commit-message__text${isPlaceholder ? ' placeholder' : ''}">
			<span class="scrollable"> ${unsafeHTML(displayMessage)} </span>
		</p>`;
	}

	private renderExplanation() {
		if (!this.explanation) return nothing;

		return html`<div tabindex="0" class="commit-message__explanation">
			<p class="commit-message__explanation-block">
				${this.explanationLabel} <span class="commit-message__explanation-text">${this.explanation}</span>
			</p>
		</div>`;
	}

	private onGenerateCommitMessageClick() {
		if (!this.aiEnabled) return;

		this.dispatchEvent(
			new CustomEvent('generate-commit-message', {
				bubbles: true,
				composed: true,
				detail: {
					commitId: this.commitId,
				},
			}),
		);
	}

	private onMessageInput(event: InputEvent) {
		const target = event.target as HTMLTextAreaElement;
		const message = target.value;
		this.dispatchMessageChangeDebounced(message);
	}

	private disapatchMessageChange(message: string) {
		this.dispatchEvent(
			new CustomEvent('message-change', {
				bubbles: true,
				composed: true,
				detail: {
					commitId: this.commitId,
					message: message,
				},
			}),
		);
	}

	dispatchMessageChangeDebounced = debounce(this.disapatchMessageChange.bind(this), 300);

	override focus(options?: FocusOptions) {
		this.focusableElement?.focus(options);
	}

	checkValidity(reportErrors = false) {
		if (!this.editable) {
			this.validityMessage = undefined;
			return;
		}

		const valid = this.message ? this.message.length > 0 : false;
		if (!valid && reportErrors) {
			this.validityMessage = 'Error: Commit message is required.';
		} else {
			this.validityMessage = undefined;
		}
	}

	select(checkValidity = false) {
		if (this.editable) {
			if (checkValidity) {
				this.checkValidity(true);
			}
			(this.focusableElement as HTMLTextAreaElement)?.select();
		}
	}
}
