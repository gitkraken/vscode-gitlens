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
		max-width: 52rem;
		margin: 0.6rem 0.2rem 0.2rem;
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
		font-size: 1rem;
		color: var(--color-foreground--50);
		white-space: nowrap;
	}

	.commit-popover-content__message {
		max-height: 10rem;
		overflow: auto;
		font-size: 1.1rem;
		color: var(--color-foreground--85);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.commit-popover-content:hover .scrollable,
	.commit-popover-content:focus-within .scrollable {
		border-color: var(--vscode-scrollbarSlider-background);
		transition: none;
	}

	.commit-popover-content__sha {
		display: inline-flex;
		gap: 0.2rem;
		align-items: center;
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
		${fullMessage ? html`<div class="commit-popover-content__message scrollable">${fullMessage}</div>` : nothing}
	</div>`;
}
