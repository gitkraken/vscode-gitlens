import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { getCssVariable } from '@gitlens/utils/color.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { groupByMap } from '@gitlens/utils/iterable.js';
import { capitalize, pluralize } from '@gitlens/utils/string.js';
import { GlElement, observe } from '../../../shared/components/element.js';
import { formatDate, formatNumeric, fromNow } from '../../../shared/date.js';
import type { Disposable } from '../../../shared/events.js';
import { onDidChangeTheme } from '../../../shared/theme.js';
import { getDay } from './minimapData.js';
import type { MinimapDrawState, MinimapLayout, MinimapTheme, MinimapViewModel } from './minimapRenderer.js';
import {
	buildViewModel,
	layout as computeLayout,
	drawOverlay,
	drawStatic,
	hitTestScrollbar,
	minZoomRangeMs,
	scrollbarDeltaToTimestampShift,
	sliceViewModel,
	xToDay,
	xToTimestamp,
} from './minimapRenderer.js';

const brushThresholdPx = 3;
const scrollbarHeightPx = 8;
const scrollbarFadeStep = 0.18; // ~6 frames from 0→1 at 60fps

export interface BranchMarker {
	type: 'branch';
	name: string;
	current?: boolean;
}

export interface RemoteMarker {
	type: 'remote';
	name: string;
	current?: boolean;
}

export interface StashMarker {
	type: 'stash';
	name: string;
	current?: undefined;
}

export interface TagMarker {
	type: 'tag';
	name: string;
	current?: undefined;
}

export interface PullRequestMarker {
	type: 'pull-request';
	name: string;
	current?: undefined;
}

export interface WorktreeMarker {
	type: 'worktree';
	name: string;
	current?: undefined;
}

export type GraphMinimapMarker =
	| BranchMarker
	| RemoteMarker
	| StashMarker
	| TagMarker
	| PullRequestMarker
	| WorktreeMarker;

export interface GraphMinimapSearchResultMarker {
	type: 'search-result';
	sha: string;
	count: number;
}

export interface GraphMinimapStats {
	commits: number;

	activity?: { additions: number; deletions: number };
	files?: number;
	sha?: string;
}

export type GraphMinimapDaySelectedEvent = CustomEvent<GraphMinimapDaySelectedEventDetail>;

export interface GraphMinimapDaySelectedEventDetail {
	date: Date;
	sha?: string;
}

export type GraphMinimapWheelEvent = CustomEvent<GraphMinimapWheelEventDetail>;

export interface GraphMinimapWheelEventDetail {
	/** Vertical scroll delta in CSS pixels — `WheelEvent.deltaY` with `deltaMode` already normalized. */
	deltaY: number;
}

export type GraphMinimapZoomChangeEvent = CustomEvent<GraphMinimapZoomChangeEventDetail>;

export interface GraphMinimapZoomChangeEventDetail {
	zoomed: boolean;
}

// CSS-pixel conversion constants for `WheelEvent.deltaMode`. Browsers report wheel deltas in three
// units (pixels / lines / pages); these convert the non-pixel modes to pixels so the graph scroller
// can apply the delta without caring about the wheel source.
const wheelLineHeightPx = 16;
const wheelPageHeightPx = 400;

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-minimap': GlGraphMinimap;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-minimap-selected': GraphMinimapDaySelectedEvent;
		'gl-graph-minimap-wheel': GraphMinimapWheelEvent;
		'gl-graph-minimap-zoom-change': GraphMinimapZoomChangeEvent;
	}
}

@customElement('gl-graph-minimap')
export class GlGraphMinimap extends GlElement {
	static override styles = css`
		:host {
			display: flex;
			position: relative;
			width: 100%;
			height: 100%;
			background: var(--color-graph-background);
		}

		#canvas {
			display: block;
			height: 100%;
			width: calc(100% - 2.5rem);
			cursor: pointer;
		}

		#canvas:active {
			cursor: ew-resize;
		}

		#spinner {
			position: absolute;
			inset: 0;
			display: flex;
			justify-content: center;
			align-items: center;
			z-index: 1;
		}

		#spinner[aria-hidden='true'] {
			display: none;
		}

		#tooltip {
			position: absolute;
			top: calc(100% + 4px);
			left: 0;
			z-index: 10;
			user-select: none;
			pointer-events: none;
			min-width: 300px;
			display: flex;
			flex-direction: column;
			padding: 0.5rem 1rem;
			background-color: var(--color-hover-background);
			color: var(--color-hover-foreground);
			border: 1px solid var(--color-hover-border);
			box-shadow: 0 2px 8px var(--vscode-widget-shadow);
			font-size: var(--font-size);
			opacity: 1;
			white-space: nowrap;
			visibility: hidden;
		}

		#tooltip[data-visible='true'] {
			visibility: visible;
		}

		#tooltip .header {
			display: flex;
			flex-direction: row;
			justify-content: space-between;
			gap: 1rem;
		}

		#tooltip .header--title {
			font-weight: 600;
		}

		#tooltip .header--description {
			font-weight: normal;
			font-style: italic;
		}

		#tooltip .changes {
			margin: 0.5rem 0;
		}

		#tooltip .results {
			display: flex;
			font-size: 12px;
			gap: 0.5rem;
			flex-direction: row;
			flex-wrap: wrap;
			margin: 0.5rem 0;
			max-width: fit-content;
		}

		#tooltip .results .result {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-highlightBackground);
			border: 1px solid var(--color-graph-minimap-tip-highlightBorder);
			color: var(--color-graph-minimap-tip-highlightForeground);
		}

		#tooltip .refs {
			display: flex;
			font-size: 12px;
			gap: 0.5rem;
			flex-direction: row;
			flex-wrap: wrap;
			margin: 0.5rem 0;
			max-width: fit-content;
		}

		#tooltip .refs:empty {
			margin: 0;
		}

		#tooltip .refs .branch {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-branchBackground);
			border: 1px solid var(--color-graph-minimap-tip-branchBorder);
			color: var(--color-graph-minimap-tip-branchForeground);
		}

		#tooltip .refs .branch.current {
			background-color: var(--color-graph-minimap-tip-headBackground);
			border: 1px solid var(--color-graph-minimap-tip-headBorder);
			color: var(--color-graph-minimap-tip-headForeground);
		}

		#tooltip .refs .remote {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-remoteBackground);
			border: 1px solid var(--color-graph-minimap-tip-remoteBorder);
			color: var(--color-graph-minimap-tip-remoteForeground);
		}

		#tooltip .refs .remote.current {
			background-color: var(--color-graph-minimap-tip-upstreamBackground);
			border: 1px solid var(--color-graph-minimap-tip-upstreamBorder);
			color: var(--color-graph-minimap-tip-upstreamForeground);
		}

		#tooltip .refs .stash {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-stashBackground);
			border: 1px solid var(--color-graph-minimap-tip-stashBorder);
			color: var(--color-graph-minimap-tip-stashForeground);
		}

		#tooltip .refs .pull-request {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-pullRequestBackground);
			border: 1px solid var(--color-graph-minimap-pullRequestBorder);
			color: var(--color-graph-minimap-pullRequestForeground);
		}

		#tooltip .refs .tag {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-tagBackground);
			border: 1px solid var(--color-graph-minimap-tip-tagBorder);
			color: var(--color-graph-minimap-tip-tagForeground);
		}

		#tooltip .refs .worktree {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-marker-worktree);
			border: 1px solid var(--color-graph-minimap-marker-worktree);
			/* The purple background is mid-luminance in both themes, so editor-foreground (which flips
			   light/dark with the theme) gives borderline contrast in dark themes. A fixed near-black
			   yields ~5:1 on both purple variants. */
			color: #1f1f1f;
		}
	`;

	@query('#canvas')
	private canvas!: HTMLCanvasElement;

	@query('#tooltip')
	private tooltipEl!: HTMLDivElement;

	@query('#spinner')
	private spinner!: HTMLDivElement;

	private _ctx: CanvasRenderingContext2D | null = null;
	private _staticCanvas: HTMLCanvasElement | undefined;
	private _staticCtx: CanvasRenderingContext2D | null = null;
	private _staticDirty = true;
	// Resolved once per theme swap (invalidated by `onDidChangeTheme`) rather than every rAF —
	// `getComputedStyle` + ~12 custom-property reads adds up on the hot draw path.
	private _cachedTheme: MinimapTheme | undefined;
	private _lastBackingW = 0;
	private _lastBackingH = 0;
	private _viewModel: MinimapViewModel | undefined;
	private _layout: MinimapLayout | undefined;
	private _lastLayoutDayCount: number | undefined;
	private _hoverDay: number | undefined;
	private _observedWidth = 0;
	private _observedHeight = 0;

	private _drawRAF: number | undefined;
	private _resizeObserver: ResizeObserver | undefined;
	private _themeDisposable: Disposable | undefined;
	// Cached bounding rect of the canvas relative to the viewport — populated lazily and invalidated
	// on resize so pointer handlers re-read `getBoundingClientRect()` at most once per layout change.
	private _canvasRect: DOMRect | undefined;
	// Cached day-aligned `activeDay` — recomputed only when `activeDay` changes, reused every rAF.
	private _activeDayNormalized: number | undefined;

	// Zoom state. `_zoomOldest`/`_zoomNewest` hold the precise (possibly sub-day) window; we keep
	// them separate from `_zoomedViewModel.days` (which are day-midnights) to preserve sub-bar
	// precision during pan/thumb-drag so the window doesn't quantize after each adjustment.
	private _zoomOldest: number | undefined;
	private _zoomNewest: number | undefined;
	private _zoomedViewModel: MinimapViewModel | undefined;

	get zoomOldest(): number | undefined {
		return this._zoomOldest;
	}

	get zoomNewest(): number | undefined {
		return this._zoomNewest;
	}

	// Brush gesture state — lives only for the duration of a single pointerdown..pointerup.
	private _pointerDownX: number | undefined;
	private _brushing = false;
	private _brushCurrentX: number | undefined;

	// Scrollbar gesture state.
	private _thumbDragging = false;
	private _thumbDragStartX: number | undefined;
	private _thumbDragStartOldest: number | undefined;
	private _thumbDragStartNewest: number | undefined;

	// Scrollbar fade animation — `_scrollbarOpacity` animates toward `_scrollbarTargetOpacity` one
	// step per rAF, and `drawNow` self-reschedules until they converge.
	private _scrollbarOpacity = 0;
	private _scrollbarTargetOpacity = 0;
	private _scrollbarHover = false;

	// Per-frame draw state, pre-allocated so `drawNow` can mutate fields in place instead of
	// allocating a fresh object (and two inner range objects) every rAF on a hot canvas surface.
	private readonly _zoomRangeScratch = { oldest: 0, newest: 0 };
	private readonly _brushRangeScratch = { startX: 0, endX: 0 };
	private readonly _drawState: MinimapDrawState = {
		viewModel: undefined!,
		layout: undefined!,
		markersByDay: undefined,
		searchResultsByDay: undefined,
		visibleDays: undefined,
		activeDay: undefined,
		hoverDay: undefined,
		theme: undefined!,
		fullTimelineOldest: undefined,
		fullTimelineNewest: undefined,
		zoomRange: undefined,
		brushRange: undefined,
		scrollbarOpacity: 0,
		scrollbarHover: false,
	};

	@property({ type: Number })
	activeDay: number | undefined;

	@observe('activeDay')
	private onActiveDayChanged() {
		this._activeDayNormalized = this.activeDay == null ? undefined : getDay(this.activeDay);
		this.requestDraw();
	}

	@property({ type: Object })
	data: Map<number, GraphMinimapStats | null> | undefined;

	@property({ type: String })
	dataType: 'commits' | 'lines' = 'commits';

	@property({ type: Boolean })
	loading = false;

	@observe(['data', 'dataType'])
	private onDataChanged() {
		this.rebuildViewModel();
		this.rebuildZoomedViewModel();
		this.updateSpinner();
		this.invalidateStatic();
	}

	@observe('loading')
	private onLoadingChanged() {
		this.updateSpinner();
		this.invalidateStatic();
	}

	@property({ type: Object })
	markers: Map<number, GraphMinimapMarker[]> | undefined;

	@observe('markers')
	private onMarkersChanged() {
		this.invalidateStatic();
	}

	@property({ type: Object })
	searchResults: Map<number, GraphMinimapSearchResultMarker> | undefined;

	@observe('searchResults')
	private onSearchResultsChanged() {
		this.invalidateStatic();
	}

	@property({ type: Boolean })
	reversed = false;

	@observe('reversed')
	private onReversedChanged() {
		// Layout stores `reversed` — clear it so `drawNow` rebuilds with the new orientation.
		this._layout = undefined;
		this.invalidateStatic();
	}

	@property({ type: Object })
	visibleDays: { top: number; bottom: number } | undefined;

	private _lastVisibleTop: number | undefined;
	private _lastVisibleBottom: number | undefined;

	@observe('visibleDays')
	private onVisibleDaysChanged() {
		// `graph-app` re-renders with a fresh `{...visibleDays}` clone each pass (by necessity — the
		// upstream signal proxy has stable identity), so this observer would otherwise fire on every
		// host re-render. Short-circuit when top/bottom are unchanged so the hot scroll path stops
		// scheduling no-op rAFs.
		const top = this.visibleDays?.top;
		const bottom = this.visibleDays?.bottom;
		if (top === this._lastVisibleTop && bottom === this._lastVisibleBottom) return;
		this._lastVisibleTop = top;
		this._lastVisibleBottom = bottom;
		this.requestDraw();
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this._resizeObserver = new ResizeObserver(entries => {
			const rect = entries[0]?.contentRect;
			if (rect == null) return;
			const w = Math.round(rect.width);
			const h = Math.round(rect.height);
			// Any resize (including parent split-panel drags) potentially shifts the canvas origin,
			// so drop the cached bounding rect so the next pointer event re-reads it.
			this._canvasRect = undefined;
			if (w !== this._observedWidth || h !== this._observedHeight) {
				this._observedWidth = w;
				this._observedHeight = h;
				this.style.setProperty('--minimap-height', `${h}px`);
				this.invalidateStatic();
			}
		});
		this._resizeObserver.observe(this);

		this._themeDisposable = onDidChangeTheme(() => {
			this._cachedTheme = undefined;
			this.invalidateStatic();
		});

		window.addEventListener('keydown', this.onWindowKeyDown);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;

		this._themeDisposable?.dispose();
		this._themeDisposable = undefined;

		window.removeEventListener('keydown', this.onWindowKeyDown);

		if (this._drawRAF != null) {
			cancelAnimationFrame(this._drawRAF);
			this._drawRAF = undefined;
		}

		// Drop the offscreen buffer + theme cache; both are lazily rebuilt on the next attach.
		this._staticCanvas = undefined;
		this._staticCtx = null;
		this._cachedTheme = undefined;
	}

	override firstUpdated(): void {
		this._ctx = this.canvas.getContext('2d');
		this.updateSpinner();
		this.requestDraw();
	}

	select(date: number | Date | undefined, trackOnly: boolean = false): void {
		if (date == null) {
			this.unselect(undefined, trackOnly);
			return;
		}
		const day = getDay(date);
		if (trackOnly) {
			// Transient hover — e.g., graph row hover shadows through to the minimap without touching
			// the persistent selection.
			if (this._hoverDay !== day) {
				this._hoverDay = day;
				this.requestDraw();
			}
		} else {
			this.activeDay = day;
		}
	}

	unselect(_date?: number | Date, focus: boolean = false): void {
		if (focus) {
			// Clear only the transient hover; keep the persistent selection pinned.
			if (this._hoverDay !== undefined) {
				this._hoverDay = undefined;
				this.requestDraw();
			}
		} else {
			this.activeDay = undefined;
		}
	}

	private rebuildViewModel() {
		if (!this.data?.size) {
			this._viewModel = undefined;
			return;
		}
		const todayMidnight = new Date().setHours(0, 0, 0, 0);
		this._viewModel = buildViewModel(this.data, this.dataType, todayMidnight);
	}

	private rebuildZoomedViewModel() {
		if (this._viewModel == null || this._zoomOldest == null || this._zoomNewest == null) {
			this._zoomedViewModel = undefined;
			return;
		}
		// Source data may have shrunk or a day-boundary roll-over may have moved the full-timeline
		// bounds; re-clamp the zoom window before re-slicing and reset to unzoomed if the intersection
		// is empty or too narrow to be meaningful.
		const fullOldest = this._viewModel.days.at(-1)!;
		const fullNewest = this._viewModel.days[0];
		const newest = Math.min(this._zoomNewest, fullNewest);
		const oldest = Math.max(this._zoomOldest, fullOldest);
		if (newest - oldest < minZoomRangeMs) {
			this.resetZoom();
			return;
		}
		this._zoomOldest = oldest;
		this._zoomNewest = newest;
		this._zoomedViewModel = sliceViewModel(this._viewModel, oldest, newest);
	}

	get isZoomed(): boolean {
		return this._zoomedViewModel != null;
	}

	private get activeViewModel(): MinimapViewModel | undefined {
		return this._zoomedViewModel ?? this._viewModel;
	}

	applyZoom(oldest: number, newest: number): void {
		if (this._viewModel == null) return;
		const fullOldest = this._viewModel.days.at(-1)!;
		const fullNewest = this._viewModel.days[0];

		// Enforce the 7-day floor with centered widening, then clamp to the full timeline. Clamping
		// after widening preserves the minimum width even at the extreme ends of the timeline.
		let zoomOldest = oldest;
		let zoomNewest = newest;
		if (zoomNewest - zoomOldest < minZoomRangeMs) {
			const center = (zoomOldest + zoomNewest) / 2;
			zoomOldest = center - minZoomRangeMs / 2;
			zoomNewest = center + minZoomRangeMs / 2;
		}
		if (zoomNewest > fullNewest) {
			const shift = zoomNewest - fullNewest;
			zoomNewest -= shift;
			zoomOldest -= shift;
		}
		if (zoomOldest < fullOldest) {
			const shift = fullOldest - zoomOldest;
			zoomOldest += shift;
			zoomNewest += shift;
		}
		zoomOldest = Math.max(zoomOldest, fullOldest);
		zoomNewest = Math.min(zoomNewest, fullNewest);
		if (zoomNewest - zoomOldest < minZoomRangeMs) {
			// Full timeline is narrower than the minimum zoom window — nothing worth zooming to.
			return;
		}

		const wasZoomed = this._zoomedViewModel != null;
		this._zoomOldest = zoomOldest;
		this._zoomNewest = zoomNewest;
		this._zoomedViewModel = sliceViewModel(this._viewModel, zoomOldest, zoomNewest);
		this._scrollbarTargetOpacity = 1;
		// Zoom window shifts invalidate every projection in the static layer — bar positions, marker
		// positions, search-result bars, the activity spline — so rebuild on commit/pan/page-jump.
		this.invalidateStatic();
		if (!wasZoomed) {
			this.emit('gl-graph-minimap-zoom-change', { zoomed: true });
		}
	}

	resetZoom(): void {
		if (this._zoomedViewModel == null) return;
		this._zoomOldest = undefined;
		this._zoomNewest = undefined;
		this._zoomedViewModel = undefined;
		this._scrollbarTargetOpacity = 0;
		this._scrollbarHover = false;
		this.invalidateStatic();
		this.emit('gl-graph-minimap-zoom-change', { zoomed: false });
	}

	private commitBrush(startX: number, endX: number): void {
		const active = this.activeViewModel;
		if (active == null || this._layout == null) return;

		const tsAtLo = xToTimestamp(Math.min(startX, endX), active, this._layout);
		const tsAtHi = xToTimestamp(Math.max(startX, endX), active, this._layout);
		if (tsAtLo == null || tsAtHi == null) return;

		// Smaller x = newer day; larger x = older. Normalize into oldest/newest regardless.
		this.applyZoom(Math.min(tsAtLo, tsAtHi), Math.max(tsAtLo, tsAtHi));
	}

	private applyThumbDrag(deltaX: number): void {
		if (
			this._viewModel == null ||
			this._layout == null ||
			this._thumbDragStartOldest == null ||
			this._thumbDragStartNewest == null
		) {
			return;
		}
		const fullOldest = this._viewModel.days.at(-1)!;
		const fullNewest = this._viewModel.days[0];
		if (fullNewest <= fullOldest) return;
		const shift = scrollbarDeltaToTimestampShift(deltaX, fullOldest, fullNewest, this._layout);

		const width = this._thumbDragStartNewest - this._thumbDragStartOldest;
		let newest = this._thumbDragStartNewest + shift;
		let oldest = this._thumbDragStartOldest + shift;
		// Clamp the whole window instead of each edge independently so the window's width doesn't
		// collapse when it hits a timeline edge — it slides against the edge and stays the same size.
		if (newest > fullNewest) {
			newest = fullNewest;
			oldest = newest - width;
		}
		if (oldest < fullOldest) {
			oldest = fullOldest;
			newest = oldest + width;
		}
		this.applyZoom(oldest, newest);
	}

	private pageJump(side: 'newer' | 'older'): void {
		if (this._zoomOldest == null || this._zoomNewest == null || this._viewModel == null) return;
		const fullOldest = this._viewModel.days.at(-1)!;
		const fullNewest = this._viewModel.days[0];
		const width = this._zoomNewest - this._zoomOldest;
		let oldest: number;
		let newest: number;
		if (side === 'newer') {
			newest = Math.min(fullNewest, this._zoomNewest + width);
			oldest = newest - width;
		} else {
			oldest = Math.max(fullOldest, this._zoomOldest - width);
			newest = oldest + width;
		}
		this.applyZoom(oldest, newest);
	}

	private updateSpinner() {
		const hidden = this.data != null && !this.loading;
		this.spinner?.setAttribute('aria-hidden', hidden ? 'true' : 'false');
	}

	private requestDraw() {
		if (this._drawRAF != null) return;
		this._drawRAF = requestAnimationFrame(() => {
			this._drawRAF = undefined;
			this.drawNow();
		});
	}

	private invalidateStatic() {
		this._staticDirty = true;
		this.requestDraw();
	}

	@debug({ onlyExit: true })
	private drawNow() {
		if (this._ctx == null || this._observedWidth === 0 || this._observedHeight === 0) return;
		const dpr = window.devicePixelRatio || 1;
		if (this._viewModel == null) {
			const backingW = Math.round(this._observedWidth * dpr);
			const backingH = Math.round(this._observedHeight * dpr);
			if (this.canvas.width !== backingW) {
				this.canvas.width = backingW;
			}
			if (this.canvas.height !== backingH) {
				this.canvas.height = backingH;
			}
			this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			this._ctx.clearRect(0, 0, this._observedWidth, this._observedHeight);
			this._staticDirty = true;
			return;
		}

		// Advance the scrollbar fade one step per frame and re-schedule until it settles; the rest
		// of this method uses whatever value the animation lands on this frame.
		if (this._scrollbarOpacity !== this._scrollbarTargetOpacity) {
			if (this._scrollbarOpacity < this._scrollbarTargetOpacity) {
				this._scrollbarOpacity = Math.min(
					this._scrollbarTargetOpacity,
					this._scrollbarOpacity + scrollbarFadeStep,
				);
			} else {
				this._scrollbarOpacity = Math.max(
					this._scrollbarTargetOpacity,
					this._scrollbarOpacity - scrollbarFadeStep,
				);
			}
			if (this._scrollbarOpacity !== this._scrollbarTargetOpacity) {
				this.requestDraw();
			}
		}

		const activeVM = this._zoomedViewModel ?? this._viewModel;
		const cssWidth = this.canvas.clientWidth;
		const cssHeight = this.canvas.clientHeight || this._observedHeight;
		// Reuse the existing layout object when the inputs are unchanged — this runs every rAF during
		// scroll/hover/fade/brush, so skipping the allocation matters on a hot canvas surface.
		const dayCount = activeVM.days.length;
		if (
			this._layout?.width !== cssWidth ||
			this._layout.height !== cssHeight ||
			this._layout.dpr !== dpr ||
			this._lastLayoutDayCount !== dayCount
		) {
			this._layout = computeLayout(cssWidth, cssHeight, dpr, dayCount, this.reversed);
			this._lastLayoutDayCount = dayCount;
		}

		let theme = this._cachedTheme;
		if (theme == null) {
			theme = this.resolveTheme();
			this._cachedTheme = theme;
			// Fresh theme resolution means either first paint or a theme-change invalidation —
			// either way the static layer needs to pick up the new colors.
			this._staticDirty = true;
		}

		const backingW = Math.round(cssWidth * dpr);
		const backingH = Math.round(cssHeight * dpr);
		const sizeChanged = this._lastBackingW !== backingW || this._lastBackingH !== backingH;
		if (sizeChanged) {
			this._lastBackingW = backingW;
			this._lastBackingH = backingH;
			this._staticDirty = true;
		}
		// Writing `canvas.width`/`canvas.height` resets the 2D context state (transform, fill/stroke
		// styles), so we only assign on actual backing-size change and skip `setTransform` when size
		// is stable — the transform from the previous frame is still in effect.
		if (this.canvas.width !== backingW) {
			this.canvas.width = backingW;
		}
		if (this.canvas.height !== backingH) {
			this.canvas.height = backingH;
		}

		// Mutate the persistent scratch state in place — avoids allocating a fresh draw-state object
		// plus two inner range objects every rAF on the hot canvas path.
		const state = this._drawState;
		state.viewModel = activeVM;
		state.layout = this._layout;
		state.markersByDay = this.markers;
		state.searchResultsByDay = this.searchResults;
		state.visibleDays = this.visibleDays;
		state.activeDay = this._activeDayNormalized;
		state.hoverDay = this._hoverDay;
		state.theme = theme;
		state.loading = this.loading;
		state.fullTimelineOldest = this._viewModel.days.at(-1)!;
		state.fullTimelineNewest = this._viewModel.days[0];
		if (this._zoomOldest != null && this._zoomNewest != null) {
			this._zoomRangeScratch.oldest = this._zoomOldest;
			this._zoomRangeScratch.newest = this._zoomNewest;
			state.zoomRange = this._zoomRangeScratch;
		} else {
			state.zoomRange = undefined;
		}
		if (this._brushing && this._pointerDownX != null && this._brushCurrentX != null) {
			this._brushRangeScratch.startX = this._pointerDownX;
			this._brushRangeScratch.endX = this._brushCurrentX;
			state.brushRange = this._brushRangeScratch;
		} else {
			state.brushRange = undefined;
		}
		state.scrollbarOpacity = this._scrollbarOpacity;
		state.scrollbarHover = this._scrollbarHover;

		// Static layer: cached offscreen, rebuilt only when data/markers/search/theme/layout changed
		if (this._staticCanvas == null) {
			this._staticCanvas = document.createElement('canvas');
			this._staticCtx = this._staticCanvas.getContext('2d');
		}
		let staticSizeChanged = false;
		if (this._staticCanvas.width !== backingW) {
			this._staticCanvas.width = backingW;
			this._staticDirty = true;
			staticSizeChanged = true;
		}
		if (this._staticCanvas.height !== backingH) {
			this._staticCanvas.height = backingH;
			this._staticDirty = true;
			staticSizeChanged = true;
		}
		if (this._staticDirty && this._staticCtx != null) {
			// Only reset the transform after a size write (which clears it) — subsequent rebuilds at
			// the same size reuse the still-active transform from the previous rebuild.
			if (staticSizeChanged) {
				this._staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
			}
			this._staticCtx.clearRect(0, 0, cssWidth, cssHeight);
			drawStatic(this._staticCtx, state);
			this._staticDirty = false;
		}

		// Main canvas: blit the static cache, then draw the overlay on top. The `drawImage` fully
		// covers the main canvas (static paints its own background first), so no `clearRect` is
		// needed — save one canvas op per frame.
		if (sizeChanged) {
			this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		if (this._staticCanvas != null) {
			this._ctx.drawImage(this._staticCanvas, 0, 0, cssWidth, cssHeight);
		}
		drawOverlay(this._ctx, state);
	}

	private resolveTheme(): MinimapTheme {
		const style = getComputedStyle(this);
		return {
			background: getCssVariable('--color-graph-background', style),
			line: getCssVariable('--color-graph-minimap-line0', style),
			focusLine: getCssVariable('--color-graph-minimap-focusLine', style),
			markerHead: getCssVariable('--color-graph-minimap-marker-head', style),
			markerUpstream: getCssVariable('--color-graph-minimap-marker-upstream', style),
			markerWorktree: getCssVariable('--color-graph-minimap-marker-worktree', style),
			markerLocalBranches: getCssVariable('--color-graph-minimap-marker-local-branches', style),
			markerRemoteBranches: getCssVariable('--color-graph-minimap-marker-remote-branches', style),
			markerPullRequests: getCssVariable('--color-graph-minimap-marker-pull-requests', style),
			markerStashes: getCssVariable('--color-graph-minimap-marker-stashes', style),
			markerTags: getCssVariable('--color-graph-minimap-marker-tags', style),
			markerHighlights: getCssVariable('--color-graph-minimap-marker-highlights', style),
			scrollThumb: getCssVariable('--vscode-scrollbarSlider-background', style),
			scrollThumbHover: getCssVariable('--vscode-scrollbarSlider-hoverBackground', style),
		};
	}

	// Best-effort pointer-capture release — the pointer may not have been captured (e.g. pointercancel
	// raced pointerup) and DOM throws rather than reporting. Callers don't care either way.
	private safeReleasePointerCapture(pointerId: number): void {
		try {
			this.canvas.releasePointerCapture(pointerId);
		} catch {
			// noop
		}
	}

	private onPointerDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		if (this._viewModel == null || this._layout == null) return;
		const rect = this.canvasRect;
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		// Scrollbar region is only interactive while the zoom is live (fade-out phase is ignored so
		// a click during the brief disappearing animation still hits the main minimap).
		if (
			this.isZoomed &&
			this._zoomOldest != null &&
			this._zoomNewest != null &&
			y >= this._layout.height - scrollbarHeightPx
		) {
			const fullOldest = this._viewModel.days.at(-1)!;
			const fullNewest = this._viewModel.days[0];
			const hit = hitTestScrollbar(
				x,
				y,
				this._layout,
				{ oldest: this._zoomOldest, newest: this._zoomNewest },
				fullOldest,
				fullNewest,
			);
			if (hit?.kind === 'thumb') {
				this._thumbDragging = true;
				this._thumbDragStartX = x;
				this._thumbDragStartOldest = this._zoomOldest;
				this._thumbDragStartNewest = this._zoomNewest;
				this.canvas.setPointerCapture(e.pointerId);
				e.preventDefault();
			} else if (hit?.kind === 'track') {
				this.pageJump(hit.side);
			}
			return;
		}

		// Minimap body: start a potential click or brush. Capture the pointer so a brush that leaves
		// the canvas mid-drag still delivers pointermove/pointerup to us.
		this._pointerDownX = x;
		this._brushing = false;
		this._brushCurrentX = undefined;
		this.canvas.setPointerCapture(e.pointerId);
	};

	private onPointerMove = (e: PointerEvent) => {
		if (this._viewModel == null || this._layout == null) return;
		const rect = this.canvasRect;
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		if (this._thumbDragging && this._thumbDragStartX != null) {
			this.applyThumbDrag(x - this._thumbDragStartX);
			return;
		}

		if (this._pointerDownX != null) {
			const dx = Math.abs(x - this._pointerDownX);
			if (this._brushing || dx > brushThresholdPx) {
				if (!this._brushing) {
					this._brushing = true;
					this.hideTooltip();
					if (this._hoverDay !== undefined) {
						this._hoverDay = undefined;
					}
				}
				this._brushCurrentX = x;
				this.requestDraw();
				return;
			}
			// Below the brush threshold — fall through to hover behavior so a slow click doesn't
			// stop updating the hover indicator.
		}

		// Suppress chart-scrubbing (hover focus line, dot, tooltip) while the pointer is over the
		// scrollbar region — that zone is reserved for zoom navigation and reading day values of the
		// chart from it is misleading when the pointer isn't actually over the chart.
		const overScrollbar = this.isZoomed && y >= this._layout.height - scrollbarHeightPx;
		if (overScrollbar !== this._scrollbarHover) {
			this._scrollbarHover = overScrollbar;
			this.requestDraw();
		}
		if (overScrollbar) {
			if (this._hoverDay !== undefined) {
				this._hoverDay = undefined;
				this.requestDraw();
			}
			this.hideTooltip();
			return;
		}

		const active = this.activeViewModel;
		if (active == null) return;
		const day = xToDay(x, active, this._layout);
		if (day == null) {
			if (this._hoverDay !== undefined) {
				this._hoverDay = undefined;
				this.requestDraw();
			}
			this.hideTooltip();
			return;
		}
		const dayChanged = day !== this._hoverDay;
		this._hoverDay = day;
		if (dayChanged) {
			this.populateTooltipContent(this.tooltipEl, day);
			this.tooltipEl.setAttribute('data-visible', 'true');
			this.requestDraw();
		}
		this.repositionTooltip(x);
	};

	private onPointerUp = (e: PointerEvent) => {
		this.safeReleasePointerCapture(e.pointerId);

		if (this._thumbDragging) {
			this._thumbDragging = false;
			this._thumbDragStartX = undefined;
			this._thumbDragStartOldest = undefined;
			this._thumbDragStartNewest = undefined;
			return;
		}

		if (this._brushing && this._pointerDownX != null && this._brushCurrentX != null) {
			this.commitBrush(this._pointerDownX, this._brushCurrentX);
			this._pointerDownX = undefined;
			this._brushCurrentX = undefined;
			this._brushing = false;
			return;
		}

		// Bare click — map against the active (possibly zoomed) view model.
		if (this._pointerDownX != null && this._layout != null) {
			const active = this.activeViewModel;
			const x = e.clientX - this.canvasRect.left;
			this._pointerDownX = undefined;
			if (active == null) return;
			const day = xToDay(x, active, this._layout);
			if (day == null) return;
			const sha = this.searchResults?.get(day)?.sha ?? this.data?.get(day)?.sha;
			queueMicrotask(() => {
				this.emit('gl-graph-minimap-selected', { date: new Date(day), sha: sha });
			});
		}
	};

	private onPointerCancel = (e: PointerEvent) => {
		this.safeReleasePointerCapture(e.pointerId);
		this._thumbDragging = false;
		this._thumbDragStartX = undefined;
		this._thumbDragStartOldest = undefined;
		this._thumbDragStartNewest = undefined;
		this._pointerDownX = undefined;
		this._brushing = false;
		this._brushCurrentX = undefined;
		this.requestDraw();
	};

	private onPointerLeave = () => {
		// Keep brush/thumb state intact — pointer capture will keep events flowing to us — but clear
		// the passive hover indicator so it doesn't linger after the pointer exits the canvas.
		if (this._brushing || this._thumbDragging) return;
		if (this._hoverDay !== undefined) {
			this._hoverDay = undefined;
			this.requestDraw();
		}
		if (this._scrollbarHover) {
			this._scrollbarHover = false;
			this.requestDraw();
		}
		this.hideTooltip();
	};

	private onDblClick = (e: MouseEvent) => {
		// Any double-click inside the minimap resets the zoom — the scrollbar track is still the
		// most discoverable reset target, but restricting only to it is frustrating in practice.
		if (!this.isZoomed) return;
		e.preventDefault();
		this.resetZoom();
	};

	private onWindowKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.isZoomed) {
			this.resetZoom();
		}
	};

	private get canvasRect(): DOMRect {
		return (this._canvasRect ??= this.canvas.getBoundingClientRect());
	}

	private onWheel = (e: WheelEvent) => {
		if (this._viewModel == null) return;
		const deltaY =
			e.deltaMode === WheelEvent.DOM_DELTA_LINE
				? e.deltaY * wheelLineHeightPx
				: e.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? e.deltaY * wheelPageHeightPx
					: e.deltaY;
		if (deltaY === 0) return;
		e.preventDefault();
		this.emit('gl-graph-minimap-wheel', { deltaY: deltaY });
	};

	private hideTooltip() {
		if (this.tooltipEl != null) {
			this.tooltipEl.setAttribute('data-visible', 'false');
		}
	}

	private repositionTooltip(pointerX: number) {
		const hostWidth = this.clientWidth;
		const tooltipWidth = this.tooltipEl.offsetWidth;
		const x = Math.max(0, Math.min(pointerX - tooltipWidth / 2, hostWidth - tooltipWidth));
		this.tooltipEl.style.transform = `translateX(${x}px)`;
	}

	private populateTooltipContent(el: HTMLElement, day: number): void {
		const stat = this.data?.get(day);
		const markers = this.markers?.get(day);
		const results = this.searchResults?.get(day);

		let groups: Map<GraphMinimapMarker['type'], GraphMinimapMarker[]> | undefined;
		if (markers?.length) {
			groups = groupByMap(markers, m => m.type);
		}

		const stashesCount = groups?.get('stash')?.length ?? 0;
		const pullRequestsCount = groups?.get('pull-request')?.length ?? 0;

		const date = new Date(day);
		const doc = el.ownerDocument;

		// Clear previous content
		el.replaceChildren();

		// Header
		const header = doc.createElement('div');
		header.className = 'header';
		const title = doc.createElement('span');
		title.className = 'header--title';
		title.textContent = formatDate(date, 'MMMM Do, YYYY');
		const desc = doc.createElement('span');
		desc.className = 'header--description';
		desc.textContent = `(${capitalize(fromNow(date))})`;
		header.append(title, desc);
		el.append(header);

		// Changes summary
		const changes = doc.createElement('div');
		changes.className = 'changes';
		const changesSpan = doc.createElement('span');
		if (stat?.commits) {
			let text = pluralize('commit', stat.commits, { format: c => formatNumeric(c) });
			if (this.dataType === 'lines') {
				text += `, ${pluralize('file', stat.files ?? 0, {
					format: c => formatNumeric(c),
					zero: 'No',
				})}, ${pluralize('line', (stat.activity?.additions ?? 0) + (stat.activity?.deletions ?? 0), {
					format: c => formatNumeric(c),
					zero: 'No',
				})} changed`;
			}
			changesSpan.textContent = text;
		} else {
			changesSpan.textContent = 'No commits';
		}
		changes.append(changesSpan);
		el.append(changes);

		// Search results count
		if (stat?.commits && results?.count) {
			const resultsDiv = doc.createElement('div');
			resultsDiv.className = 'results';
			const resultSpan = doc.createElement('span');
			resultSpan.className = 'result';
			resultSpan.textContent = pluralize('matching commit', results.count);
			resultsDiv.append(resultSpan);
			el.append(resultsDiv);
		}

		if (groups != null) {
			// Refs row 1: stashes + branches + worktrees (HEAD-class refs grouped together)
			const refs1 = doc.createElement('div');
			refs1.className = 'refs';
			if (stashesCount > 0) {
				const s = doc.createElement('span');
				s.className = 'stash';
				s.textContent = pluralize('stash', stashesCount, { plural: 'stashes' });
				refs1.append(s);
			}
			const branches = groups.get('branch');
			if (branches != null) {
				const sorted = branches.toSorted((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1));
				for (const m of sorted) {
					const s = doc.createElement('span');
					s.className = m.current ? 'branch current' : 'branch';
					s.textContent = m.name;
					refs1.append(s);
				}
			}
			const worktrees = groups.get('worktree');
			if (worktrees != null) {
				for (const m of worktrees) {
					const s = doc.createElement('span');
					s.className = 'worktree';
					s.textContent = m.name;
					refs1.append(s);
				}
			}
			el.append(refs1);

			// Refs row 2: pull-requests + remotes + tags
			const refs2 = doc.createElement('div');
			refs2.className = 'refs';
			if (pullRequestsCount > 0) {
				const s = doc.createElement('span');
				s.className = 'pull-request';
				s.textContent = pluralize('pull request', pullRequestsCount, { plural: 'pull requests' });
				refs2.append(s);
			}
			const remotes = groups.get('remote');
			if (remotes != null) {
				const sorted = remotes.toSorted((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1));
				for (const m of sorted) {
					const s = doc.createElement('span');
					s.className = m.current ? 'remote current' : 'remote';
					s.textContent = m.name;
					refs2.append(s);
				}
			}
			const tags = groups.get('tag');
			if (tags != null) {
				for (const m of tags) {
					const s = doc.createElement('span');
					s.className = 'tag';
					s.textContent = m.name;
					refs2.append(s);
				}
			}
			el.append(refs2);
		}
	}

	override render(): unknown {
		return html`
			<canvas
				id="canvas"
				@pointerdown=${this.onPointerDown}
				@pointermove=${this.onPointerMove}
				@pointerup=${this.onPointerUp}
				@pointercancel=${this.onPointerCancel}
				@pointerleave=${this.onPointerLeave}
				@dblclick=${this.onDblClick}
				@wheel=${{ handleEvent: this.onWheel, passive: false }}
			></canvas>
			<div id="tooltip" data-visible="false"></div>
			<div id="spinner"><code-icon icon="loading" modifier="spin"></code-icon></div>
		`;
	}
}
