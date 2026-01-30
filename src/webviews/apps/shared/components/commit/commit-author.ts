import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import '../code-icon.js';
import '../overlays/popover.js';
import './signature-badge.js';
import './signature-details.js';

@customElement('gl-commit-author')
export class GlCommitAuthor extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		* {
			box-sizing: border-box;
		}

		.author {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0 0.6rem;
			border-radius: 0.3rem;
			cursor: pointer;

			&:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}
		}

		a {
			color: var(--color-link-foreground);
			text-decoration: none;
		}

		.author-hover {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.6rem;
			margin: 0.6rem 0.2rem 0.2rem 0.2rem;
		}

		.author-hover img {
			max-width: 64px;
		}

		.avatar {
			width: 1.8rem;
		}

		.thumb {
			width: 100%;
			height: auto;
			vertical-align: middle;
			border-radius: 0.4rem;
		}

		.name {
			flex: 1;
			font-size: 1.3rem;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		gl-signature-badge {
			margin-left: 0.4rem;
		}

		.popover-content {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
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

		.author-name-text {
			font-weight: 500;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--vscode-foreground);
		}

		.author-email {
			font-weight: 400;
			color: var(--vscode-descriptionForeground);

			a {
				display: inline-block;
				max-width: 100%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				vertical-align: bottom;
			}

			a:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}
		}
	`;

	@property()
	avatarUrl = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@property()
	committerEmail?: string;

	@property()
	email?: string;

	@property()
	name = '';

	@property({ type: Boolean, attribute: 'show-avatar', reflect: true })
	showAvatar = false;

	@property({ type: Boolean, attribute: 'show-signature', reflect: true })
	showSignature = true;

	@property({ type: Object })
	signature?: CommitSignatureShape;

	private renderAvatar() {
		if (this.showAvatar && this.avatarUrl?.length) {
			return html`<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />`;
		}
		return html`<code-icon icon="person" size="18"></code-icon>`;
	}

	private renderSignatureBadge() {
		if (this.signature == null || !this.showSignature) return nothing;

		return html`<gl-signature-badge
			.signature=${this.signature}
			.committerEmail=${this.committerEmail}
		></gl-signature-badge>`;
	}

	private renderPopoverContent() {
		return html`
			<div class="popover-content">
				<div class="author-info">
					${this.avatarUrl?.length
						? html`<img class="author-avatar" src="${this.avatarUrl}" alt="${this.name}" />`
						: nothing}
					<div class="author-details">
						<div class="author-name-text">${this.name}</div>
						${this.email
							? html`<span class="author-email"><a href="mailto:${this.email}">${this.email}</a></span>`
							: nothing}
					</div>
				</div>
				${this.signature && this.showSignature
					? html`<gl-signature-details
							.signature=${this.signature}
							.committerEmail=${this.committerEmail}
						></gl-signature-details>`
					: nothing}
			</div>
		`;
	}

	override render(): unknown {
		return html`
			<gl-popover hoist placement="bottom" trigger="hover click focus">
				<span slot="anchor" class="author" tabindex="0"
					><span class="avatar">${this.renderAvatar()}</span
					><span class="name">${this.name}</span>${this.renderSignatureBadge()}</span
				>
				<div slot="content">${this.renderPopoverContent()}</div>
			</gl-popover>
		`;
	}
}
