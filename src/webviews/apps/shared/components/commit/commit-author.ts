import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import { dateConverter } from '../converters/date-converter.js';
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
			width: var(--gl-avatar-size, 1.8rem);
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
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.date {
			font-size: 1.1rem;
			color: var(--vscode-descriptionForeground, var(--color-foreground--50));
			line-height: 1.4;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		:host([layout='stacked']) {
			display: inline-flex;
		}

		:host([layout='stacked']) .author {
			flex-wrap: wrap;
		}

		:host([layout='stacked']) .name-group {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-width: 0;
			gap: 0.1rem;
		}

		gl-signature-badge {
			margin-left: 0.4rem;
			vertical-align: middle;
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

		.popover-dates {
			display: flex;
			flex-direction: column;
			gap: 0;
			font-size: 1.15rem;
			color: var(--vscode-descriptionForeground);
		}

		.popover-date {
			white-space: nowrap;
		}

		.avatar-with-overlay {
			position: relative;
			display: inline-block;
			width: var(--gl-avatar-size, 1.8rem);
			height: var(--gl-avatar-size, 1.8rem);
		}

		.avatar-with-overlay .thumb {
			width: 100%;
			height: 100%;
		}

		.thumb-overlay {
			position: absolute;
			bottom: -2px;
			right: -2px;
			width: 45%;
			height: 45%;
			border-radius: 50%;
			border: 1.5px solid var(--vscode-sideBar-background, var(--color-background));
			object-fit: cover;
		}

		.thumb-overlay--icon {
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: var(--vscode-sideBar-background, var(--color-background));
			color: var(--vscode-descriptionForeground);
		}

		.committer-label {
			font-weight: 400;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}
	`;

	@property()
	avatarUrl = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@property()
	committerEmail?: string;

	@property()
	committerAvatarUrl?: string;

	@property()
	committerName?: string;

	@property()
	email?: string;

	@property()
	name = '';

	/** Raw (unformatted) author name for comparison with committer. Falls back to `name` if not set. */
	@property({ attribute: 'author-name' })
	authorName?: string;

	@property({ type: Boolean, attribute: 'show-avatar', reflect: true })
	showAvatar = false;

	@property({ type: Boolean, attribute: 'show-signature', reflect: true })
	showSignature = true;

	@property({ type: Object })
	signature?: CommitSignatureShape;

	@property({ reflect: true })
	layout?: 'stacked';

	@property({ converter: dateConverter() })
	authorDate?: Date;

	@property({ converter: dateConverter() })
	committerDate?: Date;

	@property()
	dateFormat?: string;

	@property()
	dateStyle: 'relative' | 'absolute' = 'relative';

	private formatDateLabel(date: Date): string {
		return this.dateStyle === 'relative'
			? fromNow(date)
			: formatDate(date, this.dateFormat ?? 'MMMM Do, YYYY h:mma');
	}

	private formatDateFull(date: Date): string {
		return formatDate(date, this.dateFormat ?? 'MMMM Do, YYYY h:mma');
	}

	private get hasDistinctCommitter(): boolean {
		const authorName = this.authorName ?? this.name;
		return (
			(this.committerName != null && this.committerName !== authorName) ||
			(this.committerEmail != null && this.committerEmail?.toLowerCase() !== this.email?.toLowerCase())
		);
	}

	private renderAvatar() {
		if (this.showAvatar && this.avatarUrl?.length) {
			if (this.hasDistinctCommitter) {
				return html`<span class="avatar-with-overlay">
					<img class="thumb" src="${this.avatarUrl}" alt="${this.name}" />
					${this.committerAvatarUrl?.length
						? html`<img
								class="thumb-overlay"
								src="${this.committerAvatarUrl}"
								alt="${this.committerName ?? ''}"
							/>`
						: html`<code-icon
								class="thumb-overlay thumb-overlay--icon"
								icon="person"
								size="10"
							></code-icon>`}
				</span>`;
			}
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
		const hasDates = this.authorDate != null || this.committerDate != null;
		const datesMatch =
			this.authorDate != null &&
			this.committerDate != null &&
			Math.abs(this.authorDate.getTime() - this.committerDate.getTime()) < 30_000;
		const hasSignature = this.signature != null && this.showSignature;

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
				${this.hasDistinctCommitter
					? html`<div class="author-info">
							${this.committerAvatarUrl?.length
								? html`<img
										class="author-avatar"
										src="${this.committerAvatarUrl}"
										alt="${this.committerName}"
									/>`
								: nothing}
							<div class="author-details">
								<div class="author-name-text">
									${this.committerName}
									<span class="committer-label">(committer)</span>
								</div>
								${this.committerEmail
									? html`<span class="author-email"
											><a href="mailto:${this.committerEmail}">${this.committerEmail}</a></span
										>`
									: nothing}
							</div>
						</div>`
					: nothing}
				${hasSignature
					? html`<gl-signature-details
							.signature=${this.signature}
							.committerEmail=${this.committerEmail}
						></gl-signature-details>`
					: nothing}
				${hasDates
					? html`<div class="popover-dates">
							${datesMatch
								? html`<span class="popover-date"
										>${fromNow(this.committerDate!)}
										(${this.formatDateFull(this.committerDate!)})</span
									>`
								: html`${this.authorDate
										? html`<span class="popover-date"
												>Authored ${fromNow(this.authorDate)}
												(${this.formatDateFull(this.authorDate)})</span
											>`
										: nothing}
									${this.committerDate
										? html`<span class="popover-date"
												>Committed ${fromNow(this.committerDate)}
												(${this.formatDateFull(this.committerDate)})</span
											>`
										: nothing}`}
						</div>`
					: nothing}
			</div>
		`;
	}

	override render(): unknown {
		const dateLabel = this.authorDate ? this.formatDateLabel(this.authorDate) : undefined;

		return html`
			<gl-popover hoist placement="bottom" trigger="hover click focus">
				<span slot="anchor" class="author" tabindex="0"
					><span class="avatar">${this.renderAvatar()}</span>${this.layout === 'stacked'
						? html`<span class="name-group"
								><span class="name">${this.name}${this.renderSignatureBadge()}</span>${dateLabel
									? html`<span class="date">${dateLabel}</span>`
									: nothing}</span
							>`
						: html`<span class="name">${this.name}</span>${this.renderSignatureBadge()}`}</span
				>
				<div slot="content">${this.renderPopoverContent()}</div>
			</gl-popover>
		`;
	}
}
