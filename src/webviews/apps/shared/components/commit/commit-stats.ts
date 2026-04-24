import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import { pluralize } from '@gitlens/utils/string';
import '../code-icon.js';
import '../overlays/tooltip.js';

/**
 * Renders a `<commit-stats symbol="icons">` element for the given commit stats, handling both
 * number-valued and `{ added, changed, deleted }` object-valued `stats.files`. Pass `includeLineStats`
 * to also surface additions/deletions. Returns `undefined` when there are no file stats to show.
 */
export function renderCommitStatsIcons(
	stats: GitCommitStats | undefined,
	options?: { includeLineStats?: boolean },
): TemplateResult | undefined {
	if (stats?.files == null) return undefined;

	const additions = options?.includeLineStats ? (stats.additions ?? nothing) : nothing;
	const deletions = options?.includeLineStats ? (stats.deletions ?? nothing) : nothing;

	if (typeof stats.files === 'number') {
		return html`<commit-stats
			modified="${stats.files}"
			additions="${additions}"
			deletions="${deletions}"
			symbol="icons"
		></commit-stats>`;
	}

	const { added, deleted, changed } = stats.files;
	return html`<commit-stats
		added="${added}"
		modified="${changed}"
		removed="${deleted}"
		additions="${additions}"
		deletions="${deletions}"
		symbol="icons"
	></commit-stats>`;
}

const statToSymbol: readonly ['added' | 'modified' | 'removed', [string, string]][] = Object.freeze([
	['added', ['+', 'add']],
	['modified', ['~', 'edit']],
	['removed', ['-', 'remove']],
]);

@customElement('commit-stats')
export class CommitStats extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
			white-space: nowrap;
			font-size: 1.1rem;
		}

		:host([appearance='pill']) {
			background-color: color-mix(
				in srgb,
				var(--vscode-sideBarSectionHeader-background) 90%,
				var(--vscode-foreground) 10%
			);
			border: 1px solid
				color-mix(in srgb, var(--vscode-sideBarSectionHeader-border) 100%, var(--vscode-foreground) 70%);
			border-radius: 0.4rem;
			padding: 0 0.8rem 0 0.6rem;
			white-space: nowrap;
			line-height: 1.5rem;
		}

		.stat {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
		}

		.stat + .stat {
			margin-inline-start: 1rem;
		}

		:host([symbol='icons']) .stat + .stat {
			margin-inline-start: 0.8rem;
		}

		.added {
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}
		.modified {
			color: var(--vscode-gitDecoration-modifiedResourceForeground);
		}
		.removed {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.label {
			user-select: none;
		}

		.icon {
			--code-icon-size: 1.1rem;
			--code-icon-v-align: middle;
			margin-inline-end: 0.2rem;
		}

		/* Pill styles */
		:host([appearance='pill']) .stat {
			padding: 0;
		}

		:host([appearance='pill']) .stat + .stat {
			margin-inline-start: 0.8rem;
		}

		:host([appearance='pill']) .icon {
			margin-inline-end: 0.3rem;
		}
	`;

	@property({ type: Number })
	added: number | undefined = 0;

	@property({ type: Number })
	modified: number | undefined = 0;

	@property({ type: Number })
	removed: number | undefined = 0;

	@property({ type: Number })
	additions: number | undefined;

	@property({ type: Number })
	deletions: number | undefined;

	@property()
	symbol?: 'icons';

	@property({ reflect: true })
	appearance?: 'pill';

	@property({ type: Boolean, attribute: 'no-tooltip' })
	noTooltip = false;

	override render(): unknown {
		const stats = statToSymbol.map(([key, value]) => this.renderStat(key, value));
		if (this.noTooltip) return stats;

		return html`<gl-tooltip>
			${stats}
			<div slot="content">${this.renderTooltipContent()}</div>
		</gl-tooltip>`;
	}

	private renderStat(key: string, value: [string, string]) {
		const count = this[key as keyof CommitStats] as number | undefined;
		if (count == null) return nothing;

		const [symbol, icon] = value;
		const glyph =
			this.symbol === 'icons'
				? html`<code-icon class="icon" icon=${icon}></code-icon>`
				: html`<span class="symbol">${symbol}</span>`;

		return html`<span class="stat ${key}" aria-label="${count} ${key}"
			><span class="label">${glyph}${count}</span></span
		>`;
	}

	private renderTooltipContent() {
		const added = this.added ?? 0;
		const modified = this.modified ?? 0;
		const removed = this.removed ?? 0;
		const totalFiles = added + modified + removed;
		const hasBreakdown = added > 0 || removed > 0;

		const parts: unknown[] = [];
		if (added > 0) {
			parts.push(html`<span class="added">${added} added</span>`);
		}
		if (modified > 0) {
			if (parts.length) {
				parts.push(', ');
			}
			parts.push(html`<span class="modified">${modified} modified</span>`);
		}
		if (removed > 0) {
			if (parts.length) {
				parts.push(', ');
			}
			parts.push(html`<span class="removed">${removed} removed</span>`);
		}

		const filesLine = hasBreakdown
			? html`${pluralize('file', totalFiles)} changed (${parts})`
			: pluralize('file changed', totalFiles, { plural: 'files changed', zero: 'No files changed' });

		const lineParts: unknown[] = [];
		if (this.additions != null) {
			lineParts.push(html`<span class="added">${pluralize('addition', this.additions)}</span>`);
		}
		if (this.deletions != null) {
			if (lineParts.length) {
				lineParts.push(', ');
			}
			lineParts.push(html`<span class="removed">${pluralize('deletion', this.deletions)}</span>`);
		}

		const rows = [html`<div>${filesLine}</div>`];
		if (lineParts.length > 0) {
			rows.push(html`<div>${lineParts}</div>`);
		}
		return rows;
	}
}
