import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import { getSignatureStatusInfo } from './signature.utils.js';
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
			flex-direction: column;
			gap: 0.25rem;
			flex: 1;
			font-weight: 400;
		}

		.signature-status-message {
			color: var(--vscode-foreground);
		}

		.signature-status-description {
			color: var(--vscode-descriptionForeground);
			margin-left: 0.8rem;
			text-transform: lowercase;
			font-variant: small-caps;
		}

		.signature-status-detail {
			color: var(--vscode-descriptionForeground);
		}

		.signature-key {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		.signature-key-label {
			flex-shrink: 0;
		}

		.signature-key-value {
			word-break: break-all;
			overflow-wrap: break-word;
		}

		gl-copy-container {
			margin-left: auto;
			flex-shrink: 0;
		}

		gl-copy-container code-icon {
			color: var(--vscode-descriptionForeground);
		}

		gl-copy-container:hover code-icon {
			color: var(--vscode-foreground);
		}
	`;

	@property({ type: String })
	committerEmail?: string;

	@property({ type: Object })
	signature?: CommitSignatureShape;

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
						${this.renderKeyLine()}
					</div>
				</div>
			</div>
		`;
	}
}
