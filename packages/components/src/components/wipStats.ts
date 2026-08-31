import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { PausedOperationStatus } from '@gitlens/utils/pausedOperation.js';
import {
	getPausedOperationVariant,
	pausedOperationStatusStringsByType,
	pausedOperationVariantIcons,
} from '@gitlens/utils/pausedOperation.js';
import { pluralize } from '@gitlens/utils/string.js';
import './codeIcon.js';
import './commitStats.js';
import './overlays/tooltip.js';
import { baseStyles as pillStyles } from './pills/pill.css.js';

/** Builds the "X files added, Y files changed, Z files deleted" parts for the working-tree
 *  tooltip. Returns an empty array when no field is non-zero so the caller can fall back to the
 *  generic dirty message. Shared by the graph overview card, the Home branch card, and the
 *  `gl-wip-stats` badge tooltip so all three surfaces agree on phrasing. */
export function getWipTooltipParts(workingTreeState: {
	added: number | undefined;
	changed: number | undefined;
	deleted: number | undefined;
}): string[] {
	const parts: string[] = [];
	if (workingTreeState.added) {
		parts.push(`${pluralize('file', workingTreeState.added)} added`);
	}
	if (workingTreeState.changed) {
		parts.push(`${pluralize('file', workingTreeState.changed)} changed`);
	}
	if (workingTreeState.deleted) {
		parts.push(`${pluralize('file', workingTreeState.deleted)} deleted`);
	}
	return parts;
}

@customElement('gl-wip-stats')
export class GlWipStats extends LitElement {
	static override styles = [
		pillStyles,
		css`
			:host {
				display: contents;
			}

			.wip-clean-check {
				--code-icon-size: 1.1rem;
				--code-icon-v-align: middle;

				color: var(--gl-stat-added);
				/* Same half-pixel-high ink bias the add/remove glyphs carry (see commit-stats.ts) —
				   the check's ink hangs above its baseline, so drop it onto the optical center. */
				transform: translateY(0.5px);
			}

			.indicator-pill {
				--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
			}

			.indicator-pill.pill {
				gap: var(--gl-space-2);
				text-transform: none;
				user-select: none;
			}

			.indicator-pill.pill code-icon {
				font-size: inherit !important;
				font-weight: inherit !important;
				line-height: inherit !important;
			}

			.wip__tooltip {
				display: contents;
				vertical-align: middle;
			}

			/* Leading icon inside the pill capsule (icon attribute) — order: -1 puts it ahead of
			   commit-stats' own .stat spans in its flex layout even though it's a LATER slotted child
			   there (DOM order alone would land it after them; see commit-stats.ts's render, which
			   places the stats before the slot). Muted: it names the surface (a worktree), not a count,
			   so it should read as secondary to the stats/check it sits beside. */
			.wip-leading-icon {
				order: -1;
				margin-inline-end: var(--gl-space-4);
				color: var(--color-foreground--50, currentcolor);
				/* Same size the graph's ref pills give their leading glyph (.gl-graph__ref-pill-icon),
				   so the worktree mark reads as one vocabulary across the pill kinds; the SAME vertical
				   alignment as commit-stats' own .icon rule, or this glyph rides the baseline while the
				   +/~/- icons sit on middle and the pill's contents look staggered. */
				--code-icon-size: 1.2rem;
				--code-icon-v-align: middle;
			}

			.paused-op-badge {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: 0.1rem 0.4rem;
				font-size: var(--gl-font-sm);
				font-weight: 600;
				line-height: 2rem;
				color: var(--wip-stats-operation-foreground, #000);
				white-space: nowrap;
				background-color: var(--wip-stats-operation-background, #d29922);
				border-radius: var(--gl-radius-sm);
			}

			.paused-op-badge--conflicts {
				color: #fff;
				background-color: var(--wip-stats-operation-conflict-background, #f85149);
			}

			.paused-op-badge--ready {
				color: var(--wip-stats-operation-ready-foreground, #06150a);
				background-color: var(--wip-stats-operation-ready-background, #3fb950);
			}
		`,
	];

	@property({ type: Number }) added: number | undefined;
	@property({ type: Number }) modified: number | undefined;
	@property({ type: Number }) removed: number | undefined;

	@property({ type: Boolean }) dirty?: boolean;

	@property({ type: Boolean, attribute: 'show-clean' }) showClean = false;
	@property({ type: Boolean }) badge = false;
	@property({ type: Boolean, attribute: 'no-tooltip' }) noTooltip = false;
	/** Optional leading icon (a codicon/gl-icon name) rendered inside the pill capsule for the dirty and
	 *  clean states — additive, and unused by every caller but the graph's WIP-row adornment. Badge and
	 *  paused-op variants ignore it; those keep their existing look. */
	@property({ type: String }) icon?: string;

	@property({ attribute: false }) pausedOpStatus?: PausedOperationStatus;
	@property({ type: Boolean, attribute: 'has-conflicts' }) hasConflicts = false;
	@property({ type: Number, attribute: 'conflicts-count' }) conflictsCount?: number;

	override render(): unknown {
		if (this.pausedOpStatus != null) return this.renderPausedOp(this.pausedOpStatus);

		const added = this.added ?? 0;
		const modified = this.modified ?? 0;
		const removed = this.removed ?? 0;
		const isDirty = this.dirty ?? added + modified + removed > 0;

		if (isDirty) {
			const visible = this.badge
				? html`<span class="indicator-pill pill pill--outlined" aria-label="Working tree has changes">
						<code-icon icon="pencil"></code-icon>
					</span>`
				: html`<commit-stats
						added=${added || nothing}
						modified=${modified || nothing}
						removed=${removed || nothing}
						symbol="icons"
						appearance="pill"
						no-tooltip
					>
						${this.icon ? html`<code-icon class="wip-leading-icon" icon=${this.icon}></code-icon>` : nothing}
					</commit-stats>`;

			if (this.noTooltip) return visible;

			// Tooltip: describe the breakdown in words via getWipTooltipParts so the tooltip adds
			// detail over the icon pill instead of echoing it. Falls back to a generic message when
			// only the dirty bit is known (cheap probes — upgrades on hover).
			const parts = getWipTooltipParts({ added: added, changed: modified, deleted: removed });
			const tooltipContent = parts.length
				? `${parts.join(', ')} in the working tree`
				: 'Working tree has changes';

			return html`<gl-tooltip placement="bottom"
				>${visible}<span slot="content">${tooltipContent}</span></gl-tooltip
			>`;
		}

		if (!this.showClean) return nothing;

		// Don't show the clean checkmark if we don't have an explicit dirty state AND we don't have stats data
		if (this.dirty == null && this.added == null && this.modified == null && this.removed == null) {
			return nothing;
		}

		if (this.badge) {
			const pill = html`<span class="indicator-pill pill pill--outlined" aria-label="No working changes">
				<code-icon class="wip-clean-check" icon="check"></code-icon>
			</span>`;

			if (this.noTooltip) return pill;

			return html`<gl-tooltip placement="bottom"
				>${pill}<span slot="content">No working changes</span></gl-tooltip
			>`;
		}

		const pill = html`<commit-stats
			class="indicator-pill"
			appearance="pill"
			no-tooltip
			aria-label="No working changes"
		>
			${this.icon ? html`<code-icon class="wip-leading-icon" icon=${this.icon}></code-icon>` : nothing}
			<code-icon class="wip-clean-check" icon="check"></code-icon>
		</commit-stats>`;

		if (this.noTooltip) return pill;

		return html`<gl-tooltip placement="bottom">${pill}<span slot="content">No working changes</span></gl-tooltip>`;
	}

	private renderPausedOp(pausedOp: PausedOperationStatus): unknown {
		// Mirrors the paused-operation bar's state set so the header badge and the bar can't disagree —
		// including its LABEL. Reading `pausedOperationStatusStringsByType` directly instead shares the
		// string table but not the decision on top of it, which is where they drift: the table has no
		// `pending` entry, so a rebase that hasn't reached its first step read as "Rebasing" here while
		// every other surface said "Pending Rebase".
		const variant = getPausedOperationVariant(pausedOp, this.hasConflicts);
		const opStrings = pausedOperationStatusStringsByType[pausedOp.type];
		const label =
			variant === 'conflicts'
				? pluralize('Conflict', this.conflictsCount ?? 1)
				: variant === 'pending'
					? 'Pending Rebase'
					: opStrings.label;

		const badge = html`<span
			class="paused-op-badge${variant === 'conflicts' ? ' paused-op-badge--conflicts' : ''}${
				variant === 'ready' ? ' paused-op-badge--ready' : ''
			}"
			aria-label=${label}
		>
			<code-icon icon=${pausedOperationVariantIcons[variant]}></code-icon>
			${label}
		</span>`;

		if (this.noTooltip) return badge;

		const tooltip =
			variant === 'ready' ? `${opStrings.label} — ready to continue` : `${opStrings.label} in progress`;
		return html`<gl-tooltip placement="bottom">${badge}<span slot="content">${tooltip}</span></gl-tooltip>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-stats': GlWipStats;
	}
}
