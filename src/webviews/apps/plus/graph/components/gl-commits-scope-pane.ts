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

	private _scrollInterval: ReturnType<typeof setInterval> | undefined;
	private _dragAc: AbortController | undefined;
	private _previousBodyCursor: string | undefined;
	private _dragMoveRaf: number | undefined;
	private _lastDragMoveEvent: PointerEvent | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'list');
		this.setAttribute('aria-label', 'Scope');
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._dragAc?.abort();
		this._dragAc = undefined;
		this.stopScrolling();
		this.restoreBodyCursor();
		if (this._dragMoveRaf != null) {
			cancelAnimationFrame(this._dragMoveRaf);
			this._dragMoveRaf = undefined;
		}
		this._lastDragMoveEvent = undefined;
	}

	override firstUpdated(): void {
		this.scrollEndHandleIntoView();
	}

	override updated(changedProperties: Map<string, unknown>): void {
		// Only re-scroll when items go from empty → populated (late branchCommits arrival).
		// Skip during user drag, and skip on selection-only changes — that would yank the
		// viewport after every drag end.
		if (this._dragging) return;
		if (!changedProperties.has('items')) return;
		const prev = changedProperties.get('items') as ScopeItem[] | undefined;
		if (!prev?.length && this.items.length > 0) {
			this.scrollEndHandleIntoView();
		}
	}

	private scrollEndHandleIntoView(): void {
		requestAnimationFrame(() => {
			const handle = this.renderRoot.querySelector<HTMLElement>(
				'.scope-handle[aria-label="End of selected scope"]',
			);
			handle?.scrollIntoView({ block: 'end', behavior: 'auto' });
		});
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
		if (!this.items.length && !this.loading) return nothing;

		const end = this.rangeEnd;
		const start = this.rangeStart;
		const activeEnd = this._dragging === 'end' ? (this._dragPreview ?? end) : end;
		const activeStart = this._dragging === 'start' ? (this._dragPreview ?? start) : start;

		const showEndHandle = this.items.length > 1;
		// In review mode, always show the start handle when there are multiple items
		// so users can discover that the start of the range is also draggable.
		const showStartHandle = this.mode === 'review' && this.items.length > 1;

		return html`<div class="details-scope-pane scrollable ${this._dragging ? 'details-scope-pane--dragging' : ''}">
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
			${this.loading ? this.renderLoading() : nothing}
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

		const rowClass = isMergeBase
			? 'scope-row scope-row--merge-base'
			: `scope-row ${isInRange ? 'scope-row--included' : 'scope-row--excluded'}`;

		const prevState = index > 0 ? this.items[index - 1].state : nothing;
		return html`<div
			class=${rowClass}
			role="listitem"
			data-index=${index}
			data-state=${item.state}
			data-prev-state=${prevState}
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
			${!isMergeBase && item.date != null
				? html`<formatted-date class="scope-row__date" .date=${new Date(item.date)} short></formatted-date>`
				: nothing}
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
		return html`<div
			class="scope-handle ${isActive ? 'scope-handle--active' : ''}"
			role="slider"
			tabindex="0"
			aria-label=${type === 'start' ? 'Start of selected scope' : 'End of selected scope'}
			aria-orientation="vertical"
			aria-valuemin="1"
			aria-valuemax=${Math.max(1, this.maxDraggableIndex + 1)}
			aria-valuenow=${(type === 'start' ? this.rangeStart : this.rangeEnd) + 1}
			aria-valuetext=${this.items[type === 'start' ? this.rangeStart : this.rangeEnd]?.label ?? ''}
			data-state=${upperState ?? nothing}
			@pointerdown=${(e: PointerEvent) => this.handlePointerDown(e, type)}
			@keydown=${(e: KeyboardEvent) => this.handleHandleKeydown(e, type)}
		>
			<div class="scope-handle__bar"></div>
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

	// --- Drag interaction ---

	private handlePointerDown(e: PointerEvent, type: 'start' | 'end'): void {
		e.preventDefault();
		e.stopPropagation();

		this._dragging = type;
		this._dragPreview = type === 'end' ? this.rangeEnd : this.rangeStart;

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
		this.emitScopeChange();
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

		const rows = this.renderRoot.querySelectorAll<HTMLElement>('.scope-row[data-index]');
		let closestIndex = -1;
		let closestDist = Infinity;

		for (const row of rows) {
			const rect = row.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const dist = Math.abs(e.clientY - midY);
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
		const rect = container.getBoundingClientRect();
		const edgeZone = 40; // px from edge to start scrolling
		const scrollSpeed = 4; // px per tick

		const distFromTop = e.clientY - rect.top;
		const distFromBottom = rect.bottom - e.clientY;

		if (distFromTop < edgeZone && container.scrollTop > 0) {
			this.startScrolling(container, -scrollSpeed, e);
		} else if (distFromBottom < edgeZone && container.scrollTop < container.scrollHeight - container.clientHeight) {
			this.startScrolling(container, scrollSpeed, e);
		} else {
			this.stopScrolling();
		}
	}

	private startScrolling(container: HTMLElement, speed: number, e: PointerEvent): void {
		if (this._scrollInterval != null) return;
		this._scrollInterval = setInterval(() => {
			container.scrollTop += speed;
			this._onDragMove(e);
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
