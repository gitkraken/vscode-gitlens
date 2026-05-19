import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import './commit-stats.js';
import '../code-icon.js';
import '../overlays/tooltip.js';

export type WipStatsCleanState = 'hidden' | 'badge';

@customElement('gl-wip-stats')
export class GlWipStats extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		.wip-clean-check {
			--code-icon-size: 1.1rem;
			--code-icon-v-align: middle;
			color: var(--gl-stat-added);
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
	`;

	@property({ type: Number }) added: number | undefined;
	@property({ type: Number }) modified: number | undefined;
	@property({ type: Number }) removed: number | undefined;

	@property({ attribute: 'clean-state' }) cleanState: WipStatsCleanState = 'hidden';
	@property({ type: Boolean, attribute: 'no-tooltip' }) noTooltip = false;

	@property({ attribute: false }) pausedOpStatus?: GitPausedOperationStatus;
	@property({ type: Boolean, attribute: 'has-conflicts' }) hasConflicts = false;
	@property({ type: Number, attribute: 'conflicts-count' }) conflictsCount?: number;

	override render(): unknown {
		if (this.pausedOpStatus != null) return this.renderPausedOp(this.pausedOpStatus);

		const added = this.added ?? 0;
		const modified = this.modified ?? 0;
		const removed = this.removed ?? 0;

		if (added + modified + removed > 0) {
			return html`<commit-stats
				added=${added || nothing}
				modified=${modified || nothing}
				removed=${removed || nothing}
				symbol="icons"
				appearance="pill"
				?no-tooltip=${this.noTooltip}
			></commit-stats>`;
		}

		if (this.cleanState !== 'badge') return nothing;

		const pill = html`<commit-stats
			appearance="pill"
			no-tooltip
			aria-label="No changes"
			style="--commit-stats-pill-padding: 0 0.6rem;"
		>
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
