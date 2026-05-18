import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './commit-stats.js';
import '../code-icon.js';

export type WipStatsCleanState = 'hidden' | 'badge' | 'text';

@customElement('gl-wip-stats')
export class GlWipStats extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		.no-changes {
			min-width: 0;
			flex: 0 1 auto;
			color: var(--color-foreground--50);
			font-size: var(--gl-font-base);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.wip-clean-pill {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			font-size: 1.1rem;
			font-weight: 600;
			line-height: var(--commit-stats-pill-line-height, 1.5rem);
			padding: 0 0.8rem 0 0.6rem;
			border-radius: 0.4rem;
			background-color: color-mix(
				in srgb,
				var(--vscode-sideBarSectionHeader-background) 90%,
				var(--vscode-foreground) 10%
			);
			border: 1px solid
				color-mix(in srgb, var(--vscode-sideBarSectionHeader-border) 100%, var(--vscode-foreground) 70%);
			white-space: nowrap;
			color: var(--color-foreground--65);
		}

		.wip-clean-pill code-icon {
			--code-icon-size: 1.1rem;
			--code-icon-v-align: middle;
			color: var(--vscode-charts-green, var(--vscode-foreground));
		}
	`;

	@property({ type: Number }) added: number | undefined;
	@property({ type: Number }) modified: number | undefined;
	@property({ type: Number }) removed: number | undefined;

	@property({ attribute: 'clean-state' }) cleanState: WipStatsCleanState = 'hidden';

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
				no-tooltip
			></commit-stats>`;
		}

		switch (this.cleanState) {
			case 'text':
				return html`<span class="no-changes">No changes</span>`;
			case 'badge':
				return html`<span class="wip-clean-pill" aria-label="No changes">
					<code-icon icon="pass-filled"></code-icon>
					<span>No changes</span>
				</span>`;
			default:
				return nothing;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-stats': GlWipStats;
	}
}
