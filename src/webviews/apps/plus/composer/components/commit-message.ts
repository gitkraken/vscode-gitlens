import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';

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
				position: sticky;
				top: var(--sticky-top, 0);
				z-index: 2;
				display: block;
				background: var(--vscode-editor-background);
			}

			.commit-message {
				max-width: 80rem;
			}

			.commit-message__text,
			.commit-message__input {
				font-family: inherit;
				font-size: var(--gl-font-base);
				line-height: 2rem;
				color: var(--vscode-input-foreground);
				border-radius: var(--gl-input-border-radius);
				-webkit-font-smoothing: auto;
			}

			.commit-message__text {
				margin-block: 0;
				background: var(--color-background);
				border: 1px solid var(--vscode-panel-border);
			}

			.commit-message__text[tabindex='0']:hover {
				cursor: text;
				background: color-mix(in srgb, transparent 50%, var(--vscode-input-background, #3c3c3c));
				border-color: color-mix(in srgb, transparent 50%, var(--vscode-input-border, #858585));
			}

			.commit-message__text.placeholder {
				font-style: italic;
				color: var(--vscode-input-placeholderForeground);
			}

			.commit-message__text .scrollable {
				display: block;
				overflow-y: auto;
			}

			.commit-message__text .scrollable,
			.commit-message__input {
				min-height: 1lh;
				max-height: 10lh;
				padding: var(--gl-space-8) var(--gl-space-10);
			}

			.commit-message__summary {
				display: block;
			}

			p.commit-message__text .scrollable .commit-message__body {
				display: block;
				margin-top: 0.5rem;
				font-size: 1.15rem !important;
				line-height: 1.8rem !important;
				color: var(--vscode-descriptionForeground) !important;
			}

			.commit-message__field {
				position: relative;
			}

			.commit-message__input {
				box-sizing: content-box;
				width: calc(100% - 2.2rem);
				vertical-align: middle;
				resize: none;
				background: var(--vscode-input-background, #3c3c3c);
				border: 1px solid var(--vscode-input-border, #858585);
				field-sizing: content;
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
				width: calc(100% - 4.2rem);
				padding-right: 3rem;
			}

			.commit-message__input.has-explanation {
				border-bottom-right-radius: 0;
				border-bottom-left-radius: 0;
			}

			.commit-message__input::placeholder {
				color: var(--vscode-input-placeholderForeground);
				-webkit-font-smoothing: auto;
			}

			.commit-message__input:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.commit-message__input[aria-valid='false'] {
				border-color: var(--vscode-inputValidation-errorBorder);
			}

			.commit-message__input:disabled {
				pointer-events: none;
				cursor: not-allowed;
				opacity: 0.4;
			}

			.commit-message__explanation {
				padding: var(--gl-space-8) var(--gl-space-16);
				margin-block: 0;
				font-size: var(--gl-font-md);
				line-height: 1.4;
				color: var(--vscode-input-foreground);
				background: var(--vscode-multiDiffEditor-headerBackground);
				border: 1px solid var(--vscode-panel-border);
				border-top: none;
				border-radius: 0 0 var(--gl-input-border-radius) var(--gl-input-border-radius);
			}

			.commit-message__explanation-block {
				margin-block: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.commit-message__explanation:focus-visible,
			.commit-message__explanation:hover {
				.commit-message__explanation-block {
					overflow: visible;
					text-overflow: unset;
					white-space: normal;
				}
			}

			.commit-message__explanation-text {
				color: var(--color-foreground--75);
			}

			.message {
				z-index: 1000;

				/* position: absolute;
		top: 100%;
		left: 0;
		width: 100%; */
				padding: var(--gl-space-4);
				font-size: var(--gl-font-md);
				line-height: 1.4;
				color: var(--gl-search-input-foreground);
				background-color: var(--vscode-inputValidation-infoBackground);
				border: 1px solid var(--vscode-inputValidation-infoBorder);
				transform: translateY(-0.1rem);
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
				top: 0.5rem;
				right: 0.7rem;
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

	@property({ type: Boolean, attribute: 'ai-generated', reflect: true })
	aiGenerated: boolean = false;

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

	@state()
	private isEditing: boolean = false;

	protected override updated(changedProperties: PropertyValues): void {
		if (changedProperties.has('message')) {
			this.checkValidity();
		}
	}

	override render() {
		const messageContent = this.message ?? '';
		const hasMessage = messageContent.trim().length > 0;
		const shouldShowTextarea = this.editable && (!hasMessage || this.isEditing);

		return html`<div class="commit-message">
			${when(
				shouldShowTextarea,
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
					@focus=${() => (this.isEditing = true)}
					@input=${this.onMessageInput}
					@blur=${this.exitEditMode}
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
								slot="prefix"
							></code-icon>
							${this.explanation || this.aiGenerated ? 'Regenerate Message' : 'Generate Message'}
						</gl-button>`,
					() =>
						html`<gl-button
							class="commit-message__ai-button"
							appearance="toolbar"
							.tooltip=${this.aiDisabledReason || 'AI features are disabled'}
						>
							<code-icon icon="sparkle" slot="prefix"></code-icon>
							${this.explanation || this.aiGenerated ? 'Regenerate Message' : 'Generate Message'}
						</gl-button>`,
				)}
			</div>
		`;
	}

	private renderHelpText() {
		return html`<div class="message" id="help-text" aria-live="polite">${this.validityMessage}</div>`;
	}

	private renderReadOnly() {
		const messageContent = this.message ?? '';
		const { summary, body } = splitCommitMessage(messageContent);
		const summaryHtml = summary.replace(/\n/g, '<br/>');
		const bodyHtml = body ? body.replace(/\n/g, '<br/>') : '';

		return html`
			<div class="commit-message__field">
				<p
					id="focusable"
					class="commit-message__text${this.explanation ? ' has-explanation' : ''}"
					@click=${this.editable ? () => this.enterEditMode() : nothing}
					tabindex=${this.editable ? '0' : '-1'}
				>
					<span class="scrollable">
						<span class="commit-message__summary">${unsafeHTML(summaryHtml)}</span>
						${body ? html`<span class="commit-message__body">${unsafeHTML(bodyHtml)}</span>` : nothing}
					</span>
				</p>
				${this.renderHelpText()}
				${when(
					this.editable && this.aiEnabled,
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
								slot="prefix"
							></code-icon>
							${this.explanation || this.aiGenerated ? 'Regenerate Message' : 'Generate Message'}
						</gl-button>`,
					() =>
						this.editable
							? html`<gl-button
									class="commit-message__ai-button"
									appearance="toolbar"
									.tooltip=${this.aiDisabledReason || 'AI features are disabled'}
									disabled
								>
									<code-icon icon="sparkle" slot="prefix"></code-icon>
									${this.explanation || this.aiGenerated ? 'Regenerate Message' : 'Generate Message'}
								</gl-button>`
							: nothing,
				)}
			</div>
		`;
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

	private enterEditMode() {
		this.isEditing = true;
		void this.updateComplete.then(() => {
			this.focusableElement?.focus();
		});
	}

	private exitEditMode() {
		this.isEditing = false;
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
