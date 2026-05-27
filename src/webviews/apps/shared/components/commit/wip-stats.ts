import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import { baseStyles as pillStyles } from '../pills/pill.css.js';
import './commit-stats.js';
import '../code-icon.js';
import '../overlays/tooltip.js';

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
			}

			.indicator-pill {
				--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
			}

			.indicator-pill.pill {
				gap: 0.2rem;
				text-transform: none;
				user-select: none;
			}

			.indicator-pill.pill code-icon {
				font-size: inherit !important;
				line-height: inherit !important;
				font-weight: inherit !important;
			}

			.wip__tooltip {
				display: contents;
				vertical-align: middle;
			}

			.paused-op-badge {
				display: inline-flex;
				align-items: center;
				gap: 0.6rem;
				padding: 0.1rem 0.4rem;
				border-radius: 0.3rem;
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
				color: #000;
				font-size: 1.1rem;
				font-weight: 600;
				line-height: 2rem;
				white-space: nowrap;
			}

			.paused-op-badge--conflicts {
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
				color: #fff;
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

	@property({ attribute: false }) pausedOpStatus?: GitPausedOperationStatus;
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
					></commit-stats>`;

			if (this.noTooltip) return visible;

			// Tooltip: show the commit-stats pill when we have a breakdown, falling back to a
			// generic message when only the dirty bit is known (cheap probes — upgrades on hover).
			const hasBreakdown = added + modified + removed > 0;
			const tooltipContent = hasBreakdown
				? html`<commit-stats
						added=${added || nothing}
						modified=${modified || nothing}
						removed=${removed || nothing}
						symbol="icons"
						appearance="pill"
						no-tooltip
					></commit-stats>`
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
			const pill = html`<span class="indicator-pill pill pill--outlined" aria-label="No changes">
				<code-icon class="wip-clean-check" icon="check"></code-icon>
			</span>`;

			if (this.noTooltip) return pill;

			return html`<gl-tooltip placement="bottom">${pill}<span slot="content">No changes</span></gl-tooltip>`;
		}

		const pill = html`<commit-stats class="indicator-pill" appearance="pill" no-tooltip aria-label="No changes">
			<code-icon class="wip-clean-check" icon="check"></code-icon>
		</commit-stats>`;

		if (this.noTooltip) return pill;

		return html`<gl-tooltip placement="bottom">${pill}<span slot="content">No changes</span></gl-tooltip>`;
	}

	private renderPausedOp(pausedOp: GitPausedOperationStatus) {
		const opStrings = pausedOperationStatusStringsByType[pausedOp.type];
		const label = this.hasConflicts ? pluralize('conflict', this.conflictsCount ?? 1) : opStrings.label;

		const badge = html`<span
			class="paused-op-badge${this.hasConflicts ? ' paused-op-badge--conflicts' : ''}"
			aria-label=${label}
		>
			<code-icon icon="warning"></code-icon>
			${label}
		</span>`;

		if (this.noTooltip) return badge;

		return html`<gl-tooltip placement="bottom"
			>${badge}<span slot="content">${opStrings.label} in progress</span></gl-tooltip
		>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-stats': GlWipStats;
	}
}
