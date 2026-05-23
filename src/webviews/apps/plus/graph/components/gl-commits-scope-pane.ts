import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { elementBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { commitsScopePaneStyles } from './gl-commits-scope-pane.css.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/formatted-date.js';
import '../../../shared/components/overlays/tooltip.js';

export type ScopeItemState = 'uncommitted' | 'unpushed' | 'pushed' | 'merge-base' | 'load-more';

export interface ScopeItem {
	id: string;
	label: string;
	fileCount?: number;
	additions?: number;
	deletions?: number;
	modified?: number;
	state: ScopeItemState;
	author?: string;
	avatarUrl?: string;
	date?: number;
}

export interface ScopeChangeDetail {
	selectedIds: string[];
}

@customElement('gl-commits-scope-pane')
export class GlCommitsScopePane extends LitElement {
	static override styles = [elementBase, scrollableBase, commitsScopePaneStyles];

	@property({ type: Array })
	items: ScopeItem[] = [];

	@property({ type: Boolean })
	loading = false;

	/** 'compose' = top fixed, bottom draggable. 'review' = both draggable. */
	@property()
	mode: 'compose' | 'review' = 'compose';

	/** Controlled selected IDs from the current ScopeSelection. Must represent a contiguous range. */
	@property({ type: Array })
	selection?: readonly string[];

	// Range is stored as item IDs so selection survives item list updates.
	@state() private _userRangeStartId: string | undefined;
	@state() private _userRangeEndId: string | undefined;
	@state() private _dragging: 'start' | 'end' | undefined;
	@state() private _dragPreview: number | undefined;
	@state() private _startHandleOffscreen = false;
	@state() private _endHandleOffscreen = false;

	private _scrollInterval: ReturnType<typeof setInterval> | undefined;
	private _scrollSpeed = 0;
	// Non-reactive: set by keyboard/click handlers, consumed in `updated()` to do
	// focus + scroll synchronously BEFORE recomputeHandleVisibility runs. If we
	// deferred via rAF, recompute would see the pre-scroll positions and briefly
	// flip an offscreen flag → proxy renders → user sees a flash before the rAF
	// scrolls things back into place.
	private _pendingKeyboardFocus: 'row-end' | 'row-end-keep-viewport' | 'handle-start' | 'handle-end' | undefined;
	private _dragAc: AbortController | undefined;
	private _scrollAc: AbortController | undefined;
	private _previousBodyCursor: string | undefined;
	private _dragMoveRaf: number | undefined;
	private _visibilityRaf: number | undefined;
	private _lastDragMoveEvent: PointerEvent | undefined;
	private _dragStartY: number | undefined;
	private _dragHysteresisCleared = false;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'list');
		this.setAttribute('aria-label', 'Scope');
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._dragAc?.abort();
		this._dragAc = undefined;
		this._scrollAc?.abort();
		this._scrollAc = undefined;
		this.stopScrolling();
		this.restoreBodyCursor();
		if (this._dragMoveRaf != null) {
			cancelAnimationFrame(this._dragMoveRaf);
			this._dragMoveRaf = undefined;
		}
		if (this._visibilityRaf != null) {
			cancelAnimationFrame(this._visibilityRaf);
			this._visibilityRaf = undefined;
		}
		this._lastDragMoveEvent = undefined;
		this._dragStartY = undefined;
		this._dragHysteresisCleared = false;
	}

	override firstUpdated(): void {
		this.scrollEndHandleIntoView();
		this.attachScrollListener();
		this.recomputeHandleVisibility();
	}

	private attachScrollListener(): void {
		const scrollContainer = this.renderRoot.querySelector<HTMLElement>('.details-scope-pane');
		if (scrollContainer == null) return;

		this._scrollAc?.abort();
		const ac = new AbortController();
		this._scrollAc = ac;

		scrollContainer.addEventListener(
			'scroll',
			() => {
				if (this._visibilityRaf != null) return;

				this._visibilityRaf = requestAnimationFrame(() => {
					this._visibilityRaf = undefined;
					this.recomputeHandleVisibility();
				});
			},
			{ signal: ac.signal, passive: true },
		);
	}

	private recomputeHandleVisibility(): void {
		// Skip during drag — proxies should not flicker in/out as the active
		// handle moves and edge-scroll keeps it in view anyway.
		if (this._dragging) return;

		const scrollContainer = this.renderRoot.querySelector<HTMLElement>('.details-scope-pane');
		if (scrollContainer == null) return;

		const containerRect = scrollContainer.getBoundingClientRect();
		const startHandle = this.findHandle('start');
		const endHandle = this.findHandle('end');

		// Hysteresis: when a proxy is currently rendered it occupies its flow space (sticky
		// elements still take their natural flow position), pushing the real handle down by
		// the proxy's height. Without hysteresis, the moment the real handle was "in view"
		// would flip _Offscreen to false, the next render would drop the proxy, the layout
		// would shift back up, the real handle would disappear again, and the proxy would
		// re-show — both visible during the oscillation. Use the rendered proxy's edge as
		// the hide threshold, so the proxy stays put until the real handle is clear of the
		// proxy's footprint, not merely clear of the container's edge.
		const startProxy = this.renderRoot.querySelector<HTMLElement>('.scope-handle--proxy-start');
		const endProxy = this.renderRoot.querySelector<HTMLElement>('.scope-handle--proxy-end');
		const startThreshold = startProxy != null ? startProxy.getBoundingClientRect().bottom : containerRect.top;
		const endThreshold = endProxy != null ? endProxy.getBoundingClientRect().top : containerRect.bottom;

		const isStartOffscreen = (handle: HTMLElement | null): boolean => {
			if (handle == null) return false;
			return handle.getBoundingClientRect().bottom <= startThreshold;
		};
		const isEndOffscreen = (handle: HTMLElement | null): boolean => {
			if (handle == null) return false;
			return handle.getBoundingClientRect().top >= endThreshold;
		};

		const startOff = isStartOffscreen(startHandle);
		const endOff = isEndOffscreen(endHandle);
		if (startOff !== this._startHandleOffscreen) {
			this._startHandleOffscreen = startOff;
		}
		if (endOff !== this._endHandleOffscreen) {
			this._endHandleOffscreen = endOff;
		}
	}

	override updated(changedProperties: Map<string, unknown>): void {
		// Only re-scroll when items go from empty → populated (late branchCommits arrival).
		// Skip during user drag, and skip on selection-only changes — that would yank the
		// viewport after every drag end.
		if (this._dragging) {
			return;
		}

		if (changedProperties.has('items')) {
			const prev = changedProperties.get('items') as ScopeItem[] | undefined;
			if (!prev?.length && this.items.length > 0) {
				this.scrollEndHandleIntoView();
			}
		}

		// Consume any pending keyboard/click focus *before* visibility recompute.
		// Doing the scroll first means recompute sees post-scroll handle positions
		// and won't briefly flip an offscreen flag (which would render a proxy for
		// 1–2 frames before the deferred scroll catches up).
		const pending = this._pendingKeyboardFocus;
		this._pendingKeyboardFocus = undefined;
		if (pending === 'row-end') {
			this.focusEndEdgeRow();
		} else if (pending === 'row-end-keep-viewport') {
			this.focusEndEdgeRow({ scroll: false });
		} else if (pending === 'handle-start' || pending === 'handle-end') {
			const type = pending === 'handle-start' ? 'start' : 'end';
			this.focusHandle(type);
			this.scrollActiveHandleIntoView(type);
		}

		// Refresh proxy visibility after every render — handle DOM nodes can be
		// recreated as the active range shifts (the .map() is unkeyed) so a
		// node-bound IntersectionObserver would miss replacements.
		this.recomputeHandleVisibility();
	}

	private scrollEndHandleIntoView(): void {
		requestAnimationFrame(() => {
			const handle = this.findHandle('end');
			if (handle != null) {
				this.scrollHandleIntoView(handle, 'end');
			}
		});
	}

	/**
	 * Scrolls the scope-pane container so `handle` is aligned with its `start` or `end` edge.
	 *
	 * Avoids `Element.scrollIntoView`, which walks every scroll ancestor and aligns each one —
	 * tapping a proxy or scrolling on initial mount would otherwise scroll the graph webview
	 * (and any other scrollable ancestor) up or down instead of just the scope pane.
	 */
	private scrollHandleIntoView(handle: HTMLElement, align: 'start' | 'end'): void {
		const scrollContainer = this.renderRoot.querySelector<HTMLElement>('.details-scope-pane');
		if (scrollContainer == null) return;

		const handleRect = handle.getBoundingClientRect();
		const containerRect = scrollContainer.getBoundingClientRect();
		const handleTop = scrollContainer.scrollTop + (handleRect.top - containerRect.top);
		scrollContainer.scrollTop =
			align === 'start' ? handleTop : handleTop + handleRect.height - containerRect.height;
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		// When the items list changes (e.g. WIP tick reorders / adds / removes commits), drop
		// any stored range IDs that no longer resolve so the picker silently falls back to its
		// auto-derived defaults instead of clamping to a stale ID. We deliberately do NOT
		// re-emit `scope-change` here — only user drag (`_onDragEnd`) is a legitimate emit
		// site. Re-emitting on every items-ref change couples unrelated graph-state ticks to
		// scope-file refetches and the host-graph re-render path.
		if ((changedProperties.has('items') || changedProperties.has('selection')) && !this._dragging) {
			if (this.selection != null) {
				this.syncSelectionRange();
				return;
			}

			if (this._userRangeStartId != null && !this.items.some(i => i.id === this._userRangeStartId)) {
				this._userRangeStartId = undefined;
			}
			if (this._userRangeEndId != null && !this.items.some(i => i.id === this._userRangeEndId)) {
				this._userRangeEndId = undefined;
			}
		}
	}

	/** Returns the intrinsic content height in pixels (for constraining external split panels). */
	get contentHeight(): number {
		return this.renderRoot.querySelector<HTMLElement>('.details-scope-pane')?.scrollHeight ?? 0;
	}

	/** Returns IDs of items within the selected range. */
	get selectedIds(): string[] {
		const start = this.rangeStart;
		const end = this.rangeEnd;
		return this.items.filter((_item, i) => i >= start && i <= end).map(i => i.id);
	}

	/** Reset any user-set range so the picker goes back to auto-derived defaults. */
	reset(): void {
		this._userRangeStartId = undefined;
		this._userRangeEndId = undefined;
	}

	private syncSelectionRange(): void {
		if (!this.selection?.length) {
			this._userRangeStartId = undefined;
			this._userRangeEndId = undefined;
			return;
		}

		const selected = new Set(this.selection);
		let start = -1;
		let end = -1;
		for (let i = 0; i < this.items.length; i++) {
			if (!selected.has(this.items[i].id)) continue;

			if (start === -1) {
				start = i;
			}
			end = i;
		}
		if (start === -1 || end === -1) return;

		this._userRangeStartId = this.items[start].id;
		this._userRangeEndId = this.items[end].id;
	}

	/** Effective start: resolves stored ID to index, falls back to default-start. */
	private get rangeStart(): number {
		if (this._userRangeStartId != null) {
			const idx = this.items.findIndex(item => item.id === this._userRangeStartId);
			return idx >= 0 ? idx : this.defaultStart;
		}
		return this.defaultStart;
	}

	/** Effective end: resolves stored ID to index, falls back to default-end. */
	private get rangeEnd(): number {
		if (this._userRangeEndId != null) {
			const idx = this.items.findIndex(item => item.id === this._userRangeEndId);
			return idx >= 0 ? idx : this.defaultEnd;
		}
		return this.defaultEnd;
	}

	/**
	 * Default start index. If any uncommitted (WIP) items exist, start at the first one
	 * so the default selection covers only the WIP rows. Otherwise start at 0.
	 */
	private get defaultStart(): number {
		const firstWip = this.items.findIndex(i => i.state === 'uncommitted');
		if (firstWip >= 0) return firstWip;
		return 0;
	}

	/**
	 * Default end index, derived from items:
	 *  - If any WIP items exist, end at the last WIP item (select WIP only).
	 *  - Else, end at the last unpushed (non-pushed, non-merge-base, non-load-more) item.
	 *  - Else, end at the first item.
	 */
	private get defaultEnd(): number {
		let lastWip = -1;
		let lastUnpushed = -1;
		for (let i = 0; i < this.items.length; i++) {
			const state = this.items[i].state;
			if (state === 'uncommitted') {
				lastWip = i;
			}
			if (state !== 'pushed' && state !== 'merge-base' && state !== 'load-more') {
				lastUnpushed = i;
			}
		}
		if (lastWip >= 0) return lastWip;
		if (lastUnpushed >= 0) return lastUnpushed;
		return 0;
	}

	/** Last index that a drag handle can land on (excludes merge-base and load-more items). */
	private get maxDraggableIndex(): number {
		let last = this.items.length - 1;
		while (last >= 0 && (this.items[last].state === 'merge-base' || this.items[last].state === 'load-more')) {
			last--;
		}
		return last;
	}

	override render() {
		if (!this.items.length && !this.loading) return this.renderEmpty();

		const end = this.rangeEnd;
		const start = this.rangeStart;
		const activeEnd = this._dragging === 'end' ? (this._dragPreview ?? end) : end;
		const activeStart = this._dragging === 'start' ? (this._dragPreview ?? start) : start;

		const showEndHandle = this.items.length > 1;
		// In review mode, always show the start handle when there are multiple items
		// so users can discover that the start of the range is also draggable.
		const showStartHandle = this.mode === 'review' && this.items.length > 1;

		const showStartProxy = showStartHandle && this._startHandleOffscreen && !this._dragging;
		const showEndProxy = showEndHandle && this._endHandleOffscreen && !this._dragging;

		return html`<div class="details-scope-pane scrollable ${this._dragging ? 'details-scope-pane--dragging' : ''}">
			${showStartProxy ? this.renderProxyHandle('start') : nothing}
			${this.items.map((item, i) => {
				const isInRange = i >= activeStart && i <= activeEnd;
				const isAtEnd = i === activeEnd;
				const isAtStart = i === activeStart;
				// Handle's connector should match the upper commit's state, just like
				// row connectors: 'start' sits below items[i-1], 'end' sits below items[i].
				const startUpperState = i > 0 ? this.items[i - 1].state : undefined;
				return html`
					${isAtStart && showStartHandle ? this.renderHandle('start', startUpperState) : nothing}
					${this.renderItem(item, i, isInRange)}
					${isAtEnd && showEndHandle ? this.renderHandle('end', item.state) : nothing}
				`;
			})}
			${this.loading ? this.renderLoading() : nothing} ${showEndProxy ? this.renderProxyHandle('end') : nothing}
		</div>`;
	}

	private renderItem(item: ScopeItem, index: number, isInRange: boolean) {
		if (item.state === 'load-more') return this.renderLoadMore(item, index);

		const isFirst = index === 0;
		const isLast = !this.loading && index === this.items.length - 1;
		const isMergeBase = item.state === 'merge-base';
		const hasStats =
			(item.additions != null && item.additions > 0) ||
			(item.deletions != null && item.deletions > 0) ||
			(item.modified != null && item.modified > 0);

		const isNavigable = !isMergeBase;
		const rowClass = isMergeBase
			? 'scope-row scope-row--merge-base'
			: `scope-row scope-row--clickable ${isInRange ? 'scope-row--included' : 'scope-row--excluded'}`;

		const prevState = index > 0 ? this.items[index - 1].state : nothing;
		// The end-edge row is the keyboard target — focus *is* the active end edge,
		// not an independent token. Only that row is in the Tab sequence; all others
		// remain focusable on click (tabindex=-1) so they can still be set as edges.
		const tabIndex = isNavigable && index === this.rangeEnd ? 0 : -1;

		return html`<div
			class=${rowClass}
			role="listitem"
			data-index=${index}
			data-state=${item.state}
			data-prev-state=${prevState}
			tabindex=${tabIndex}
			@click=${(e: MouseEvent) => this.handleRowClick(e, index)}
			@keydown=${isNavigable ? (e: KeyboardEvent) => this.handleRowKeydown(e) : nothing}
		>
			<span class="scope-row__dot-col">
				${!isFirst ? html`<span class="scope-row__connector scope-row__connector--above"></span>` : nothing}
				${this.renderDot(item.state)}
				${!isLast ? html`<span class="scope-row__connector scope-row__connector--below"></span>` : nothing}
			</span>
			${isMergeBase || item.state === 'uncommitted'
				? html`<span class="scope-row__label">${item.label}</span>`
				: html`<gl-tooltip class="scope-row__label" content=${item.label} placement="bottom-start"
						><span class="scope-row__label-text">${item.label}</span></gl-tooltip
					>`}
			${hasStats
				? html`<commit-stats
						class="scope-row__stats"
						.added=${item.additions || undefined}
						.modified=${item.modified || undefined}
						.removed=${item.deletions || undefined}
						symbol="icons"
					></commit-stats>`
				: item.fileCount != null
					? html`<commit-stats
							class="scope-row__stats"
							.modified=${item.fileCount}
							symbol="icons"
						></commit-stats>`
					: nothing}
			${!isMergeBase && item.date != null
				? html`<formatted-date class="scope-row__date" .date=${new Date(item.date)} short></formatted-date>`
				: nothing}
			${!isMergeBase && item.avatarUrl
				? html`<gl-avatar
						class="scope-row__avatar"
						.src=${item.avatarUrl}
						.name=${item.author ?? ''}
					></gl-avatar>`
				: nothing}
			${isMergeBase ? html`<span class="scope-row__base-tag">Base</span>` : nothing}
		</div>`;
	}

	private renderHandle(type: 'start' | 'end', upperState: ScopeItemState | undefined) {
		const isActive = this._dragging === type;
		// In review mode the start handle is the only keyboard path to the start edge
		// (the end-edge row owns end-edge keyboard). Put it in the Tab sequence.
		// The end handle stays out of Tab order — its keyboard equivalent is the
		// end-edge row — but remains focusable on click for mouse drag continuity.
		const tabindex = type === 'start' && this.mode === 'review' ? '0' : '-1';
		return html`<div
			class="scope-handle ${isActive ? 'scope-handle--active' : ''}"
			role="slider"
			tabindex=${tabindex}
			aria-label=${type === 'start' ? 'Start of selected scope' : 'End of selected scope'}
			aria-orientation="vertical"
			aria-valuemin="1"
			aria-valuemax=${Math.max(1, this.maxDraggableIndex + 1)}
			aria-valuenow=${(type === 'start' ? this.rangeStart : this.rangeEnd) + 1}
			aria-valuetext=${this.items[type === 'start' ? this.rangeStart : this.rangeEnd]?.label ?? ''}
			data-handle=${type}
			data-state=${upperState ?? nothing}
			@pointerdown=${(e: PointerEvent) => this.handlePointerDown(e, type)}
			@keydown=${(e: KeyboardEvent) => this.handleHandleKeydown(e, type)}
			@focus=${() => this.scrollActiveHandleIntoView(type)}
		>
			<gl-tooltip content="Drag to include/exclude changes" placement="top">
				<div class="scope-handle__bar"></div>
			</gl-tooltip>
		</div>`;
	}

	private renderProxyHandle(type: 'start' | 'end') {
		return html`<div
			class="scope-handle scope-handle--proxy scope-handle--proxy-${type}"
			aria-hidden="true"
			tabindex="-1"
			@pointerdown=${(e: PointerEvent) => this.handleProxyPointerDown(e, type)}
		>
			<gl-tooltip content="Drag to include/exclude changes" placement=${type === 'start' ? 'bottom' : 'top'}>
				<div class="scope-handle__bar"></div>
			</gl-tooltip>
			<code-icon icon=${type === 'start' ? 'chevron-up' : 'chevron-down'}></code-icon>
		</div>`;
	}

	private renderLoadMore(item: ScopeItem, index: number) {
		const prevState = index > 0 ? this.items[index - 1].state : nothing;
		const isLoading = item.label === 'Loading…';
		return html`<button
			class="scope-row scope-row--load-more"
			role="listitem"
			data-index=${index}
			data-state=${item.state}
			data-prev-state=${prevState}
			?disabled=${isLoading}
			@click=${this.handleLoadMore}
		>
			<span class="scope-row__dot-col">
				<span class="scope-row__connector scope-row__connector--above"></span>
				<code-icon
					icon=${isLoading ? 'loading' : 'fold-down'}
					?modifier=${isLoading ? 'spin' : false}
				></code-icon>
				<span class="scope-row__connector scope-row__connector--below"></span>
			</span>
			<span class="scope-row__label--dimmed">${item.label}</span>
		</button>`;
	}

	/**
	 * Click-to-set-edge: snaps the nearer range edge to the clicked row, giving a
	 * precise alternative to dragging in small viewports. In compose mode the start
	 * is fixed (no start handle is rendered), so upward clicks become no-ops.
	 */
	private handleRowClick(e: MouseEvent, index: number): void {
		if (this._dragging) return;

		const item = this.items[index];
		if (item == null || item.state === 'merge-base' || item.state === 'load-more') return;

		e.preventDefault();
		e.stopPropagation();
		this.commitEdgeToIndex(index);
	}

	/**
	 * The focused row IS the end edge — Arrow keys move the end edge directly,
	 * focus follows. No navigate-then-commit dichotomy: stepping is the gesture.
	 * Always reads `rangeEnd` regardless of the firing row, so the behavior is
	 * uniform if focus drifts.
	 */
	private handleRowKeydown(e: KeyboardEvent): void {
		let next: number | undefined;
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowLeft':
				next = this.rangeEnd - 1;
				break;
			case 'ArrowDown':
			case 'ArrowRight':
				next = this.rangeEnd + 1;
				break;
			case 'PageUp':
				next = this.rangeEnd - this.pageDelta();
				break;
			case 'PageDown':
				next = this.rangeEnd + this.pageDelta();
				break;
			case 'Home':
				next = this.rangeStart;
				break;
			case 'End':
				next = this.maxDraggableIndex;
				break;
			default:
				return;
		}

		e.preventDefault();
		e.stopPropagation();
		this.moveEndEdgeTo(next);
	}

	/** Set `rangeEnd` to `target`, clamped to `[rangeStart, maxDraggableIndex]`. */
	private moveEndEdgeTo(target: number): void {
		const maxIndex = this.maxDraggableIndex;
		if (maxIndex < 0) return;

		const clamped = Math.max(this.rangeStart, Math.min(maxIndex, target));
		const item = this.items[clamped];
		if (item == null) return;
		if (clamped === this.rangeEnd) return;

		this._userRangeEndId = item.id;
		// Focus + scroll happens synchronously in `updated()` (consumed via the
		// pending flag) so the visibility recompute sees post-scroll positions
		// and the proxy doesn't briefly render.
		this._pendingKeyboardFocus = 'row-end';
		this.emitScopeChange();
	}

	private focusEndEdgeRow(options?: { scroll?: boolean }): void {
		const row = this.renderRoot.querySelector<HTMLElement>(`.scope-row[data-index="${this.rangeEnd}"]`);
		if (row == null) return;

		row.focus({ preventScroll: true });
		if (options?.scroll !== false) {
			this.scrollRowIntoViewIfNeeded(row);
		}
	}

	private scrollRowIntoViewIfNeeded(row: HTMLElement): void {
		// Include the trailing end-handle in the bounds — it carries the focus
		// indicator. Without this, a row flush at the viewport bottom leaves its
		// ~1.1rem handle sticking out, focus offscreen, end-proxy popping up.
		const trailing =
			row.nextElementSibling instanceof HTMLElement &&
			row.nextElementSibling.classList.contains('scope-handle') &&
			!row.nextElementSibling.classList.contains('scope-handle--proxy')
				? row.nextElementSibling
				: undefined;
		const rowRect = row.getBoundingClientRect();
		const bottom = trailing?.getBoundingClientRect().bottom ?? rowRect.bottom;
		this.scrollIntoViewWithPadding(rowRect.top, bottom);
	}

	/**
	 * Nudge the scope pane just enough to keep [top, bottom] inside the visible
	 * band (viewport minus one row-height of breathing room above and below).
	 * Delta-based so a single keypress produces a single small scroll, not a jump.
	 */
	private scrollIntoViewWithPadding(top: number, bottom: number): void {
		const scrollContainer = this.renderRoot.querySelector<HTMLElement>('.details-scope-pane');
		if (scrollContainer == null) return;

		const containerRect = scrollContainer.getBoundingClientRect();
		const padding = this.scrollPadding(containerRect.height);
		const visibleTop = containerRect.top + padding;
		const visibleBottom = containerRect.bottom - padding;
		if (top >= visibleTop && bottom <= visibleBottom) return;

		const offset = top < visibleTop ? top - visibleTop : bottom - visibleBottom;
		scrollContainer.scrollTop += offset;
	}

	private scrollPadding(containerHeight: number): number {
		return Math.min(this.measureRowHeight(), Math.max(0, Math.floor(containerHeight / 4)));
	}

	/** Shared "click or Enter commits the nearer edge to `index`" path. */
	private commitEdgeToIndex(index: number): void {
		const maxIndex = this.maxDraggableIndex;
		if (maxIndex < 0) return;

		const clamped = Math.min(index, maxIndex);

		const start = this.rangeStart;
		const end = this.rangeEnd;
		const canMoveStart = this.mode === 'review';

		let edge: 'start' | 'end';
		if (clamped < start) {
			if (!canMoveStart) return;

			edge = 'start';
		} else if (clamped > end) {
			edge = 'end';
		} else {
			// Inside the range — move the nearer edge (tie → end, since end is the
			// always-available handle in both modes).
			const distToStart = clamped - start;
			const distToEnd = end - clamped;
			edge = canMoveStart && distToStart < distToEnd ? 'start' : 'end';
		}

		if (edge === 'start') {
			this._userRangeStartId = this.items[clamped].id;
		} else {
			this._userRangeEndId = this.items[clamped].id;
		}
		// Keep the invariant "focused row = rangeEnd" so ↑/↓ continue to operate
		// on the end edge. But when the click moved the start edge, the user is
		// looking at the top of the range — scrolling down to rangeEnd would yank
		// the viewport away from where they just clicked. Focus silently, no
		// scroll, in that case. Synchronous-in-`updated()` so the proxy doesn't
		// flash between render commit and scroll.
		this._pendingKeyboardFocus = edge === 'end' ? 'row-end' : 'row-end-keep-viewport';
		this.emitScopeChange();
	}

	private handleLoadMore = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
	};

	private renderLoading() {
		const prevState = this.items.at(-1)?.state ?? nothing;
		return html`<div class="scope-row scope-row--loading" role="listitem" data-prev-state=${prevState}>
			<span class="scope-row__dot-col">
				<span class="scope-row__connector scope-row__connector--above"></span>
				<code-icon icon="loading" modifier="spin"></code-icon>
			</span>
			<span class="scope-row__label--dimmed">Loading commits…</span>
		</div>`;
	}

	private renderEmpty() {
		const label = this.mode === 'review' ? 'No commits to review' : 'No commits to compose';
		return html`<div class="details-scope-pane scrollable">
			<div class="scope-row scope-row--empty" role="listitem">
				<span class="scope-row__dot-col">
					<code-icon icon="git-commit"></code-icon>
				</span>
				<span class="scope-row__label--dimmed">${label}</span>
			</div>
		</div>`;
	}

	private renderDot(state: ScopeItemState) {
		switch (state) {
			case 'uncommitted':
				return html`<span class="dot-uncommitted"></span>`;
			case 'unpushed':
				return html`<span class="dot-unpushed"></span>`;
			case 'pushed':
				return html`<span class="dot-pushed"></span>`;
			case 'merge-base':
				return html`<span class="dot-merge-base"></span>`;
			case 'load-more':
				return nothing;
		}
	}

	private handlePointerDown(e: PointerEvent, type: 'start' | 'end'): void {
		e.preventDefault();
		e.stopPropagation();

		this._dragging = type;
		this._dragPreview = type === 'end' ? this.rangeEnd : this.rangeStart;
		this._dragStartY = e.clientY;
		this._dragHysteresisCleared = false;

		// Force the resize cursor globally for the duration of the drag so it doesn't
		// snap back to default whenever the pointer leaves the thumb element. Guard the
		// snapshot so a re-entrant drag doesn't capture our own override as the "original".
		if (this._previousBodyCursor === undefined) {
			this._previousBodyCursor = document.documentElement.style.cursor;
		}
		document.documentElement.style.setProperty('cursor', 'ns-resize', 'important');

		// Use window-level listeners so move/up events keep firing while the pointer
		// is outside the pane bounds — otherwise the preview state stops updating
		// (the drag looks "stuck") until the cursor re-enters.
		this._dragAc?.abort();
		const ac = new AbortController();
		this._dragAc = ac;

		window.addEventListener('pointermove', this._onDragMove, { signal: ac.signal });
		window.addEventListener('pointerup', this._onDragEnd, { signal: ac.signal });
		window.addEventListener('pointercancel', this._onDragEnd, { signal: ac.signal });

		// `preventDefault()` above cancels the browser's default focus-on-pointerdown,
		// which leaves keyboard focus on whatever was previously focused. Explicitly
		// focus the real handle (resolved via `findHandle`, not `e.currentTarget` —
		// the proxy path re-enters here with the proxy as currentTarget).
		this.focusHandle(type);
	}

	private handleProxyPointerDown(e: PointerEvent, type: 'start' | 'end'): void {
		e.preventDefault();
		e.stopPropagation();

		const realHandle = this.findHandle(type);
		if (realHandle == null) return;

		// Snap the scroll so the real handle lands at the appropriate edge. The
		// next pointermove → _processDragMove will pick the row nearest the
		// cursor, so no manual deltaY math is needed and saturation at min/max
		// scroll is harmless.
		this.scrollHandleIntoView(realHandle, type);

		// Hand off to the normal drag-start path. Window-level pointermove/up
		// listeners keep the drag alive even though the proxy unmounts under
		// the pointer (real handle becomes visible → flag flips → re-render).
		this.handlePointerDown(e, type);
	}

	private handleHandleKeydown(e: KeyboardEvent, type: 'start' | 'end'): void {
		let delta;
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowLeft':
				delta = -1;
				break;
			case 'ArrowDown':
			case 'ArrowRight':
				delta = 1;
				break;
			case 'PageUp':
				delta = -this.pageDelta();
				break;
			case 'PageDown':
				delta = this.pageDelta();
				break;
			case 'Home':
				delta = -Infinity;
				break;
			case 'End':
				delta = Infinity;
				break;
			default:
				return;
		}

		e.preventDefault();
		e.stopPropagation();

		const maxIndex = this.maxDraggableIndex;
		if (maxIndex < 0) return;

		if (type === 'start') {
			const current = this.rangeStart;
			const next =
				delta === -Infinity
					? 0
					: delta === Infinity
						? this.rangeEnd
						: Math.min(this.rangeEnd, Math.max(0, current + delta));
			this._userRangeStartId = this.items[next]?.id;
		} else {
			const current = this.rangeEnd;
			const next =
				delta === -Infinity
					? this.rangeStart
					: delta === Infinity
						? maxIndex
						: Math.max(this.rangeStart, Math.min(maxIndex, current + delta));
			this._userRangeEndId = this.items[next]?.id;
		}
		// Re-focus + scroll happens synchronously in `updated()` (via the pending
		// flag) so visibility recompute sees post-scroll positions and the proxy
		// doesn't briefly render. Re-focus is needed because the handle is rendered
		// inline inside the unkeyed row `.map()`: when the active edge shifts from
		// row N to N+1, Lit tears down the handle DOM at N and mounts a new one at
		// N+1, so focus would otherwise fall to `<body>`.
		this._pendingKeyboardFocus = type === 'start' ? 'handle-start' : 'handle-end';
		this.emitScopeChange();
	}

	private focusHandle(type: 'start' | 'end'): void {
		const handle = this.findHandle(type);
		handle?.focus({ preventScroll: true });
	}

	private findHandle(type: 'start' | 'end'): HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>(
			`.scope-handle:not(.scope-handle--proxy)[data-handle="${type}"]`,
		);
	}

	private pageDelta(): number {
		const container = this.renderRoot.querySelector<HTMLElement>('.details-scope-pane');
		if (container == null) return 1;

		const rowHeight = this.measureRowHeight();
		return Math.max(1, Math.floor(container.clientHeight / rowHeight) - 1);
	}

	private scrollActiveHandleIntoView(type: 'start' | 'end'): void {
		const handle = this.findHandle(type);
		if (handle == null) return;

		const r = handle.getBoundingClientRect();
		this.scrollIntoViewWithPadding(r.top, r.bottom);
	}

	private _onDragMove = (e: PointerEvent): void => {
		this._lastDragMoveEvent = e;
		if (this._dragMoveRaf != null) return;

		this._dragMoveRaf = requestAnimationFrame(() => {
			this._dragMoveRaf = undefined;
			const last = this._lastDragMoveEvent;
			if (last == null) return;

			this._processDragMove(last);
		});
	};

	private _processDragMove(e: PointerEvent): void {
		const scrollContainer = this.renderRoot.querySelector<HTMLElement>('.details-scope-pane');
		if (scrollContainer) {
			this.handleEdgeScroll(e, scrollContainer);
		}

		// Clamp the cursor Y to the visible container bounds before picking the
		// closest row. Rows scrolled offscreen still exist in the DOM at positions
		// well past the viewport — without this clamp, a fast pointer move past the
		// edge (clientY far below container.bottom) snaps the preview to an offscreen
		// row, putting the handle out of view until edge-scroll's ticks catch up.
		// The raw `e.clientY` still drives `handleEdgeScroll` above, so the scroll
		// speed is still proportional to how far past the edge the cursor is.
		const containerRect = scrollContainer?.getBoundingClientRect();
		const cursorY = containerRect
			? Math.max(containerRect.top, Math.min(containerRect.bottom, e.clientY))
			: e.clientY;

		const rows = this.renderRoot.querySelectorAll<HTMLElement>('.scope-row[data-index]');
		let closestIndex = -1;
		let closestDist = Infinity;

		for (const row of rows) {
			const rect = row.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const dist = Math.abs(cursorY - midY);
			if (dist < closestDist) {
				closestDist = dist;
				closestIndex = parseInt(row.dataset.index!, 10);
			}
		}

		if (closestIndex >= 0) {
			// Clamp to avoid dragging onto merge-base items
			const maxIndex = this.maxDraggableIndex;
			const clamped = Math.min(closestIndex, maxIndex);

			if (this._dragging === 'end') {
				this._dragPreview = Math.max(clamped, this.rangeStart);
			} else if (this._dragging === 'start') {
				this._dragPreview = Math.min(clamped, this.rangeEnd);
			}
		}
	}

	private _onDragEnd = (): void => {
		this._dragAc?.abort();
		this._dragAc = undefined;
		this.stopScrolling();
		this.restoreBodyCursor();
		if (this._dragMoveRaf != null) {
			cancelAnimationFrame(this._dragMoveRaf);
			this._dragMoveRaf = undefined;
		}
		this._lastDragMoveEvent = undefined;
		this._dragStartY = undefined;
		this._dragHysteresisCleared = false;

		if (this._dragPreview != null) {
			const item = this.items[this._dragPreview];
			if (item) {
				if (this._dragging === 'end') {
					this._userRangeEndId = item.id;
				} else if (this._dragging === 'start') {
					this._userRangeStartId = item.id;
				}
			}
			this.emitScopeChange();
		}

		this._dragging = undefined;
		this._dragPreview = undefined;
	};

	private restoreBodyCursor(): void {
		if (this._previousBodyCursor !== undefined) {
			document.documentElement.style.cursor = this._previousBodyCursor;
			this._previousBodyCursor = undefined;
		}
	}

	private handleEdgeScroll(e: PointerEvent, container: HTMLElement): void {
		// Distance-based hysteresis: don't engage edge-scroll until the user has
		// actually moved at least one row-height from drag start. Grabbing a handle
		// near a viewport edge would otherwise insta-scroll on the first pointermove.
		// Latched: once cleared, stays cleared for the rest of the drag.
		if (!this._dragHysteresisCleared) {
			const rowHeight = this.measureRowHeight();
			if (this._dragStartY != null && Math.abs(e.clientY - this._dragStartY) < rowHeight) {
				this.stopScrolling();
				return;
			}

			this._dragHysteresisCleared = true;
		}

		const rect = container.getBoundingClientRect();
		// Adaptive edge zone: scales with viewport so small panes don't have all
		// available space consumed by the trigger area. Capped at 32px even on tall
		// panes so the neutral middle stays generous.
		const edgeZone = Math.max(8, Math.min(32, container.clientHeight * 0.15));

		const distFromTop = e.clientY - rect.top;
		const distFromBottom = rect.bottom - e.clientY;
		const canScrollUp = container.scrollTop > 0 && this.edgeScrollKeepsHandleVisible('up', rect);
		const canScrollDown =
			container.scrollTop < container.scrollHeight - container.clientHeight &&
			this.edgeScrollKeepsHandleVisible('down', rect);

		if (distFromTop < edgeZone && canScrollUp) {
			this.startScrolling(container, -this.computeScrollSpeed(distFromTop, edgeZone));
		} else if (distFromBottom < edgeZone && canScrollDown) {
			this.startScrolling(container, this.computeScrollSpeed(distFromBottom, edgeZone));
		} else {
			this.stopScrolling();
		}
	}

	/**
	 * If the drag preview can still advance toward `direction`, edge-scroll is
	 * fine — the handle re-renders at the new preview row, tracking the cursor.
	 * Only when the preview has saturated against its clamp does the handle pin to
	 * one row; further scroll moves that pinned row across the viewport in the
	 * opposite direction (scroll up → rows down → handle slides toward bottom;
	 * scroll down → rows up → handle slides toward top). Allow scrolling in that
	 * regime UNTIL the pinned row is about to leave the viewport via the opposite edge.
	 *
	 * Use the preview row's bounds (not the handle's) as the visibility check —
	 * rows are stable DOM nodes through preview changes, while the handle is
	 * unmounted/remounted as the active edge shifts and `findHandle` can transiently
	 * return null mid-render. The handle sits flush against the row's edge, so the
	 * row's rect is the same anchor for "is the handle visible".
	 */
	private edgeScrollKeepsHandleVisible(direction: 'up' | 'down', containerRect: DOMRect): boolean {
		if (this._dragging == null || this._dragPreview == null) return true;

		const min = this._dragging === 'end' ? this.rangeStart : 0;
		const max = this._dragging === 'end' ? this.maxDraggableIndex : this.rangeEnd;
		const saturated = direction === 'up' ? this._dragPreview <= min : this._dragPreview >= max;
		if (!saturated) return true;

		const previewRow = this.renderRoot.querySelector<HTMLElement>(`.scope-row[data-index="${this._dragPreview}"]`);
		if (previewRow == null) return true;

		const rowRect = previewRow.getBoundingClientRect();
		const margin = Math.min(8, this.scrollPadding(containerRect.height));
		return direction === 'up'
			? rowRect.bottom + margin <= containerRect.bottom
			: rowRect.top - margin >= containerRect.top;
	}

	/**
	 * Quadratic ramp from ~0.5px/tick at the edge-zone boundary to 8px/tick at the
	 * literal edge — so the cursor near the boundary barely scrolls and only the
	 * deep edge accelerates, letting the user stop on a specific row.
	 */
	private computeScrollSpeed(distFromEdge: number, edgeZone: number): number {
		const depth = Math.max(0, Math.min(1, (edgeZone - distFromEdge) / edgeZone));
		return Math.max(0.5, Math.min(8, 0.5 + 7.5 * depth * depth));
	}

	private measureRowHeight(): number {
		const row = this.renderRoot.querySelector<HTMLElement>('.scope-row[data-index]');
		const h = row?.getBoundingClientRect().height ?? 0;
		return h > 0 ? h : 24;
	}

	private startScrolling(container: HTMLElement, speed: number): void {
		if (this._scrollInterval != null) {
			this._scrollSpeed = speed;
			return;
		}

		this._scrollSpeed = speed;
		this._scrollInterval = setInterval(() => {
			const before = container.scrollTop;
			container.scrollTop += this._scrollSpeed;
			// If we saturated against top/bottom, don't re-pick a row — the cursor
			// hasn't moved, the rows haven't moved, the preview would just thrash.
			if (container.scrollTop === before) return;

			// Re-process using the most recent pointer position so the preview tracks
			// rows passing under the (possibly stationary) cursor as content scrolls.
			// Feeding a captured event back through `_onDragMove` would race the RAF
			// coalescer and clobber the user's real position → jittery preview.
			const last = this._lastDragMoveEvent;
			if (last != null) {
				this._processDragMove(last);
			}
		}, 16);
	}

	private stopScrolling(): void {
		if (this._scrollInterval != null) {
			clearInterval(this._scrollInterval);
			this._scrollInterval = undefined;
		}
	}

	private emitScopeChange(): void {
		this.dispatchEvent(
			new CustomEvent<ScopeChangeDetail>('scope-change', {
				detail: { selectedIds: this.selectedIds },
				bubbles: true,
				composed: true,
			}),
		);
	}
}
