import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fromNow } from '@gitlens/utils/date.js';
import { elementBase, scrollbarThinFor } from '../../../shared/components/styles/lit/base.css.js';
import { detailsScopePaneStyles } from './gl-details-scope-pane.css.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/commit/commit-stats.js';

export type ScopeItemState = 'uncommitted' | 'unpushed' | 'pushed' | 'merge-base';

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

@customElement('gl-details-scope-pane')
export class GlDetailsScopePane extends LitElement {
	static override styles = [elementBase, detailsScopePaneStyles, scrollbarThinFor('.details-scope-pane')];

	@property({ type: Array })
	items: ScopeItem[] = [];

	@property({ type: Boolean })
	loading = false;

	/** 'compose' = top fixed, bottom draggable. 'review' = both draggable. */
	@property()
	mode: 'compose' | 'review' = 'compose';

	// Range is stored as item IDs so selection survives item list updates.
	@state() private _userRangeStartId: string | undefined;
	@state() private _userRangeEndId: string | undefined;
	@state() private _dragging: 'start' | 'end' | undefined;
	@state() private _dragPreview: number | undefined;

	private _scrollInterval: ReturnType<typeof setInterval> | undefined;
	private _dragAc: AbortController | undefined;

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
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		// When the items list changes (e.g. WIP tick reorders / adds / removes commits), drop
		// any stored range IDs that no longer resolve so the picker silently falls back to its
		// auto-derived defaults instead of clamping to a stale ID. We deliberately do NOT
		// re-emit `scope-change` here — only user drag (`_onDragEnd`) is a legitimate emit
		// site. Re-emitting on every items-ref change couples unrelated graph-state ticks to
		// scope-file refetches and the host-graph re-render path.
		if (changedProperties.has('items') && !this._dragging) {
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

	/** Effective start: resolves stored ID to index, falls back to 0. */
	private get rangeStart(): number {
		if (this._userRangeStartId != null) {
			const idx = this.items.findIndex(item => item.id === this._userRangeStartId);
			return idx >= 0 ? idx : 0;
		}
		return 0;
	}

	/** Effective end: resolves stored ID to index, falls back to last non-pushed item. */
	private get rangeEnd(): number {
		if (this._userRangeEndId != null) {
			const idx = this.items.findIndex(item => item.id === this._userRangeEndId);
			return idx >= 0 ? idx : this.defaultEnd;
		}
		return this.defaultEnd;
	}

	/** Index of the last non-pushed item, or -1 if none. */
	private get defaultEnd(): number {
		let last = -1;
		for (let i = 0; i < this.items.length; i++) {
			if (this.items[i].state !== 'pushed' && this.items[i].state !== 'merge-base') {
				last = i;
			}
		}
		return last;
	}

	/** Last index that a drag handle can land on (excludes merge-base items). */
	private get maxDraggableIndex(): number {
		let last = this.items.length - 1;
		while (last >= 0 && this.items[last].state === 'merge-base') {
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

		return html`<div class="details-scope-pane ${this._dragging ? 'details-scope-pane--dragging' : ''}">
			${this.items.map((item, i) => {
				const isInRange = i >= activeStart && i <= activeEnd;
				const isAtEnd = i === activeEnd;
				const isAtStart = i === activeStart;
				return html`
					${isAtStart && showStartHandle ? this.renderHandle('start') : nothing}
					${this.renderItem(item, i, isInRange)}
					${isAtEnd && showEndHandle ? this.renderHandle('end') : nothing}
				`;
			})}
			${this.loading ? this.renderLoading() : nothing}
		</div>`;
	}

	private renderItem(item: ScopeItem, index: number, isInRange: boolean) {
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

		return html`<div class=${rowClass} role="listitem" data-index=${index} data-state=${item.state}>
			<span class="scope-row__dot-col">
				${!isFirst ? html`<span class="scope-row__connector scope-row__connector--above"></span>` : nothing}
				${this.renderDot(item.state)}
				${!isLast ? html`<span class="scope-row__connector scope-row__connector--below"></span>` : nothing}
			</span>
			<span class="scope-row__label">${item.label}</span>
			${item.date != null ? html`<span class="scope-row__date">${fromNow(item.date, true)}</span>` : nothing}
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
			${item.avatarUrl
				? html`<gl-avatar
						class="scope-row__avatar"
						.src=${item.avatarUrl}
						.name=${item.author ?? ''}
					></gl-avatar>`
				: nothing}
		</div>`;
	}

	private renderHandle(type: 'start' | 'end') {
		const isActive = this._dragging === type;
		return html`<div
			class="scope-handle ${isActive ? 'scope-handle--active' : ''}"
			@pointerdown=${(e: PointerEvent) => this.handlePointerDown(e, type)}
		>
			<div class="scope-handle__bar"></div>
		</div>`;
	}

	private renderLoading() {
		return html`<div class="scope-row scope-row--loading" role="listitem">
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
		}
	}

	// --- Drag interaction ---

	private handlePointerDown(e: PointerEvent, type: 'start' | 'end'): void {
		e.preventDefault();
		e.stopPropagation();

		this._dragging = type;
		this._dragPreview = type === 'end' ? this.rangeEnd : this.rangeStart;

		// Use document-level listeners so drag works even when pointer leaves the webview
		this._dragAc?.abort();
		const ac = new AbortController();
		this._dragAc = ac;

		document.addEventListener('pointermove', this._onDragMove, { signal: ac.signal });
		document.addEventListener('pointerup', this._onDragEnd, { signal: ac.signal });
		document.addEventListener('pointercancel', this._onDragEnd, { signal: ac.signal });
	}

	private _onDragMove = (e: PointerEvent): void => {
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
	};

	private _onDragEnd = (): void => {
		this._dragAc?.abort();
		this._dragAc = undefined;
		this.stopScrolling();

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

	private handleEdgeScroll(e: PointerEvent, container: HTMLElement): void {
		const rect = container.getBoundingClientRect();
		const edgeZone = 40; // px from edge to start scrolling
		const scrollSpeed = 4; // px per tick

		const distFromTop = e.clientY - rect.top;
		const distFromBottom = rect.bottom - e.clientY;

		if (distFromTop < edgeZone && container.scrollTop > 0) {
			this.startScrolling(container, -scrollSpeed);
		} else if (distFromBottom < edgeZone && container.scrollTop < container.scrollHeight - container.clientHeight) {
			this.startScrolling(container, scrollSpeed);
		} else {
			this.stopScrolling();
		}
	}

	private startScrolling(container: HTMLElement, speed: number): void {
		if (this._scrollInterval != null) return;
		this._scrollInterval = setInterval(() => {
			container.scrollTop += speed;
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
