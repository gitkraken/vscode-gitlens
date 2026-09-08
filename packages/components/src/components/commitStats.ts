import * as l10n from '@vscode/l10n';
import type { CSSResult, TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { localizedContent } from '../localizedContent.js';
import './codeIcon.js';
import './overlays/tooltip.js';

export interface CommitStatsData {
	files: number | { added: number; changed: number; deleted: number };
	additions?: number;
	deletions?: number;
}

/**
 * Renders a `<commit-stats symbol="icons">` element for the given commit stats, handling both
 * number-valued and `{ added, changed, deleted }` object-valued `stats.files`. Pass `includeLineStats`
 * to also surface additions/deletions. Returns `undefined` when there are no file stats to show.
 */
export function renderCommitStatsIcons(
	stats: CommitStatsData | undefined,
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
	static override styles: CSSResult = css`
		:host {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
			font-size: var(--gl-font-sm);
			font-weight: 600;
			white-space: nowrap;
		}

		:host([appearance='pill']) {
			min-height: var(--commit-stats-pill-line-height, 1.5rem);
			padding: var(--commit-stats-pill-padding, 0 0.8rem 0 0.6rem);
			line-height: var(--commit-stats-pill-line-height, 1.5rem);
			white-space: nowrap;
			background-color: var(
				--commit-stats-pill-background,
				color-mix(
					in srgb,
					var(--color-view-header-background, transparent) 90%,
					var(--color-foreground, currentColor) 10%
				)
			);
			border: var(--gl-border-width) solid color-mix(in srgb, transparent 80%, var(--color-foreground));
			border-radius: var(--gl-radius-sm);
		}

		.stat {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
		}

		.stat + .stat {
			margin-inline-start: var(--gl-space-10);
		}

		:host([symbol='icons']) .stat + .stat {
			margin-inline-start: var(--gl-space-8);
		}

		.added {
			color: var(--gl-stat-added);
		}

		.modified {
			color: var(--gl-stat-modified);
		}

		.removed {
			color: var(--gl-stat-removed);
		}

		.label {
			user-select: none;
		}

		/* In icons mode the icon renders INSIDE the label span, so it's inline-positioned — and neither
		   vertical-align: middle (~1px low) nor baseline (~1.5px high) actually centers the 1.1rem glyph
		   box in the line. Flexing the label centers it exactly, with no change to the label's own box. */
		:host([symbol='icons']) .label {
			display: inline-flex;
			align-items: center;
		}

		/* Box-centering isn't enough for add/remove: their ink rides half a pixel high inside the
		   codicon glyph's em box (edit's is centered), so they still sit optically high next to the
		   counts. Nudge just those glyphs — at the 1.1rem icon size this also moves their baseline
		   off the half-pixel that the odd-height glyph box lands it on. */
		:host([symbol='icons']) .icon[icon='add'],
		:host([symbol='icons']) .icon[icon='remove'] {
			transform: translateY(0.5px);
		}

		.icon {
			--code-icon-size: 1.1rem;
			--code-icon-v-align: middle;

			margin-inline-end: var(--gl-space-2);
			font-weight: 600;
		}

		/* Pill styles */
		:host([appearance='pill']) .stat {
			padding: 0;
		}

		:host([appearance='pill']) .stat + .stat {
			margin-inline-start: var(--gl-space-8);
		}

		:host([appearance='pill']) .icon {
			margin-inline-end: 0.3rem;
		}
	`;

	@property({ type: Number })
	added: number | undefined;

	@property({ type: Number })
	modified: number | undefined;

	@property({ type: Number })
	removed: number | undefined;

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
		if (this.noTooltip) return html`${stats}<slot></slot>`;

		return html`<gl-tooltip>
			${stats}<slot></slot>
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

		return html`<span
			class="stat ${key}"
			aria-label=${key === 'added' ? l10n.t('{0} added', count) : key === 'modified' ? l10n.t('{0} modified', count) : l10n.t('{0} removed', count)}
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
			parts.push(html`<span class="added">${l10n.t('{0} added', added)}</span>`);
		}
		if (modified > 0) {
			if (parts.length) {
				parts.push(', ');
			}
			parts.push(html`<span class="modified">${l10n.t('{0} modified', modified)}</span>`);
		}
		if (removed > 0) {
			if (parts.length) {
				parts.push(', ');
			}
			parts.push(html`<span class="removed">${l10n.t('{0} removed', removed)}</span>`);
		}

		const filesLine = hasBreakdown
			? localizedContent(
					totalFiles === 1
						? l10n.t('{count} file changed ({changes})')
						: l10n.t('{count} files changed ({changes})'),
					{ count: getNumericFormat()(totalFiles), changes: parts },
				)
			: totalFiles === 0
				? l10n.t('No files changed')
				: totalFiles === 1
					? l10n.t('{0} file changed', getNumericFormat()(totalFiles))
					: l10n.t('{0} files changed', getNumericFormat()(totalFiles));

		const lineParts: unknown[] = [];
		if (this.additions != null) {
			lineParts.push(
				html`<span class="added"
					>${this.additions === 1 ? l10n.t('{0} addition', getNumericFormat()(this.additions)) : l10n.t('{0} additions', getNumericFormat()(this.additions))}</span
				>`,
			);
		}
		if (this.deletions != null) {
			if (lineParts.length) {
				lineParts.push(', ');
			}
			lineParts.push(
				html`<span class="removed"
					>${this.deletions === 1 ? l10n.t('{0} deletion', getNumericFormat()(this.deletions)) : l10n.t('{0} deletions', getNumericFormat()(this.deletions))}</span
				>`,
			);
		}

		const rows = [html`<div>${filesLine}</div>`];
		if (lineParts.length > 0) {
			rows.push(html`<div>${lineParts}</div>`);
		}
		return rows;
	}
}
