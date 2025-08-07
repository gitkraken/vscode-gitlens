import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { debounce } from '../../../../../system/function/debounce';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css';

@customElement('gl-commit-message')
export class CommitMessage extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		css`
			.commit-message {
			}

			.commit-message__text {
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				padding: 0.5rem 0.8rem;
				font-size: 1.3rem;
				line-height: 1.4;
				overflow-wrap: break-word;
				word-wrap: break-word;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 0.4rem;
				background: var(--color-background);
				color: var(--vscode-input-foreground);
			}

			.commit-message__field {
				position: relative;
			}

			.commit-message__input {
				width: 100%;
				padding: 0.5rem;
				font-family: inherit;
				font-size: 1.3rem;
				line-height: 1.4;
				/* border: 1px solid var(--vscode-input-border); */
				/* border-radius: 0.2rem; */
				/* background: var(--vscode-input-background); */
				border: 1px solid var(--vscode-panel-border);
				border-radius: 0.4rem;
				background: var(--color-background);
				color: var(--vscode-input-foreground);
				vertical-align: middle;
			}

			textarea.commit-message__input {
				box-sizing: content-box;
				width: calc(100% - 1.2rem);
				resize: vertical;
				field-sizing: content;
				min-height: 2lh;
				max-height: 4lh;
			}

			.has-explanation {
				border-bottom-left-radius: 0;
				border-bottom-right-radius: 0;
			}

			.commit-message__input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.commit-message__input:invalid {
				border-color: var(--vscode-inputValidation-errorBorder);
				background-color: var(--vscode-inputValidation-errorBackground);
			}

			.commit-message__input:disabled {
				opacity: 0.4;
				cursor: not-allowed;
				pointer-events: none;
			}

			.commit-message__action {
				position: absolute;
				top: 0.5rem;
				right: 0.5rem;
			}

			.commit-message__explanation {
				padding: 0.5rem 0.8rem;
				font-size: 1.2rem;
				line-height: 1.4;
				border: 1px solid var(--vscode-panel-border);
				border-top: none;
				border-radius: 0 0 0.4rem 0.4rem;
				background: var(--vscode-multiDiffEditor-headerBackground);
				color: var(--vscode-input-foreground);
				margin-block: 0;
			}
		`,
	];

	@property({ type: String, attribute: 'commit-id', reflect: true })
	commitId?: string;

	@property({ type: String })
	message?: string;

	@property({ type: String })
	explanation?: string;

	@property({ type: String })
	placeholder: string = 'Enter commit message...';

	@property({ type: Boolean, reflect: true })
	editable: boolean = false;

	@property({ type: Boolean, attribute: 'ai-enabled', reflect: true })
	aiEnabled: boolean = false;

	@property({ type: Boolean, reflect: true })
	generating: boolean = false;

	@query('#focusable')
	focusableElement!: HTMLTextAreaElement | HTMLParagraphElement;

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
					@input=${this.onMessageInput}
				></textarea>
				${when(
					this.aiEnabled,
					() =>
						html`<gl-button
							class="commit-message__action"
							appearance="toolbar"
							.title=${this.generating ? 'Generating...' : 'Generate commit message with AI'}
							?disabled=${this.generating}
							@click=${() => this.onGenerateCommitMessageClick()}
						>
							<code-icon
								.icon=${this.generating ? 'loading' : 'sparkle'}
								.modifier=${this.generating ? 'spin' : ''}
							></code-icon>
						</gl-button>`,
				)}
			</div>
		`;
	}

	private renderReadOnly() {
		return html`<p id="focusable" class="commit-message__text">${this.message}</p>`;
	}

	private renderExplanation() {
		if (!this.explanation) return nothing;

		return html`<p class="commit-message__explanation">${this.explanation}</p>`;
	}

	private onGenerateCommitMessageClick() {
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

	select() {
		if (this.editable) {
			(this.focusableElement as HTMLTextAreaElement)?.select();
		}
	}
}
