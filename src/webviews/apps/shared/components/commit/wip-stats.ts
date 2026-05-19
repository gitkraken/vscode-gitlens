import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
	`;

	@property({ type: Number }) added: number | undefined;
	@property({ type: Number }) modified: number | undefined;
	@property({ type: Number }) removed: number | undefined;

	@property({ attribute: 'clean-state' }) cleanState: WipStatsCleanState = 'hidden';
	@property({ type: Boolean, attribute: 'no-tooltip' }) noTooltip = false;

	override render(): unknown {
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
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-stats': GlWipStats;
	}
}
