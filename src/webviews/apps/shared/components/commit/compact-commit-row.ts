import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import type { CompactCommitAuthor } from './commit-popover-content.js';
import { commitPopoverStyles, getCommitHeadline, renderCommitPopoverContent } from './commit-popover-content.js';
import '../code-icon.js';
import '../overlays/popover.js';
import '../avatar/avatar.js';
import { scrollableBase } from '../styles/lit/base.css.js';

export type { CompactCommitAuthor } from './commit-popover-content.js';
export type CompactCommitRowVariant = 'avatar' | 'dot';
export type CompactCommitDotState = 'uncommitted' | 'unpushed' | 'pushed';

@customElement('gl-compact-commit-row')
export class GlCompactCommitRow extends LitElement {
	static override styles = [
		scrollableBase,
		commitPopoverStyles,
		css`
			:host {
				display: block;
			}

			.row {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				padding: 0.25rem 0;
				cursor: pointer;
				border-left: 2px solid transparent;
			}

			:host([selected]) .row {
				background: color-mix(in srgb, var(--vscode-charts-green, #4ec9b0) 8%, transparent);
				border-left-color: var(--vscode-charts-green, #4ec9b0);
			}

			.row:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex-shrink: 0;
			}

			.dot--uncommitted {
				background: var(--vscode-charts-yellow, #e2c07d);
			}

			.dot--unpushed {
				background: var(--vscode-charts-green, #4ec9b0);
			}

			.dot--pushed {
				background: var(--color-foreground--25, #666);
			}

			.headline {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				font-size: 1.2rem;
				color: var(--color-foreground--85);
			}

			.diff-stats {
				display: inline-flex;
				align-items: center;
				gap: 0.4rem;
				flex-shrink: 0;
				font-size: 1rem;
				font-family: var(--vscode-editor-font-family, monospace);
			}

			.diff-stats__added {
				color: var(--vscode-charts-green, #4ec9b0);
			}

			.diff-stats__deleted {
				color: var(--vscode-charts-red, #f14c4c);
			}

			.date {
				flex-shrink: 0;
				font-size: 1.1rem;
				color: var(--vscode-descriptionForeground, var(--color-foreground--50));
			}

			gl-avatar {
				flex-shrink: 0;
				--gl-avatar-size: 1.6rem;
			}
		`,
	];

	@property()
	sha?: string;

	@property({ attribute: 'short-sha' })
	shortSha?: string;

	@property()
	message?: string;

	@property({ attribute: false })
	author?: CompactCommitAuthor;

	@property({ reflect: true })
	variant: CompactCommitRowVariant = 'avatar';

	@property({ reflect: true, type: Boolean })
	selected = false;

	@property({ attribute: 'dot-state' })
	dotState?: CompactCommitDotState;

	@property({ type: Number })
	additions?: number;

	@property({ type: Number })
	deletions?: number;

	@property({ attribute: 'date-format' })
	dateFormat?: string;

	@property({ attribute: 'date-style' })
	dateStyle: 'relative' | 'absolute' = 'relative';

	override render() {
		return html`<gl-popover hoist placement="bottom" trigger="hover focus">
			<div
				slot="anchor"
				class="row"
				tabindex="0"
				role="option"
				aria-selected=${this.selected}
				@click=${this.handleClick}
			>
				${this.variant === 'avatar' ? this.renderAvatarLeading() : this.renderDotLeading()}
				<span class="headline">${getCommitHeadline(this.message)}</span>
				${this.renderDiffStats()} ${this.renderDate()}
				${this.variant === 'dot' ? this.renderAvatarTrailing() : nothing}
			</div>
			<div slot="content">
				${renderCommitPopoverContent(this.author, this.message, this.shortSha, this.dateFormat)}
			</div>
		</gl-popover>`;
	}

	private renderAvatarLeading() {
		if (!this.author?.avatar) return nothing;
		return html`<gl-avatar .src=${this.author.avatar} .name=${this.author.name}></gl-avatar>`;
	}

	private renderAvatarTrailing() {
		if (!this.author?.avatar) return nothing;
		return html`<gl-avatar .src=${this.author.avatar} .name=${this.author.name}></gl-avatar>`;
	}

	private renderDotLeading() {
		const state = this.dotState ?? 'pushed';
		return html`<span class="dot dot--${state}"></span>`;
	}

	private renderDiffStats() {
		if (this.additions == null && this.deletions == null) return nothing;
		return html`<span class="diff-stats">
			${this.additions != null && this.additions > 0
				? html`<span class="diff-stats__added">+${this.additions}</span>`
				: nothing}
			${this.deletions != null && this.deletions > 0
				? html`<span class="diff-stats__deleted">-${this.deletions}</span>`
				: nothing}
		</span>`;
	}

	private renderDate() {
		if (!this.author?.date) return nothing;
		const label =
			this.dateStyle === 'relative'
				? fromNow(this.author.date)
				: formatDate(this.author.date, this.dateFormat ?? 'MMMM Do, YYYY h:mma');
		return html`<span class="date">${label}</span>`;
	}

	private handleClick() {
		this.dispatchEvent(
			new CustomEvent('commit-select', {
				detail: { sha: this.sha },
				bubbles: true,
				composed: true,
			}),
		);
	}
}
