import type { TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { formatDate } from '@gitlens/utils/date.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import { messageHeadlineSplitterToken } from '../../../../commitDetails/protocol.js';
import '../code-icon.js';
import './signature-details.js';

export interface CompactCommitAuthor {
	name: string;
	email?: string;
	avatar?: string;
	date: Date;
}

export const commitPopoverStyles = css`
	.commit-popover-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 52rem;
		margin: var(--gl-space-6) var(--gl-space-2) var(--gl-space-2);
	}

	.commit-popover-content__header {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.commit-popover-content__info {
		display: flex;
		flex: 1;
		gap: 0.625rem;
		align-items: center;
		min-width: 0;
	}

	.commit-popover-content__avatar {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: var(--gl-radius-lg);
	}

	.commit-popover-content__details {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0;
		min-width: 0;
		line-height: normal;
	}

	.commit-popover-content__name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
		color: var(--vscode-foreground);
		white-space: nowrap;
	}

	.commit-popover-content__email {
		font-weight: 400;
		color: var(--vscode-descriptionForeground);
	}

	.commit-popover-content__email a {
		color: var(--color-link-foreground);
		text-decoration: none;
	}

	.commit-popover-content__date {
		flex-shrink: 0;
		font-size: var(--gl-font-micro);
		color: var(--color-foreground--50);
		white-space: nowrap;
	}

	.commit-popover-content__message {
		max-height: 10rem;
		overflow: auto;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--85);
		overflow-wrap: anywhere;
		white-space: pre-wrap;

		/* Auto-hide scrollbar: scrollableBase's ::-webkit-scrollbar-thumb inherits this element's
		   border-color, so transparent → hidden, revealed only while hovering the message itself.
		   NOT keyed on the host (:host(:hover)) — the popover is shown the whole time the row is
		   hovered, which would otherwise pin the scrollbar visible and never fade. */
		border-color: transparent;
		transition: border-color 1s linear;
	}

	.commit-popover-content__message:hover {
		border-color: var(--vscode-scrollbarSlider-background);
		transition: none;
	}

	.commit-popover-content__sha {
		display: inline-flex;
		gap: var(--gl-space-2);
		align-items: center;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.commit-popover-content__committer {
		display: flex;
		gap: 0.625rem;
		align-items: center;
		min-width: 0;
	}

	.commit-popover-content__committer-label {
		font-weight: 400;
		color: var(--vscode-descriptionForeground);
	}
`;

export function getCommitHeadline(message: string | undefined): string {
	const msg = message ?? '';
	const splitterIdx = msg.indexOf(messageHeadlineSplitterToken);
	if (splitterIdx >= 0) return msg.substring(0, splitterIdx);

	const newlineIdx = msg.indexOf('\n');
	return newlineIdx >= 0 ? msg.substring(0, newlineIdx) : msg;
}

export function getCommitFullMessage(message: string | undefined): string {
	return (message ?? '').replaceAll(messageHeadlineSplitterToken, '\n');
}

export function renderCommitPopoverContent(
	author: CompactCommitAuthor | undefined,
	message: string | undefined,
	shortSha: string | undefined,
	dateFormat?: string,
	signature?: CommitSignatureShape,
	committerEmail?: string,
	committer?: { name?: string; email?: string; avatarUrl?: string; date?: Date },
): TemplateResult | typeof nothing {
	if (!author) return nothing;

	const absoluteDate = formatDate(author.date, dateFormat ?? 'MMMM Do, YYYY h:mma');
	const fullMessage = getCommitFullMessage(message);

	return html`<div class="commit-popover-content">
		<div class="commit-popover-content__header">
			<div class="commit-popover-content__info">
				${author.avatar
					? html`<img class="commit-popover-content__avatar" src=${author.avatar} alt=${author.name} />`
					: nothing}
				<div class="commit-popover-content__details">
					<span class="commit-popover-content__name">${author.name}</span>
					${author.email
						? html`<span class="commit-popover-content__email"
								><a href="mailto:${author.email}">${author.email}</a></span
							>`
						: nothing}
				</div>
			</div>
			<span class="commit-popover-content__date">${absoluteDate}</span>
		</div>
		${committer != null && (committer.name || committer.email)
			? html`<div class="commit-popover-content__committer">
					<div class="commit-popover-content__info">
						${committer.avatarUrl
							? html`<img
									class="commit-popover-content__avatar"
									src=${committer.avatarUrl}
									alt=${committer.name ?? ''}
								/>`
							: nothing}
						<div class="commit-popover-content__details">
							<span class="commit-popover-content__name"
								>${committer.name || committer.email}
								<span class="commit-popover-content__committer-label">(committer)</span></span
							>
							${committer.email
								? html`<span class="commit-popover-content__email"
										><a href="mailto:${committer.email}">${committer.email}</a></span
									>`
								: nothing}
						</div>
					</div>
					${committer.date
						? html`<span class="commit-popover-content__date"
								>${formatDate(committer.date, dateFormat ?? 'MMMM Do, YYYY h:mma')}</span
							>`
						: nothing}
				</div>`
			: nothing}
		${shortSha
			? html`<span class="commit-popover-content__sha"
					><code-icon icon="git-commit"></code-icon>${shortSha}</span
				>`
			: nothing}
		${signature != null
			? html`<gl-signature-details
					.signature=${signature}
					.committerEmail=${committerEmail}
				></gl-signature-details>`
			: nothing}
		${fullMessage ? html`<div class="commit-popover-content__message">${fullMessage}</div>` : nothing}
	</div>`;
}
