import type { GraphRow } from '@gitkraken/gitkraken-components';
import { css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type {
	GraphDownstreams,
	GraphMinimapMarkerTypes,
	GraphRefsMetadata,
	GraphRowStats,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphWipMetadataBySha,
} from '../../../../plus/graph/protocol.js';
import { GlElement, observe } from '../../../shared/components/element.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/menu/menu-item.js';
import '../../../shared/components/menu/menu-label.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/radio/radio.js';
import '../../../shared/components/radio/radio-group.js';
import type {
	GlGraphMinimap,
	GraphMinimapMarker,
	GraphMinimapSearchResultMarker,
	GraphMinimapStats,
	GraphMinimapZoomChangeEvent,
} from './minimap.js';
import './minimap.js';
import { aggregate, aggregateSearchResults } from './minimapData.js';

export interface GraphMinimapConfigChangeEventDetail {
	minimapDataType?: 'commits' | 'lines';
	minimapReversed?: boolean;
	markerType?: GraphMinimapMarkerTypes;
	checked?: boolean;
}

@customElement('gl-graph-minimap-container')
export class GlGraphMinimapContainer extends GlElement {
	static override styles = css`
		:host {
			display: block;
			position: relative;
		}

		.minimap-settings-wrapper {
			position: absolute;
			top: 8px;
			right: 2px;
			z-index: 2;
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			gap: 6px;
		}

		:host([collapsed]) .minimap-settings-wrapper {
			display: none;
		}

		.minimap-settings__trigger {
			appearance: none;
			background: transparent;
			border: none;
			color: var(--color-foreground--75);
			cursor: pointer;
			padding: 2px;
			border-radius: 3px;
			line-height: 1;
		}

		.minimap-settings__trigger:hover {
			color: var(--color-foreground);
			background-color: var(--color-graph-actionbar-selectedBackground);
		}

		.minimap-datatype__label {
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}

		.minimap-datatype__info {
			color: var(--color-foreground--50);
			font-size: 12px;
		}

		.minimap-datatype__info:hover {
			color: var(--color-foreground);
		}

		.minimap-marker-swatch {
			display: inline-block;
			width: 1rem;
			height: 1rem;
			border-radius: 2px;
			transform: scale(1.6);
			margin-left: 0.3rem;
			margin-right: 1rem;
		}

		.minimap-marker-swatch[data-marker='localBranches'] {
			background-color: var(--color-graph-minimap-marker-local-branches);
		}

		.minimap-marker-swatch[data-marker='remoteBranches'] {
			background-color: var(--color-graph-minimap-marker-remote-branches);
		}

		.minimap-marker-swatch[data-marker='pullRequests'] {
			background-color: var(--color-graph-minimap-marker-pull-requests);
		}

		.minimap-marker-swatch[data-marker='stashes'] {
			background-color: var(--color-graph-minimap-marker-stashes);
		}

		.minimap-marker-swatch[data-marker='tags'] {
			background-color: var(--color-graph-minimap-marker-tags);
		}

		.minimap-marker-swatch[data-marker='worktree'] {
			background-color: var(--color-graph-minimap-marker-worktree);
		}

		/* Matches the inner canvas's width (see #canvas in minimap.ts), so dim bands inside this
			layer align with the chart area rather than spilling into the popover gutter. */
		.scope-dims-layer {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: calc(100% - 2.5rem);
			pointer-events: none;
			z-index: 1;
		}
		.scope-dim {
			position: absolute;
			top: 0;
			bottom: 0;
			backdrop-filter: brightness(0.35) saturate(0.4);
			transition:
				width 0.15s ease,
				left 0.15s ease;
		}
		.scope-dim--left {
			left: 0;
		}
		.scope-dim--right {
			right: 0;
		}
		/* Leave the zoom scrollbar visible (matches scrollbarHeightPx in minimap.ts). */
		.scope-dim--zoomed {
			bottom: 8px;
		}

		:host([collapsed]) .scope-dims-layer {
			display: none;
		}
	`;

	@property({ type: Number })
	activeDay: number | undefined;

	@property({ type: Boolean })
	disabled = false;

	@property({ type: Boolean, reflect: true })
	collapsed = false;

	@observe('disabled')
	private onDisabledChanged() {
		this.flushPendingWork();
	}

	@observe('collapsed')
	private onCollapsedChanged() {
		this.flushPendingWork();
		this.syncScopeZoom();
	}

	private _lastZoomApplied?: { start: number; end: number };

	@observe('scopeWindow', { afterFirstUpdate: true })
	private onScopeWindowChanged() {
		this.syncScopeZoom();
	}

	private syncScopeZoom() {
		const minimap = this.minimap;
		if (minimap == null || this.collapsed) return;

		const window = this.scopeWindow;
		if (window == null) {
			if (this._lastZoomApplied != null) {
				minimap.resetZoom();
				this._lastZoomApplied = undefined;
				// Re-render so dim bands re-project onto the unzoomed range.
				this.requestUpdate();
			}
			return;
		}

		if (this._lastZoomApplied?.start === window.start && this._lastZoomApplied?.end === window.end) {
			return;
		}
		minimap.applyZoom(window.start, window.end);
		this._lastZoomApplied = { start: window.start, end: window.end };
		// Re-render so dim bands re-project onto the new zoom range.
		this.requestUpdate();
	}

	private flushPendingWork() {
		if (this.disabled || this.collapsed) return;

		if (this.pendingDataChange) {
			this.processRows();
		}

		if (this.pendingSearchResultsChange) {
			this.processSearchResults();
		}
	}

	@property({ type: String })
	dataType: 'commits' | 'lines' = 'commits';

	@property({ type: Object })
	downstreams?: GraphDownstreams;

	@property({ type: Array })
	markerTypes: GraphMinimapMarkerTypes[] = [];

	@property({ type: Boolean })
	reversed = false;

	@property({ type: Object })
	refMetadata?: GraphRefsMetadata | null;

	@property({ type: Array })
	rows: GraphRow[] = [];

	@property({ type: Object })
	rowsStats?: Record<string, GraphRowStats>;

	@property({ type: Boolean })
	rowsStatsLoading?: boolean;

	@property({ type: Object })
	searchResults?: GraphSearchResults | GraphSearchResultsError;

	@property({ type: Object })
	visibleDays: { top: number; bottom: number } | undefined;

	@property({ type: Object })
	scopeWindow?: { start: number; end: number };

	@property({ type: Object })
	wipMetadataBySha?: GraphWipMetadataBySha;

	@state()
	private markersByDay = new Map<number, GraphMinimapMarker[]>();

	@state()
	private searchResultsByDay = new Map<number, GraphMinimapSearchResultMarker>();

	@state()
	private statsByDay = new Map<number, GraphMinimapStats>();

	@state()
	private zoomed = false;

	private pendingDataChange = false;

	@observe([
		'dataType',
		'downstreams',
		'markerTypes',
		'refMetadata',
		'rows',
		'rowsStats',
		'rowsStatsLoading',
		'wipMetadataBySha',
	])
	private handleDataChanged(changedKeys: PropertyKey[]) {
		// If only rowsStats changed and we're not in lines mode, stats output is unchanged
		if (changedKeys.length === 1 && changedKeys[0] === 'rowsStats' && this.dataType !== 'lines') {
			return;
		}

		// rowsStatsLoading only affects the commits/lines aggregate path in lines mode
		if (changedKeys.length === 1 && changedKeys[0] === 'rowsStatsLoading' && this.dataType !== 'lines') {
			return;
		}

		// If only refMetadata changed and the PR marker type is not enabled, markers are unchanged
		if (
			changedKeys.length === 1 &&
			changedKeys[0] === 'refMetadata' &&
			!this.markerTypes.includes('pullRequests')
		) {
			return;
		}

		// If only downstreams changed and we don't render local-branch markers, markers are unchanged
		if (
			changedKeys.length === 1 &&
			changedKeys[0] === 'downstreams' &&
			!this.markerTypes.includes('localBranches')
		) {
			return;
		}

		// If only wipMetadataBySha changed and the worktree marker type is not enabled, markers are unchanged
		if (
			changedKeys.length === 1 &&
			changedKeys[0] === 'wipMetadataBySha' &&
			!this.markerTypes.includes('worktree')
		) {
			return;
		}

		this.pendingDataChange = true;
		if (this.disabled || this.collapsed) return;

		this.processRows();
	}

	private pendingSearchResultsChange = false;

	@observe(['markerTypes', 'searchResults'])
	private handleSearchResultsChanged() {
		this.pendingSearchResultsChange = true;
		if (this.disabled || this.collapsed) return;

		this.processSearchResults();
	}

	@query('#minimap')
	private minimap: GlGraphMinimap | undefined;

	private get isLoading(): boolean {
		// In line mode an empty or partial rowsStats renders as a (nearly) flat line — the host flags
		// this via rowsStatsLoading until the deferred stats query completes.
		if (this.dataType === 'lines') return this.rowsStatsLoading === true || this.rowsStats == null;
		return this.rows == null;
	}

	override render(): unknown {
		if (this.disabled) return nothing;

		return html`<gl-graph-minimap
				id="minimap"
				.activeDay=${this.activeDay}
				.data=${this.statsByDay}
				.dataType=${this.dataType}
				.loading=${this.isLoading}
				.markers=${this.markersByDay}
				.reversed=${this.reversed}
				.searchResults=${this.searchResultsByDay}
				.visibleDays=${this.visibleDays}
				@gl-graph-minimap-zoom-change=${this.handleZoomChanged}
			></gl-graph-minimap>
			${this.renderScopeDims()}
			<div class="minimap-settings-wrapper">
				<gl-popover placement="bottom-end" trigger="hover focus click" ?arrow=${false} distance=${0} hoist>
					<button type="button" class="minimap-settings__trigger" aria-label="Minimap Options" slot="anchor">
						<code-icon
							icon=${this.dataType === 'lines' ? 'request-changes' : 'git-commit'}
							size="16"
						></code-icon>
					</button>
					<div slot="content">
						<menu-label>Minimap</menu-label>
						<menu-item role="none">
							<gl-radio-group value=${this.dataType} @gl-change-value=${this.handleDataTypeChanged}>
								<gl-radio name="minimap-datatype" value="commits">Commits</gl-radio>
								<gl-radio name="minimap-datatype" value="lines">
									<span class="minimap-datatype__label">
										Lines Changed
										<gl-tooltip
											placement="right"
											content="Visualizes the volume of additions and deletions per day. Computing this requires reading each commit's diff stats and can take a while on large repos."
										>
											<code-icon class="minimap-datatype__info" icon="info"></code-icon>
										</gl-tooltip>
									</span>
								</gl-radio>
							</gl-radio-group>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="reversed"
								@gl-change-value=${this.handleReversedChanged}
								?checked=${this.reversed}
							>
								Reverse Direction
							</gl-checkbox>
						</menu-item>
						<menu-divider></menu-divider>
						<menu-label>Markers</menu-label>
						<menu-item role="none">
							<gl-checkbox
								value="localBranches"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('localBranches')}
							>
								<span class="minimap-marker-swatch" data-marker="localBranches"></span>
								Local Branches
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="remoteBranches"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('remoteBranches')}
							>
								<span class="minimap-marker-swatch" data-marker="remoteBranches"></span>
								Remote Branches
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="pullRequests"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('pullRequests')}
							>
								<span class="minimap-marker-swatch" data-marker="pullRequests"></span>
								Pull Requests
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="stashes"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('stashes')}
							>
								<span class="minimap-marker-swatch" data-marker="stashes"></span>
								Stashes
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="tags"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('tags')}
							>
								<span class="minimap-marker-swatch" data-marker="tags"></span>
								Tags
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="worktree"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('worktree')}
							>
								<span class="minimap-marker-swatch" data-marker="worktree"></span>
								Worktrees
							</gl-checkbox>
						</menu-item>
					</div>
				</gl-popover>
				${this.zoomed
					? html`<gl-tooltip placement="left" content="Exit Zoom">
							<button
								type="button"
								class="minimap-settings__trigger"
								aria-label="Exit Zoom"
								@click=${this.handleExitZoom}
							>
								<code-icon icon="zoom-out" size="16"></code-icon>
							</button>
						</gl-tooltip>`
					: this.scopeWindow != null
						? html`<gl-tooltip placement="left" content="Zoom to Scope">
								<button
									type="button"
									class="minimap-settings__trigger"
									aria-label="Zoom to Scope"
									@click=${this.handleEnterZoom}
								>
									<code-icon icon="zoom-in" size="16"></code-icon>
								</button>
							</gl-tooltip>`
						: nothing}
			</div>`;
	}

	private renderScopeDims(): unknown {
		const window = this.scopeWindow;
		if (window == null || this.collapsed || this.statsByDay.size < 2) return nothing;

		// Project onto the minimap's current x-axis. When zoomed, use the zoom range; otherwise use
		// the full statsByDay range. Either way, extend the end by one day since day keys are
		// start-of-UTC-day timestamps and each bucket visually covers its full 24h.
		let domainStart: number;
		let domainEnd: number;
		const zoomOldest = this.minimap?.zoomOldest;
		const zoomNewest = this.minimap?.zoomNewest;
		if (zoomOldest != null && zoomNewest != null) {
			domainStart = zoomOldest;
			domainEnd = zoomNewest + 86400000;
		} else {
			let minDay = Infinity;
			let maxDay = -Infinity;
			for (const day of this.statsByDay.keys()) {
				if (day < minDay) {
					minDay = day;
				}
				if (day > maxDay) {
					maxDay = day;
				}
			}
			domainStart = minDay;
			domainEnd = maxDay + 86400000;
		}
		const span = domainEnd - domainStart;
		if (span <= 0) return nothing;

		const leftPct = Math.max(0, Math.min(1, (window.start - domainStart) / span)) * 100;
		const rightPct = Math.max(0, Math.min(1, (window.end - domainStart) / span)) * 100;
		if (leftPct >= rightPct) return nothing;

		const zoomedClass = zoomOldest != null && zoomNewest != null ? ' scope-dim--zoomed' : '';
		return html`
			<div class="scope-dims-layer">
				<div class="scope-dim scope-dim--left${zoomedClass}" style=${`width:${leftPct}%`}></div>
				<div class="scope-dim scope-dim--right${zoomedClass}" style=${`left:${rightPct}%`}></div>
			</div>
		`;
	}

	private handleDataTypeChanged(e: Event) {
		const el = e.target as HTMLElement & { value: string };
		const minimapDataType = el.value === 'lines' ? 'lines' : 'commits';
		if (this.dataType === minimapDataType) return;

		this.dispatchEvent(
			new CustomEvent<GraphMinimapConfigChangeEventDetail>('gl-graph-minimap-config-change', {
				detail: { minimapDataType: minimapDataType },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleMarkerTypeChanged(e: Event) {
		const el = e.target as HTMLInputElement;
		const markerType = el.value as GraphMinimapMarkerTypes;

		this.dispatchEvent(
			new CustomEvent<GraphMinimapConfigChangeEventDetail>('gl-graph-minimap-config-change', {
				detail: { markerType: markerType, checked: el.checked },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleReversedChanged(e: Event) {
		const el = e.target as HTMLInputElement;
		if (el.checked === this.reversed) return;

		this.dispatchEvent(
			new CustomEvent<GraphMinimapConfigChangeEventDetail>('gl-graph-minimap-config-change', {
				detail: { minimapReversed: el.checked },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleZoomChanged(e: GraphMinimapZoomChangeEvent) {
		this.zoomed = e.detail.zoomed;
	}

	private handleExitZoom() {
		this.minimap?.resetZoom();
	}

	private handleEnterZoom() {
		const window = this.scopeWindow;
		if (window == null) return;
		this.minimap?.applyZoom(window.start, window.end);
	}

	select(date: number | Date | undefined, trackOnly: boolean = false): void {
		if (this.disabled || this.collapsed) return;
		this.minimap?.select(date, trackOnly);
	}

	unselect(date?: number | Date, focus: boolean = false): void {
		if (this.disabled) return;
		this.minimap?.unselect(date, focus);
	}

	private processRows() {
		this.pendingDataChange = false;

		// While stats are still loading, aggregate in commits mode so the timeline spans the full
		// row range (for correct marker placement) — the spline itself is suppressed downstream via
		// the minimap's `loading` prop, so a partial stats sprinkle never renders as a flat line.
		const effectiveDataType = this.isLoading ? 'commits' : this.dataType;

		const { statsByDay, markersByDay } = aggregate({
			rows: this.rows ?? [],
			rowsStats: this.rowsStats,
			refMetadata: this.refMetadata,
			downstreams: this.downstreams,
			markerTypes: this.markerTypes,
			dataType: effectiveDataType,
			wipMetadataBySha: this.wipMetadataBySha,
		});

		this.statsByDay = statsByDay;
		this.markersByDay = markersByDay;
	}

	private processSearchResults() {
		this.pendingSearchResultsChange = false;
		this.searchResultsByDay = aggregateSearchResults(this.searchResults);
	}
}
