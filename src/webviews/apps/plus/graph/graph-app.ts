import type { GraphRow, SelectCommitsOptions } from '@gitkraken/gitkraken-components';
import { refZone } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { SearchQuery } from '../../../../constants.search';
import type { GitGraphRowType } from '../../../../git/models/graph';
import { getScopedCounter } from '../../../../system/counter';
import { GetRowHoverRequest } from '../../../plus/graph/protocol';
import type { CustomEventType } from '../../shared/components/element';
import { ipcContext } from '../../shared/contexts/ipc';
import type { TelemetryContext } from '../../shared/contexts/telemetry';
import { telemetryContext } from '../../shared/contexts/telemetry';
import { emitTelemetrySentEvent } from '../../shared/telemetry';
import { graphStateContext } from './context';
import type { GlGraphHeader } from './graph-header';
import type { GlGraphWrapper } from './graph-wrapper/graph-wrapper';
import type { GlGraphHover } from './hover/graphHover';
import type { GraphMinimapDaySelectedEventDetail } from './minimap/minimap';
import type { GlGraphMinimapContainer } from './minimap/minimap-container';
import './gate';
import './graph-header';
import './graph-wrapper/graph-wrapper';
import './hover/graphHover';
import './minimap/minimap-container';
import './sidebar/sidebar';
import '../../shared/components/mcp-banner';

@customElement('gl-graph-app')
export class GraphApp extends SignalWatcher(LitElement) {
	private _hoverTrackingCounter = getScopedCounter();
	private _selectionTrackingCounter = getScopedCounter();
	private _lastSearchRequest: SearchQuery | undefined;

	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	@query('gl-graph-wrapper')
	graph!: GlGraphWrapper;

	@query('gl-graph-header')
	private readonly graphHeader!: GlGraphHeader;

	@query('gl-graph-hover#commit-hover')
	private readonly graphHover!: GlGraphHover;

	@query('gl-graph-minimap-container')
	minimapEl: GlGraphMinimapContainer | undefined;

	onWebviewVisibilityChanged(visible: boolean): void {
		if (!visible) return;

		this._hoverTrackingCounter.reset();
		this._selectionTrackingCounter.reset();

		// Auto-focus the graph rows for keyboard navigation
		this.graph?.focus();
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		// Check for external search request (from file history command, etc.)
		const searchRequest = this.graphState.searchRequest;
		if (searchRequest && searchRequest !== this._lastSearchRequest) {
			this._lastSearchRequest = searchRequest;
			// Wait for next render cycle to ensure graphHeader is ready
			void this.updateComplete.then(() => {
				this.graphHeader?.setExternalSearchQuery(searchRequest);
			});
		}
	}

	resetHover() {
		this.graphHover.reset();
	}

	override render() {
		return html`
			<div class="graph">
				<gl-graph-header
					class="graph__header"
					.selectCommits=${this.selectCommits}
					.getCommits=${this.getCommits}
				></gl-graph-header>
				<div class="graph__workspace">
					${when(!this.graphState.allowed, () => html`<gl-graph-gate class="graph__gate"></gl-graph-gate>`)}
					<main id="main" class="graph__panes">
						<div class="graph__graph-pane">
							${when(
								this.graphState.config?.minimap !== false,
								() => html`
									<gl-graph-minimap-container
										.activeDay=${this.graphState.activeDay}
										.disabled=${!this.graphState.config?.minimap}
										.rows=${this.graphState.rows ?? []}
										.rowsStats=${this.graphState.rowsStats}
										.dataType=${this.graphState.config?.minimapDataType ?? 'commits'}
										.markerTypes=${this.graphState.config?.minimapMarkerTypes ?? []}
										.refMetadata=${this.graphState.refsMetadata}
										.searchResults=${this.graphState.searchResults}
										.visibleDays=${this.graphState.visibleDays
											? { ...this.graphState.visibleDays } // Need to clone the object since it is a signal proxy
											: undefined}
										@gl-graph-minimap-selected=${this.handleMinimapDaySelected}
									></gl-graph-minimap-container>
								`,
							)}
							${when(this.graphState.config?.sidebar, () => html`<gl-graph-sidebar></gl-graph-sidebar>`)}
							<gl-graph-hover id="commit-hover" distance=${0} skidding=${15}></gl-graph-hover>
							<gl-graph-wrapper
								@gl-graph-change-selection=${this.handleGraphSelectionChanged}
								@gl-graph-change-visible-days=${this.handleGraphVisibleDaysChanged}
								@gl-graph-mouse-leave=${this.handleGraphMouseLeave}
								@gl-graph-row-context-menu=${this.handleGraphRowContextMenu}
								@gl-graph-row-hover=${this.handleGraphRowHover}
								@gl-graph-row-unhover=${this.handleGraphRowUnhover}
								@row-action-hover=${this.handleGraphRowActionHover}
							></gl-graph-wrapper>
						</div>
						<!-- future: commit details -->
					</main>
				</div>
			</div>
		`;
	}

	private selectCommits = (shas: string[], options?: SelectCommitsOptions) => {
		return this.graph.selectCommits(shas, options);
	};

	private getCommits = (shas: string[]) => {
		return this.graph.getCommits(shas);
	};

	private handleMinimapDaySelected(e: CustomEvent<GraphMinimapDaySelectedEventDetail>) {
		if (!this.graphState.rows) return;

		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find closest row to the date
			const closest = this.graphState.rows.reduce((prev, curr) => {
				return Math.abs(curr.date - date) < Math.abs(prev.date - date) ? curr : prev;
			});
			sha = closest.sha;
		}

		this.graph.selectCommits([sha], { ensureVisible: true });

		if (e.target != null) {
			const { target } = e;
			queueMicrotask(() =>
				emitTelemetrySentEvent<'graph/minimap/day/selected'>(target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
			);
		}
	}

	private handleGraphSelectionChanged(e: CustomEventType<'gl-graph-change-selection'>) {
		this.graphHover.hide();

		const count = this._selectionTrackingCounter.next();
		if (count === 1 || count % 100 === 0) {
			queueMicrotask(() =>
				this._telemetry.sendEvent({
					name: 'graph/row/selected',
					data: { rows: e.detail.selection.length, count: count },
				}),
			);
		}
	}

	private handleGraphVisibleDaysChanged({ detail }: CustomEventType<'gl-graph-change-visible-days'>) {
		this.graphState.visibleDays = detail;
	}

	private handleGraphRowContextMenu(_e: CustomEventType<'gl-graph-row-context-menu'>) {
		this.graphHover.hide();
	}

	private handleGraphRowHover({
		detail: { graphZoneType, graphRow, clientX, currentTarget },
	}: CustomEventType<'gl-graph-row-hover'>) {
		if (graphZoneType === refZone) return;

		const hover = this.graphHover;
		if (hover == null) return;

		const rect = currentTarget.getBoundingClientRect();
		const x = clientX;
		const y = rect.top;
		const height = rect.height;
		const width = 60; // Add some width, so `skidding` will be able to apply
		const anchor = {
			getBoundingClientRect: function () {
				return {
					width: width,
					height: height,
					x: x,
					y: y,
					top: y,
					left: x,
					right: x + width,
					bottom: y + height,
				};
			},
		};

		hover.requestMarkdown ??= this.getRowHoverPromise.bind(this);
		hover.onRowHovered(graphRow, anchor);

		this.minimapEl?.select(graphRow.date, true);
	}

	private handleGraphRowUnhover({
		detail: { graphRow, relatedTarget },
	}: CustomEventType<'gl-graph-row-unhover'>): void {
		this.graphHover.onRowUnhovered(graphRow, relatedTarget);
	}

	private handleGraphRowActionHover() {
		this.graphHover.hide();
	}

	private async getRowHoverPromise(row: GraphRow) {
		try {
			const request = await this._ipc.sendRequest(GetRowHoverRequest, {
				type: row.type as GitGraphRowType,
				id: row.sha,
			});

			const count = this._hoverTrackingCounter.next();
			if (count === 1 || count % 100 === 0) {
				queueMicrotask(() => this._telemetry.sendEvent({ name: 'graph/row/hovered', data: { count: count } }));
			}

			return request;
		} catch (ex) {
			return { id: row.sha, markdown: { status: 'rejected' as const, reason: ex } };
		}
	}

	private handleGraphMouseLeave() {
		this.minimapEl?.unselect(undefined, true);
	}
}
