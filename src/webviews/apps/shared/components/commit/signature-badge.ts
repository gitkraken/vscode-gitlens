import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import { getSignatureState } from './signature-badge.utils.js';
import '../code-icon.js';
import '../overlays/tooltip.js';

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
			color: var(--vscode-charts-green);
		}

		.badge--unknown {
			color: var(--color-foreground--65);
		}

		.badge--untrusted {
			color: var(--vscode-charts-red);
		}

		.tooltip-content {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
			padding: var(--sl-tooltip-padding);
		}

		.author-info {
			display: flex;
			gap: 0.625rem;
			align-items: center;
		}

		.author-avatar {
			width: 32px;
			height: 32px;
			border-radius: 8px;
			flex-shrink: 0;
		}

		.author-details {
			display: flex;
			flex-direction: column;
			gap: 0;
			min-width: 0;
			flex: 1;
			line-height: normal;
		}

		.author-name {
			font-weight: 500;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--vscode-foreground);
		}

		.author-email {
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
	authorName?: string;

	@property({ type: String })
	authorEmail?: string;

	@property({ type: String })
	authorAvatar?: string;

	@property({ type: String })
	committerEmail?: string;

	private getIcon(): string {
		const state = getSignatureState(this.signature, this.committerEmail);
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

		const state = getSignatureState(this.signature, this.committerEmail);
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

		const state = getSignatureState(this.signature, this.committerEmail);
		const icon = this.getIcon();

		return html`
			<gl-tooltip hoist>
				<span class="badge badge--${state}">
					<code-icon icon="${icon}"></code-icon>
				</span>
				<div slot="content" class="tooltip-content">
					${this.authorName
						? html`
								<div class="author-info">
									${this.authorAvatar
										? html`<img
												class="author-avatar"
												src="${this.authorAvatar}"
												alt="${this.authorName}"
											/>`
										: nothing}
									<div class="author-details">
										<div class="author-name">${this.authorName}</div>
										${this.authorEmail
											? html`<div class="author-email">${this.authorEmail}</div>`
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
