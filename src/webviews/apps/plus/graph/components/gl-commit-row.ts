import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Preferences } from '../../../../plus/graph/detailsProtocol.js';
import { getCommitHeadline } from '../../../shared/components/commit/commit-popover-content.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/formatted-date.js';

export interface CommitRowData {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	authorEmail?: string;
	avatarUrl?: string;
	date: string;
	additions?: number;
	deletions?: number;
}

@customElement('gl-commit-row')
export class GlCommitRow extends LitElement {
	static override styles = css`
		:host {
			display: block;
			width: 100%;
			min-width: 0;
		}

		.row {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			grid-template-areas:
				'avatar message'
				'avatar meta';
			column-gap: 0.6rem;
			row-gap: 0.1rem;
			min-width: 0;
			padding: 0.2rem 0;
			line-height: 1.35;
		}

		.avatar {
			grid-area: avatar;
			--gl-avatar-size: 2.4rem;
			align-self: center;
			flex-shrink: 0;
		}

		.avatar::part(avatar):hover {
			transform: none;
		}

		.msg {
			grid-area: message;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: var(--gl-font-base);
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.meta {
			grid-area: meta;
			display: inline-flex;
			align-items: center;
			gap: 0.6rem;
			min-width: 0;
			font-size: var(--gl-font-sm);
			color: var(--vscode-descriptionForeground, var(--color-foreground--50));
		}

		.sha {
			font-family: var(--vscode-editor-font-family, monospace);
			flex-shrink: 0;
		}

		.author {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.date {
			flex-shrink: 0;
		}

		/* Trailing group keeps the date and stats glued together at the row's right edge so the
		   row reads "sha · author … date stats" rather than letting each tail piece independently
		   absorb the remaining space (which would split them across the row). */
		.trailing {
			display: inline-flex;
			align-items: center;
			gap: 0.6rem;
			flex-shrink: 0;
		}

		/* When the host opts into right-aligned date layout (date-position="right"), the leading
		   dot is hidden and the trailing group is pushed to the far edge. Used by the multi-commit
		   pole-card and ahead/behind list. */
		:host([date-position='right']) .trailing {
			margin-left: auto;
		}

		:host([date-position='right']) .dot--before-date {
			display: none;
		}

		.stats {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			flex-shrink: 0;
			font-family: var(--vscode-editor-font-family, monospace);
		}

		.stats__added {
			color: var(--gl-tracking-ahead, #4ec9b0);
		}

		.stats__deleted {
			color: var(--vscode-charts-red, #f14c4c);
		}

		.dot {
			opacity: 0.6;
		}
	`;

	@property({ type: Object })
	commit?: CommitRowData;

	@property({ type: Object })
	preferences?: Preferences;

	/**
	 * Controls where the date renders within the meta row.
	 * - `right` (default): date is pushed to the far edge of the row, separator dot hidden,
	 *   so the row reads "sha · author … date". Used by the multi-commit pole-card and the
	 *   ahead/behind list — both consumers want a right-aligned timestamp.
	 * - `inline`: date follows the author with a leading separator dot for tighter rows.
	 */
	@property({ reflect: true, attribute: 'date-position' })
	datePosition: 'inline' | 'right' = 'right';

	override render(): unknown {
		const commit = this.commit;
		if (!commit) return nothing;

		const headline = getCommitHeadline(commit.message);

		return html`<div class="row">
			${commit.avatarUrl ? html`<gl-avatar class="avatar" .src=${commit.avatarUrl}></gl-avatar>` : nothing}
			<span class="msg">${headline}</span>
			<span class="meta">
				<span class="sha">${commit.shortSha}</span>
				<span class="dot" aria-hidden="true">·</span>
				<span class="author">${commit.author}</span>
				<span class="trailing">
					<span class="dot dot--before-date" aria-hidden="true">·</span>
					<formatted-date
						class="date"
						.date=${new Date(commit.date)}
						.format=${this.preferences?.dateFormat}
						.dateStyle=${this.preferences?.dateStyle ?? 'relative'}
					></formatted-date>
					${this.renderStats(commit)}
				</span>
			</span>
		</div>`;
	}

	private renderStats(commit: CommitRowData) {
		if (!commit.additions && !commit.deletions) return nothing;
		return html`<span class="stats">
			${commit.additions ? html`<span class="stats__added">+${commit.additions}</span>` : nothing}
			${commit.deletions ? html`<span class="stats__deleted">-${commit.deletions}</span>` : nothing}
		</span>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-row': GlCommitRow;
	}
}
