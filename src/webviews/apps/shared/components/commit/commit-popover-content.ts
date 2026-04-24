import type { TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { formatDate } from '@gitlens/utils/date.js';
import { messageHeadlineSplitterToken } from '../../../../commitDetails/protocol.js';
import '../code-icon.js';

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
		margin: 0.6rem 0.2rem 0.2rem 0.2rem;
		max-width: 52rem;
	}
	.commit-popover-content__header {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.commit-popover-content__info {
		display: flex;
		gap: 0.625rem;
		align-items: center;
		flex: 1;
		min-width: 0;
	}
	.commit-popover-content__avatar {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		flex-shrink: 0;
	}
	.commit-popover-content__details {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
		flex: 1;
		line-height: normal;
	}
	.commit-popover-content__name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--vscode-foreground);
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
		font-size: 1rem;
		color: var(--color-foreground--50);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.commit-popover-content__message {
		font-size: 1.1rem;
		color: var(--color-foreground--85);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 10rem;
		overflow: auto;
	}
	.commit-popover-content__sha {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 1.1rem;
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
		${shortSha
			? html`<span class="commit-popover-content__sha"
					><code-icon icon="git-commit"></code-icon>${shortSha}</span
				>`
			: nothing}
		${fullMessage ? html`<div class="commit-popover-content__message">${fullMessage}</div>` : nothing}
	</div>`;
}
