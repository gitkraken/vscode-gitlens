import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { GetOverviewResponse } from '../../../../home/protocol';
import { sectionHeadingStyles } from './branch-section';
import type { OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';

type Overview = GetOverviewResponse;

export const overviewTagName = 'gl-overview';

@customElement(overviewTagName)
export class GlOverview extends SignalWatcher(LitElement) {
	static override styles = [
		sectionHeadingStyles,
		css`
			.repository {
				color: var(--vscode-foreground);
			}
		`,
	];

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		if (this._overviewState.state.value == null) {
			this._overviewState.run();
		}
	}

	override render() {
		return this._overviewState.render({
			pending: () => html`<span>Loading...</span>`,
			complete: summary => this.renderComplete(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderComplete(overview: Overview) {
		if (overview == null) return nothing;

		const { repository } = overview;
		return html`
			<div class="repository">
				<gl-branch-section
					label="RECENTLY MODIFIED (${repository.branches.recent.length})"
					.branches=${repository.branches.recent}
				></gl-branch-section>
				<gl-branch-section
					label="STALE (${repository.branches.stale.length})"
					.branches=${repository.branches.stale}
				></gl-branch-section>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[overviewTagName]: GlOverview;
	}
}
