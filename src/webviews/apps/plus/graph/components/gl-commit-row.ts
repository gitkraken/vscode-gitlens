import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
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
	/** Committer identity — avatar overlaid on the author's bottom-right + shown in the hover card;
	 *  set only when the committer differs from the author (mirrors gl-commit-author's convention). */
	committerAvatarUrl?: string;
	committerName?: string;
	committerEmail?: string;
	committerDate?: string;
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
			grid-template-areas:
				'avatar message'
				'avatar meta';
			grid-template-columns: auto minmax(0, 1fr);
			gap: 0.1rem 0.6rem;
			min-width: 0;
			padding: var(--gl-space-2) 0;
			line-height: 1.35;
		}

		/* WIP rows have no meta line — collapse the grid to a single row so the message centers. */
		.row--wip {
			grid-template-areas: 'avatar message';
		}

		.avatar {
			position: relative;
			flex-shrink: 0;
			grid-area: avatar;
			align-self: center;
			--gl-avatar-size: 2.4rem;

			width: var(--gl-avatar-size);
			height: var(--gl-avatar-size);
			/* collapse the inline-block baseline gap so the wrapper hugs the avatar exactly */
			line-height: 0;
		}

		.avatar__author::part(avatar):hover {
			transform: none;
		}

		/* Committer avatar overlaid on the author's bottom-right (mirrors gl-commit-author) — the host
	   only provides committerAvatarUrl when the committer differs from the author. */
		.avatar__committer {
			position: absolute;
			right: -0.2rem;
			bottom: -0.2rem;
			width: 45%;
			height: 45%;
			object-fit: cover;
			border: 0.15rem solid var(--vscode-sideBar-background, var(--color-background));
			border-radius: 50%;
		}

		.msg {
			grid-area: message;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: var(--gl-font-base);
			font-weight: 500;
			color: var(--vscode-foreground);
			white-space: nowrap;
		}

		.meta {
			display: inline-flex;
			grid-area: meta;
			gap: var(--gl-space-6);
			align-items: center;
			min-width: 0;
			font-size: var(--gl-font-sm);
			color: var(--vscode-descriptionForeground, var(--color-foreground--50));
		}

		.sha {
			flex-shrink: 0;
			font-family: var(--vscode-editor-font-family, monospace);
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
			flex-shrink: 0;
			gap: var(--gl-space-6);
			align-items: center;
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
			flex-shrink: 0;
			gap: var(--gl-space-4);
			align-items: center;
			font-family: var(--vscode-editor-font-family, monospace);
		}

		.stats__added {
			color: var(--gl-stat-added);
		}

		.stats__deleted {
			color: var(--gl-stat-removed);
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
		// WIP rows have no author/sha/date to show; suppress the meta line so the row is a single
		// line of just the working-tree label, instead of a stacked "Working Tree Changes" / "WIP".
		const isWip = commit.sha === uncommitted;

		return html`<div class="row ${isWip ? 'row--wip' : ''}">
			${commit.avatarUrl
				? html`<span class="avatar">
						<gl-avatar class="avatar__author" .src=${commit.avatarUrl}></gl-avatar>
						${commit.committerAvatarUrl
							? html`<img class="avatar__committer" src=${commit.committerAvatarUrl} alt="" />`
							: nothing}
					</span>`
				: nothing}
			<span class="msg">${headline}</span>
			${isWip
				? nothing
				: html`<span class="meta">
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
					</span>`}
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
