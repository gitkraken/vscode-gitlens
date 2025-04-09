import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { CustomEventType } from '../../shared/components/element';
import { emitTelemetrySentEvent } from '../../shared/telemetry';
import { stateContext } from './context';
import type { GlGraphWrapper } from './graph-wrapper/graph-wrapper';
import type { GraphMinimapDaySelectedEventDetail } from './minimap/minimap';
import type { GlGraphMinimapContainer } from './minimap/minimap-container';
import { graphStateContext } from './stateProvider';
import './minimap/minimap-container';
import './graph-wrapper/graph-wrapper';
import './sidebar/sidebar';
import './graph-header';
import './gate';

@customElement('gl-graph-app-wc')
export class GraphAppWC extends SignalWatcher(LitElement) {
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: stateContext, subscribe: true })
	state!: typeof stateContext.__context__;

	@consume({ context: graphStateContext, subscribe: true })
	graphApp!: typeof graphStateContext.__context__;

	@query('gl-graph-minimap-container')
	minimapEl!: GlGraphMinimapContainer;

	@query('gl-graph-wrapper')
	graphWrapper!: GlGraphWrapper;

	private handleHeaderSearchNavigation(e: CustomEventType<'gl-select-commits'>) {
		this.graphWrapper.selectCommits([e.detail], false, true);
	}

	private handleMinimapDaySelected(e: CustomEvent<GraphMinimapDaySelectedEventDetail>) {
		if (!this.state.rows) {
			return;
		}
		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find closest row to the date
			const closest = this.state.rows.reduce((prev, curr) => {
				return Math.abs(curr.date - date) < Math.abs(prev.date - date) ? curr : prev;
			});
			sha = closest.sha;
		}

		this.graphWrapper.selectCommits([sha], false, true);

		queueMicrotask(
			() =>
				e.target &&
				emitTelemetrySentEvent<'graph/minimap/day/selected'>(e.target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
		);
	}

	private handleGraphVisibleDaysChanged(e: CustomEventType<'gl-graph-change-visible-days'>) {
		this.graphApp.visibleDays = e.detail;
	}

	private handleGraphRowHovered(e: CustomEventType<'gl-graph-hovered-row'>) {
		this.minimapEl.select(e.detail.graphRow.date, true);
	}

	private handleGraphMouseLeaved() {
		this.minimapEl.unselect(undefined, true);
	}

	resetHover() {
		this.graphWrapper.resetHover();
	}

	override render() {
		return html`
			<div class="graph">
				<gl-graph-header
					class="graph__header"
					@gl-select-commits=${this.handleHeaderSearchNavigation}
				></gl-graph-header>
				<div class="graph__workspace">
					${when(!this.state.allowed, () => html`<gl-graph-gate class="graph__gate"></gl-graph-gate>`)}
					<main id="main" class="graph__panes">
						<div class="graph__graph-pane">
							${when(
								this.state.config?.minimap !== false,
								() => html`
									<gl-graph-minimap-container
										.activeDay=${this.graphApp.activeDay}
										.disabled=${!this.state.config?.minimap}
										.rows=${this.state.rows ?? []}
										.rowsStats=${this.state.rowsStats}
										.dataType=${this.state.config?.minimapDataType ?? 'commits'}
										.markerTypes=${this.state.config?.minimapMarkerTypes ?? []}
										.refMetadata=${this.state.refsMetadata}
										.searchResults=${this.graphApp.searchResults}
										@gl-graph-minimap-selected=${this.handleMinimapDaySelected}
										.visibleDays=${this.graphApp.visibleDays && {
											top: this.graphApp.visibleDays.top,
											bottom: this.graphApp.visibleDays.bottom,
										}}
									></gl-graph-minimap-container>
								`,
							)}
							${when(this.state.config?.sidebar, () => html`<gl-graph-sidebar></gl-graph-sidebar>`)}
							<gl-graph-wrapper
								@gl-graph-change-visible-days=${this.handleGraphVisibleDaysChanged}
								@gl-graph-hovered-row=${this.handleGraphRowHovered}
								@gl-graph-mouse-leave=${this.handleGraphMouseLeaved}
							></gl-graph-wrapper>
						</div>
						<!-- future: commit details -->
					</main>
				</div>
			</div>
		`;
	}
}
