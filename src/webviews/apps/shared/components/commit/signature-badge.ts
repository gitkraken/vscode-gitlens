import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import '../code-icon.js';
import '../overlays/tooltip.js';

type SignatureState = 'trusted' | 'unknown' | 'untrusted';

@customElement('gl-signature-badge')
export class GlSignatureBadge extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			margin-left: 0.5rem;
		}

		.badge {
			display: inline-flex;
			align-items: center;
		}

		.badge--trusted {
			color: var(--vscode-testing-iconPassed, #73c991);
		}

		.badge--unknown {
			color: var(--vscode-editorWarning-foreground, #cca700);
		}

		.badge--untrusted {
			color: var(--vscode-testing-iconFailed, #f14c4c);
		}

		.tooltip-content {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
			padding: var(--sl-tooltip-padding);
		}

		.committer-info {
			display: flex;
			gap: 0.625rem;
			align-items: center;
		}

		.committer-avatar {
			width: 32px;
			height: 32px;
			border-radius: 8px;
			flex-shrink: 0;
		}

		.committer-details {
			display: flex;
			flex-direction: column;
			gap: 0;
			min-width: 0;
			flex: 1;
			line-height: normal;
		}

		.committer-name {
			font-weight: 500;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--vscode-foreground);
		}

		.committer-email {
			font-weight: 400;
			color: var(--vscode-descriptionForeground);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.signature-details {
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
		}

		.signature-status {
			display: flex;
			gap: 0.25rem;
			align-items: flex-start;
		}

		.signature-status code-icon {
			flex-shrink: 0;
			font-size: 14px;
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

		.signature-key {
			color: var(--vscode-descriptionForeground);
			word-break: break-all;
			overflow-wrap: break-word;
		}
	`;

	@property({ type: Object })
	signature?: CommitSignatureShape;

	@property({ type: String })
	committerName?: string;

	@property({ type: String })
	committerEmail?: string;

	@property({ type: String })
	committerAvatar?: string;

	private getSignatureState(): SignatureState {
		if (this.signature == null) return 'unknown';

		const { status, trustLevel } = this.signature;

		// Bad signatures are always untrusted
		if (status === 'bad') {
			return 'untrusted';
		}

		// Good status with ultimate or full trust is trusted
		if (status === 'good' && (trustLevel === 'ultimate' || trustLevel === 'full')) {
			return 'trusted';
		}

		// Everything else is unknown
		return 'unknown';
	}

	private getIcon(): string {
		const state = this.getSignatureState();
		switch (state) {
			case 'trusted':
				return 'workspace-trusted';
			case 'untrusted':
				return 'workspace-untrusted';
			case 'unknown':
			default:
				return 'workspace-unknown';
		}
	}

	private getStatusText(): string {
		if (this.signature == null) return 'Unknown';

		const state = this.getSignatureState();
		switch (state) {
			case 'trusted':
				return 'Signature is valid and trusted';
			case 'untrusted':
				return this.getErrorStatusText();
			case 'unknown':
				return this.signature.status === 'good' ? 'Signature is valid but unknown' : this.getErrorStatusText();
		}
	}

	private getErrorStatusText(): string {
		switch (this.signature?.status) {
			case 'bad':
				return 'Signature is invalid';
			case 'expired':
				return 'Signature has expired';
			case 'revoked':
				return 'Signature key has been revoked';
			case 'error':
				return 'Signature verification error';
			case 'unknown':
				return 'Unknown signature';
			default:
				return 'Unknown signature';
		}
	}

	override render() {
		if (this.signature == null) return nothing;

		const state = this.getSignatureState();
		const icon = this.getIcon();

		return html`
			<gl-tooltip hoist>
				<span class="badge badge--${state}">
					<code-icon icon="${icon}"></code-icon>
				</span>
				<div slot="content" class="tooltip-content">
					${this.committerName
						? html`
								<div class="committer-info">
									${this.committerAvatar
										? html`<img
												class="committer-avatar"
												src="${this.committerAvatar}"
												alt="${this.committerName}"
											/>`
										: nothing}
									<div class="committer-details">
										<div class="committer-name">${this.committerName}</div>
										${this.committerEmail
											? html`<div class="committer-email">${this.committerEmail}</div>`
											: nothing}
									</div>
								</div>
							`
						: nothing}
					<div class="signature-details">
						<div class="signature-status">
							<code-icon class="badge--${state}" icon="${icon}"></code-icon>
							<div class="signature-status-text">
								<div class="signature-status-message">${this.getStatusText()}</div>
								${this.signature.keyId || this.signature.fingerprint
									? html`<div class="signature-key">
											${this.signature.keyId ?? this.signature.fingerprint}
										</div>`
									: nothing}
							</div>
						</div>
					</div>
				</div>
			</gl-tooltip>
		`;
	}
}
