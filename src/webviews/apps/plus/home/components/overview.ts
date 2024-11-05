import { consume } from '@lit/context';
import { SignalWatcher, watch } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitContributor } from 'src/git/models/contributor';
import type { GetOverviewResponse, State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { sectionHeadingStyles } from './branch-section';
import type { OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/skeleton-loader';

type Overview = GetOverviewResponse;

export const overviewTagName = 'gl-overview';

@customElement(overviewTagName)
export class GlOverview extends SignalWatcher(LitElement) {
	static override styles = [
		sectionHeadingStyles,
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}
			.repository {
				color: var(--vscode-foreground);
			}
		`,
	];

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		this._overviewState.run();
	}

	override render() {
		const filter = watch(this._overviewState.filter);
		console.log('render ownerFilter', filter);
		return this._overviewState.render({
			pending: () => this.renderPending(),
			complete: summary => this.renderComplete(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderPending() {
		return html`
			<h3 class="section-heading">Recent</h3>
			<skeleton-loader lines="3"></skeleton-loader>
		`;
	}

	private renderComplete(overview: Overview) {
		if (overview == null) return nothing;
		const { repository } = overview;

		return html`
			<div class="repository">
				<span>invalidate: ${watch(this._overviewState.state)}</span>
				<gl-branch-section
					label="Recent (${repository.branches.recent.length})"
					.filter=${watch(this._overviewState.filter)}
					.branches=${repository.branches.recent}
				></gl-branch-section>
				<gl-branch-section
					label="Stale (${repository.branches.stale.length})"
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
