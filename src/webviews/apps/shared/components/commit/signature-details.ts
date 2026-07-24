import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import { getSignatureState, getSignatureStatusInfo } from './signature.utils.js';
import '../code-icon.js';
import '../copy-container.js';
import './signature-badge.js';

@customElement('gl-signature-details')
export class GlSignatureDetails extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		.signature-details {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}

		.signature-status {
			display: flex;
			gap: 0.5rem;
			align-items: flex-start;
		}

		.signature-status gl-signature-badge {
			flex-shrink: 0;
		}

		.signature-status-text {
			display: flex;
			flex: 1;
			flex-direction: column;
			gap: 0.25rem;
			font-weight: 400;
		}

		.signature-status-message {
			color: var(--vscode-foreground);
		}

		.signature-status-description {
			margin-left: var(--gl-space-8);
			font-variant: small-caps;
			color: var(--vscode-descriptionForeground);
			text-transform: lowercase;
		}

		.signature-status-detail {
			color: var(--vscode-descriptionForeground);
		}

		.signature-key {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.signature-key-label {
			flex-shrink: 0;
		}

		.signature-key-value {
			word-break: break-all;
			overflow-wrap: break-word;
		}

		gl-copy-container {
			flex-shrink: 0;
			margin-left: auto;
		}

		gl-copy-container code-icon {
			color: var(--vscode-descriptionForeground);
		}

		gl-copy-container:hover code-icon {
			color: var(--vscode-foreground);
		}

		.signature-action {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			width: fit-content;
			margin-top: 0.15rem;
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}

		.signature-action:hover {
			color: var(--vscode-textLink-activeForeground);
		}

		/* Only underline the text label on hover, not the leading icon. */
		.signature-action:hover .signature-action-label {
			text-decoration: underline;
		}
	`;

	@property({ type: String })
	committerEmail?: string;

	@property({ type: Object })
	signature?: CommitSignatureShape;

	/** When set, an unverified SSH signature offers a link to add the signer to the repo's `allowed_signers` file. */
	@property({ type: String })
	repoPath?: string;

	private getFormatLabel(format: string | undefined): string {
		switch (format) {
			case 'gpg':
			case 'openpgp':
				return 'GPG';
			case 'ssh':
				return 'SSH';
			case 'x509':
				return 'X.509';
			default:
				return '';
		}
	}

	private renderKeyLine() {
		const { keyId, fingerprint, format } = this.signature ?? {};
		if (!keyId && !fingerprint) return nothing;

		// Prefer fingerprint for display, with appropriate label
		const hasFingerprint = Boolean(fingerprint);
		const keyValue = fingerprint ?? keyId;
		const formatLabel = this.getFormatLabel(format);
		const keyTypeLabel = hasFingerprint ? 'Fingerprint' : 'Key ID';
		const label = formatLabel ? `${formatLabel} ${keyTypeLabel}:` : `${keyTypeLabel}:`;

		return html`
			<div class="signature-key">
				<span class="signature-key-label">${label}</span>
				<span class="signature-key-value">${keyValue}</span>
				<gl-copy-container tabindex="0" .content=${keyValue} copyLabel="Copy ${keyTypeLabel}">
					<code-icon icon="copy"></code-icon>
				</gl-copy-container>
			</div>
		`;
	}

	private renderAddAction() {
		// Only offer to trust the signer for an SSH signature that isn't verified yet (not trusted, not tampered),
		// and only when a repo is known so the editor can be scoped to it.
		if (this.repoPath == null || this.signature?.format !== 'ssh') return nothing;
		if (getSignatureState(this.signature, this.committerEmail) !== 'unknown') return nothing;

		// Pass this commit's signer fingerprint so the editor pre-checks only that signer (not every discovered one).
		const args = encodeURIComponent(JSON.stringify([null, this.repoPath, this.signature.fingerprint]));
		return html`
			<a
				class="signature-action"
				href="command:gitlens.git.editAllowedSigners?${args}"
				title="Open the SSH Allowed Signers editor"
			>
				<code-icon icon="key"></code-icon><span class="signature-action-label">Add to allowed signers…</span>
			</a>
		`;
	}

	override render() {
		if (this.signature == null) return nothing;

		const info = getSignatureStatusInfo(this.signature, this.committerEmail);
		return html`
			<div class="signature-details">
				<div class="signature-status">
					<gl-signature-badge
						.signature=${this.signature}
						.committerEmail=${this.committerEmail}
					></gl-signature-badge>
					<div class="signature-status-text">
						<div class="signature-status-message">
							${info.text}${info.description
								? html`<span class="signature-status-description">${info.description}</span>`
								: nothing}
						</div>
						${info.detail ? html`<div class="signature-status-detail">${info.detail}</div>` : nothing}
						${this.renderKeyLine()} ${this.renderAddAction()}
					</div>
				</div>
			</div>
		`;
	}
}
