import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { isMac } from '@env/platform.js';
import type { WipSigning } from '../../../../plus/graph/detailsProtocol.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { elementBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { commitBoxStyles } from './gl-commit-box.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

// Register as a typed custom property so it can be animated/transitioned. @property in a
// constructable stylesheet doesn't reliably register in Chromium; the JS API does.
if (typeof CSS !== 'undefined' && 'registerProperty' in CSS) {
	try {
		CSS.registerProperty({
			name: '--gl-textarea-thumb-color',
			syntax: '<color>',
			inherits: true,
			initialValue: 'transparent',
		});
	} catch {
		/* already registered */
	}
}

@customElement('gl-commit-box')
export class GlCommitBox extends LitElement {
	static override styles = [elementBase, commitBoxStyles, scrollableBase];

	@property()
	message = '';

	@property({ type: Boolean })
	amend = false;

	@property({ type: Boolean, reflect: true })
	generating = false;

	@property({ type: Boolean, reflect: true })
	committing = false;

	@property()
	branchName = '';

	@property({ type: Boolean })
	canCommit = false;

	@property()
	disabledReason?: 'no-message' | 'no-staged';

	@property({ type: Boolean })
	aiEnabled = false;

	@property()
	commitError?: string;

	@property({ type: Object })
	signing?: WipSigning;

	@property({ type: Object })
	aiModel?: AiModelInfo;

	override render() {
		return html`
			<div class="options">
				${this.renderAmendToggle()}
				<div class="options-group">
					${this.renderSigningIndicator()}
					${this.aiEnabled
						? html`<gl-button appearance="secondary" @click=${this.onCompose}>
								<code-icon class="compose-icon" icon="wand" slot="prefix"></code-icon>
								Compose
							</gl-button>`
						: nothing}
				</div>
			</div>
			${this.renderTextarea()} ${this.renderActionBar()}
		`;
	}

	private renderSigningIndicator() {
		if (!this.signing?.enabled) return nothing;

		const label = `Commits will be signed using ${getSigningFormatLabel(this.signing.format)}`;
		return html`
			<gl-tooltip content=${label} placement="bottom">
				<span class="signing-indicator" tabindex="0" role="img" aria-label=${label}>
					<code-icon icon="key"></code-icon>
				</span>
			</gl-tooltip>
		`;
	}

	private renderAmendToggle() {
		return html`
			<gl-checkbox
				class="amend-checkbox"
				.checked=${this.amend}
				?disabled=${this.committing}
				@gl-change-value=${this.onAmendChange}
			>
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
				${this.aiEnabled
					? html`<svg class="working-ring" aria-hidden="true">
							<rect class="working-ring-base" pathLength="100"></rect>
							<rect class="working-ring-highlight" pathLength="100"></rect>
						</svg>`
					: nothing}
				<textarea
					class="textarea ${this.commitError ? 'has-error' : ''}"
					.value=${this.message}
					?disabled=${this.committing}
					aria-invalid=${this.commitError ? 'true' : 'false'}
					placeholder=${`Commit message (${modifier}Enter to commit)`}
					@input=${this.onMessageInput}
					@keydown=${this.onMessageKeydown}
				></textarea>
				${this.aiEnabled ? html`<div class="controls">${this.renderGenerateButton()}</div>` : nothing}
				<div class="controls controls-bottom">
					${len > 50 ? html`<span class="char-count">${len}</span>` : nothing}
					<gl-button
						class="add-coauthors"
						appearance="toolbar"
						density="compact"
						tooltip="Add Co-authors..."
						aria-label="Add Co-authors..."
						?disabled=${this.committing}
						@click=${this.onAddCoauthors}
					>
						<code-icon icon="person-add"></code-icon>
					</gl-button>
				</div>
			</div>
		`;
	}

	private renderGenerateButton() {
		const label = this.generating ? 'Cancel' : 'Generate Commit Message';
		// `gl-tooltip` is non-interactive (pointer-events: none), so use `gl-popover` to show
		// the current model as a clickable chip. `trigger="hover focus"` (no `click`) keeps the
		// sparkle's own click firing generate rather than toggling the popover.
		return html`
			<gl-popover placement="bottom" trigger="hover focus">
				<gl-button
					slot="anchor"
					class="sparkle"
					appearance="toolbar"
					density="compact"
					aria-label=${label}
					aria-busy=${this.generating ? 'true' : 'false'}
					@click=${this.onGenerateMessage}
				>
					${this.generating
						? html`<code-icon icon="loading" modifier="spin"></code-icon>`
						: html`<code-icon icon="sparkle"></code-icon>`}
				</gl-button>
				<div slot="content" class="generate-popover">
					<span class="generate-popover__action">${label}</span>
					${this.aiModel != null
						? html`<gl-ai-model-chip .model=${this.aiModel}></gl-ai-model-chip>`
						: nothing}
				</div>
			</gl-popover>
		`;
	}

	private renderActionBar() {
		const label = this.amend ? 'Amend Commit on' : 'Commit to';
		const action = this.amend ? 'amend commit on' : 'commit to';
		const branch = this.branchName;
		const enabledTooltip = `${label} ${branch}`;
		const disabledTooltip =
			this.disabledReason === 'no-message'
				? `Enter a commit message to ${action} ${branch}`
				: this.disabledReason === 'no-staged'
					? `Stage changes above to ${action} ${branch}`
					: '';

		return html`
			<gl-tooltip
				content=${disabledTooltip}
				?disabled=${this.canCommit || this.committing || !disabledTooltip}
				placement="bottom"
			>
				<span class="commit-btn-wrapper">
					<gl-button
						class="commit-btn"
						full
						?disabled=${!this.canCommit || this.committing}
						aria-busy=${this.committing ? 'true' : 'false'}
						variant=${this.amend ? 'warning' : nothing}
						tooltip=${this.canCommit && !this.committing ? enabledTooltip : ''}
						@click=${this.onCommit}
					>
						${this.committing
							? html`<code-icon icon="loading" modifier="spin" slot="prefix"></code-icon>Committing…`
							: html`${label}&nbsp;<gl-branch-name .name=${branch}></gl-branch-name>`}
					</gl-button>
				</span>
			</gl-tooltip>
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
			if (this.canCommit && !this.committing) {
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
		if (this.committing) return;

		this.dispatchEvent(new CustomEvent('commit', { bubbles: true, composed: true }));
	}

	private onGenerateMessage() {
		this.dispatchEvent(new CustomEvent('generate-message', { bubbles: true, composed: true }));
	}

	private onAddCoauthors() {
		if (this.committing) return;

		this.dispatchEvent(new CustomEvent('add-coauthors', { bubbles: true, composed: true }));
	}

	private onCompose() {
		this.dispatchEvent(new CustomEvent('compose', { bubbles: true, composed: true }));
	}
}

function getSigningFormatLabel(format: WipSigning['format']): string {
	switch (format) {
		case 'ssh':
			return 'SSH';
		case 'x509':
			return 'X.509';
		case 'openpgp':
			return 'OpenPGP';
		default:
			return 'GPG';
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-box': GlCommitBox;
	}
}
