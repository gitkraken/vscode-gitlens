import * as l10n from '@vscode/l10n';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { isMac } from '@env/platform.js';
import { boxSizingBase, scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import type { WipSigning } from '../../../../plus/graph/detailsProtocol.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { GlMenuPopoverItem } from '../../../shared/components/menu/menu-popover.js';
import { splitButtonStyles } from '../../../shared/components/styles/lit/split-button.css.js';
import type { FixupTarget } from '../utils/fixup.utils.js';
import { commitBoxStyles } from './gl-commit-box.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/checkbox/checkbox.js';
import '@gitlens/components/components/codeIcon.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/menu/menu-popover.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';

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
	static override styles = [boxSizingBase, splitButtonStyles, commitBoxStyles, scrollableBase];

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

	@property({ type: Object })
	fixupTarget?: FixupTarget;

	@query('.textarea')
	private readonly _textareaEl?: HTMLTextAreaElement;

	/** Focuses the message textarea — used to focus a box a host action just seeded (e.g. Fixup
	 *  Commit, Undo Commit, Add Co-authors). Assumes the caller has already waited for this element
	 *  to be mounted (e.g. via `updateComplete`). */
	focusMessage(): void {
		this._textareaEl?.focus({ preventScroll: true });
	}

	override render() {
		return html`
			<div class="options">
				${this.renderAmendToggle()}
				<div class="options-group">
					${this.renderSigningIndicator()}
					${
						this.aiEnabled
							? html`<gl-button appearance="secondary" @click=${this.onCompose}>
									<code-icon class="compose-icon" icon="wand" slot="prefix"></code-icon>
									${l10n.t('Compose')}
								</gl-button>`
							: nothing
					}
				</div>
			</div>
			${this.renderTextarea()} ${this.renderActionBar()}
		`;
	}

	private renderSigningIndicator() {
		if (!this.signing?.enabled) return nothing;

		const label = l10n.t('Commits will be signed using {format}', {
			format: getSigningFormatLabel(this.signing.format),
		});
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
				${l10n.t('Amend Previous Commit')}
			</gl-checkbox>
		`;
	}

	private renderTextarea() {
		const firstLine = this.message.split('\n')[0] ?? '';
		const len = firstLine.length;
		const placeholder = isMac
			? l10n.t('Commit message (⌘Enter to commit)')
			: l10n.t('Commit message (Ctrl+Enter to commit)');

		return html`
			<div class="message">
				${
					this.aiEnabled
						? html`<svg class="working-ring" aria-hidden="true">
								<rect class="working-ring-base" pathLength="100"></rect>
								<rect class="working-ring-highlight" pathLength="100"></rect>
							</svg>`
						: nothing
				}
				<textarea
					class="textarea ${this.commitError ? 'has-error' : ''}"
					.value=${this.message}
					?disabled=${this.committing}
					aria-invalid=${this.commitError ? 'true' : 'false'}
					placeholder=${placeholder}
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
						tooltip=${l10n.t('Add Co-authors...')}
						aria-label=${l10n.t('Add Co-authors...')}
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
		const label = this.generating ? l10n.t('Cancel') : l10n.t('Generate Commit Message');
		// `gl-tooltip` is non-interactive (pointer-events: none), so use `gl-popover` to show
		// the current model as a clickable chip. `trigger="hover focus-visible"` (no `click`, and
		// `focus-visible` rather than `focus`) keeps the sparkle's own click firing generate without
		// showing the popover — the popover only opens on hover or keyboard focus, not click-induced focus.
		return html`
			<gl-popover placement="bottom" trigger="hover focus-visible">
				<gl-button
					slot="anchor"
					class="sparkle"
					appearance="toolbar"
					density="compact"
					aria-label=${label}
					aria-busy=${this.generating ? 'true' : 'false'}
					@click=${this.onGenerateMessage}
				>
					${
						this.generating
							? html`<code-icon icon="loading" modifier="spin"></code-icon>`
							: html`<code-icon icon="sparkle"></code-icon>`
					}
				</gl-button>
				<div slot="content" class="generate-popover">
					<span class="generate-popover__action">${label}</span>
					${
						!this.generating && this.aiModel != null
							? html`<gl-ai-model-chip .model=${this.aiModel}></gl-ai-model-chip>`
							: nothing
					}
				</div>
			</gl-popover>
		`;
	}

	private renderActionBar() {
		const branch = this.branchName;
		const enabledTooltip = this.amend
			? l10n.t('Amend Commit on {branch}', { branch: branch })
			: l10n.t('Commit to {branch}', { branch: branch });
		const disabledTooltip =
			this.disabledReason === 'no-message'
				? this.amend
					? l10n.t('Enter a commit message to amend commit on {branch}', { branch: branch })
					: l10n.t('Enter a commit message to commit to {branch}', { branch: branch })
				: this.disabledReason === 'no-staged'
					? this.amend
						? l10n.t('Stage changes above to amend commit on {branch}', { branch: branch })
						: l10n.t('Stage changes above to commit to {branch}', { branch: branch })
					: '';

		if (this.fixupTarget != null && !this.amend) {
			return this.renderFixupActionBar(disabledTooltip);
		}

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
						${
							this.committing
								? html`<code-icon icon="loading" modifier="spin" slot="prefix"></code-icon
										>${l10n.t('Committing…')}`
								: html`${localizedContent(
										this.amend
											? l10n.t('Amend Commit on\u00a0{branch}')
											: l10n.t('Commit to\u00a0{branch}'),
										{ branch: html`<gl-branch-name .name=${branch}></gl-branch-name>` },
									)}`
						}
					</gl-button>
				</span>
			</gl-tooltip>
		`;
	}

	private renderFixupActionBar(disabledTooltip: string) {
		const target = this.fixupTarget!;
		const disabled = !this.canCommit || this.committing;
		const enabledTooltip = l10n.t("Commits a fixup of '{subject}'", { subject: target.subject });
		const menuItems: GlMenuPopoverItem[] = [
			{ label: l10n.t('Commit Fixup & Squash'), value: 'squash', disabled: disabled },
		];

		return html`
			<gl-tooltip
				content=${disabledTooltip}
				?disabled=${this.canCommit || this.committing || !disabledTooltip}
				placement="bottom"
			>
				<span class="commit-btn-wrapper split-btn">
					<gl-button
						class="commit-btn split-btn__main"
						full
						?disabled=${disabled}
						aria-busy=${this.committing ? 'true' : 'false'}
						tooltip=${this.canCommit && !this.committing ? enabledTooltip : ''}
						@click=${this.onCommit}
					>
						${
							this.committing
								? html`<code-icon icon="loading" modifier="spin" slot="prefix"></code-icon
										>${l10n.t('Committing…')}`
								: html`${l10n.t('Commit Fixup')}`
						}
					</gl-button>
					<gl-menu-popover
						.items=${menuItems}
						?disabled=${disabled}
						@gl-menu-select=${this.onCommitSquashSelect}
					>
						<gl-button
							class="split-btn__menu"
							slot="anchor"
							aria-label=${l10n.t('Fixup Options')}
							?disabled=${disabled}
						>
							<code-icon icon="chevron-down"></code-icon>
						</gl-button>
					</gl-menu-popover>
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

	private onCommitSquashSelect(e: CustomEvent<{ value: string }>) {
		if (this.committing || e.detail.value !== 'squash') return;

		this.dispatchEvent(new CustomEvent('commit-squash', { bubbles: true, composed: true }));
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
