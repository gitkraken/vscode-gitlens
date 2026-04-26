import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { isMac } from '@env/platform.js';
import { elementBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { commitBoxStyles } from './gl-commit-box.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/code-icon.js';

@customElement('gl-commit-box')
export class GlCommitBox extends LitElement {
	static override styles = [elementBase, commitBoxStyles, scrollableBase];

	@property()
	message = '';

	@property({ type: Boolean })
	amend = false;

	@property({ type: Boolean })
	generating = false;

	@property()
	branchName = '';

	@property({ type: Boolean })
	canCommit = false;

	@property({ type: Boolean })
	aiEnabled = false;

	@property()
	commitError?: string;

	override render() {
		return html`
			<div class="options">
				${this.renderAmendToggle()}
				<gl-button appearance="secondary" @click=${this.onCompose}>
					<code-icon
						icon="wand"
						slot="prefix"
						style="color: var(--vscode-charts-purple, #7c3aed);"
					></code-icon>
					Compose
				</gl-button>
			</div>
			${this.renderTextarea()} ${this.renderActionBar()}
		`;
	}

	private renderAmendToggle() {
		return html`
			<gl-checkbox class="amend-checkbox" .checked=${this.amend} @gl-change-value=${this.onAmendChange}>
				Amend Previous Commit
			</gl-checkbox>
		`;
	}

	private renderTextarea() {
		const firstLine = this.message.split('\n')[0] ?? '';
		const len = firstLine.length;
		const modifier = isMac ? '\u2318' : 'Ctrl+';

		return html`
			<div class="message">
				<textarea
					class="textarea scrollable"
					.value=${this.message}
					placeholder=${`Commit message (${modifier}Enter to commit)`}
					@input=${this.onMessageInput}
					@keydown=${this.onMessageKeydown}
				></textarea>
				<div class="controls">
					${when(
						this.aiEnabled,
						() => html`
							<gl-button
								class="sparkle"
								appearance="toolbar"
								density="compact"
								tooltip=${this.generating
									? 'Generating commit message…'
									: 'Generate commit message with AI'}
								?disabled=${this.generating}
								aria-busy=${this.generating ? 'true' : 'false'}
								@click=${this.onGenerateMessage}
							>
								${this.generating
									? html`<code-icon icon="loading" modifier="spin"></code-icon>`
									: html`<code-icon icon="sparkle"></code-icon>`}
							</gl-button>
						`,
					)}
				</div>
				${len > 50 ? html`<span class="char-count">${len}</span>` : nothing}
			</div>
		`;
	}

	private renderActionBar() {
		const label = this.amend ? 'Amend to' : 'Commit to';

		return html`
			<gl-button
				class="commit-btn"
				full
				?disabled=${!this.canCommit}
				variant=${this.amend ? 'warning' : nothing}
				@click=${this.onCommit}
			>
				${label}&nbsp;
				<gl-branch-name .name=${this.branchName}></gl-branch-name>
			</gl-button>
			${this.commitError ? html`<span class="error">${this.commitError}</span>` : nothing}
		`;
	}

	private onMessageInput(e: Event) {
		this.dispatchEvent(
			new CustomEvent('message-change', {
				detail: { value: (e.target as HTMLTextAreaElement).value },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onMessageKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			if (this.canCommit) {
				this.dispatchEvent(new CustomEvent('commit', { bubbles: true, composed: true }));
			}
		}
	}

	private onAmendChange(e: Event) {
		const target = e.target as HTMLElement & { checked: boolean };
		this.dispatchEvent(
			new CustomEvent('amend-change', {
				detail: { checked: target.checked },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onCommit() {
		this.dispatchEvent(new CustomEvent('commit', { bubbles: true, composed: true }));
	}

	private onGenerateMessage() {
		this.dispatchEvent(new CustomEvent('generate-message', { bubbles: true, composed: true }));
	}

	private onCompose() {
		this.dispatchEvent(new CustomEvent('compose', { bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-box': GlCommitBox;
	}
}
