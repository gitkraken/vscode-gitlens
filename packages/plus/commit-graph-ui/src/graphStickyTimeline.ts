import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { html } from 'lit';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import {
	formatDate as formatGitLensDate,
	fromNowUnit,
	fromNowUnitKey,
	unitDivisorMs,
	unitThresholdMs,
} from '@gitlens/utils/date.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { CommitGraphStickyTimelineController, StickyTimelineHost } from './contracts/stickyTimeline.js';
import { nearestNonWorkdirDate } from './rowDates.js';

type StickyTimelineGroup = {
	key: string;
	label: string;
	lo: number;
	hi?: number;
};

function stickyTimelineGroupFor(dateMs: number, nowMs: number): StickyTimelineGroup {
	const day = unitDivisorMs('day');
	if (dateMs > nowMs) return { key: 'today', label: 'Today', lo: 0, hi: day };

	const result = fromNowUnit(dateMs, nowMs);
	if (result == null) return { key: 'today', label: 'Today', lo: 0, hi: day };

	const { unit, value } = result;
	const count = Math.abs(value);
	switch (unit) {
		case 'second':
		case 'minute':
		case 'hour':
			return { key: 'today', label: 'Today', lo: 0, hi: day };
		case 'day':
			if (count <= 1) return { key: 'yesterday', label: 'Yesterday', lo: day, hi: 2 * day };
			return { key: 'week', label: 'This week', lo: 2 * day, hi: unitDivisorMs('week') };
		case 'week': {
			const week = unitDivisorMs('week');
			const upperBound = unitThresholdMs('month');
			return count <= 1
				? { key: 'week:1', label: 'Last week', lo: week, hi: Math.min(2 * week, upperBound) }
				: {
						key: `week:${count}`,
						label: `${count} weeks ago`,
						lo: count * week,
						hi: Math.min((count + 1) * week, upperBound),
					};
		}
		case 'month': {
			const month = unitDivisorMs('month');
			const upperBound = unitThresholdMs('year');
			return count <= 1
				? { key: 'month:1', label: 'Last month', lo: month, hi: Math.min(2 * month, upperBound) }
				: {
						key: `month:${count}`,
						label: `${count} months ago`,
						lo: count * month,
						hi: Math.min((count + 1) * month, upperBound),
					};
		}
		default: {
			const lo = count <= 1 ? unitThresholdMs('year') : count * unitDivisorMs('year');
			return { key: `year:${count}`, label: `${count} years ago`, lo: lo };
		}
	}
}

/** Allocation-free grouping used by the optional timeline-separator row path. */
export function stickyTimelineGroupKeyFor(dateMs: number, nowMs: number): number {
	if (dateMs > nowMs) return 0;

	const raw = fromNowUnitKey(dateMs, nowMs);
	if (raw == null) return 0;

	const ordinal = Math.trunc(raw / 100_000);
	const count = Math.abs(raw - ordinal * 100_000);
	switch (ordinal) {
		case 4:
		case 5:
		case 6:
			return 0;
		case 3:
			return count <= 1 ? 1 : 2;
		case 2:
			return count <= 1 ? 100_000 : 100_000 + count;
		case 1:
			return count <= 1 ? 200_000 : 200_000 + count;
		default:
			return 300_000 + count;
	}
}

// Exact date span for a group's elapsed window [lo, hi) — short month + day, en dash between; the
// second date drops its month when it's the same as the first's (a same-month range like
// "Jul 13 – 19" reads more naturally than repeating "Jul"). `hi` undefined (year groups) → a single
// "before <date>" (no upper bound to show). `hi` exclusive → +1 day so the boundary date itself
// isn't double-counted; a exactly-1-day-wide window (today/yesterday) collapses to a single date.
function stickyTimelineSpanFor(group: StickyTimelineGroup, nowMs: number): string {
	if (group.hi == null) {
		return `before ${formatGitLensDate(nowMs - group.lo, 'MMM D')}`;
	}

	const endMs = nowMs - group.lo;
	const startMs = nowMs - group.hi + unitDivisorMs('day');
	if (startMs >= endMs) return formatGitLensDate(endMs, 'MMM D');

	return formatDaySpan(startMs, endMs);
}

function formatDaySpan(fromMs: number, toMs: number): string {
	const from = new Date(fromMs);
	const to = new Date(toMs);
	const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
	return `${formatGitLensDate(from, 'MMM D')} – ${formatGitLensDate(to, sameMonth ? 'D' : 'MMM D')}`;
}

/**
 * The sticky-timeline pill: rides the header/first-row seam, showing which relative-time group
 * (Today / Yesterday / This week / Last week / N weeks ago / …) — mirroring the Date column's OWN
 * `fromNow` families — the topmost visible row falls in.
 *
 * Owns the bucket classification (`stickyTimelineGroupFor`, edge-gated on the group key so a scroll
 * that stays within one group never re-renders), its elapsed-window short-circuit cache, the
 * scroll-active expand (CSSOM-only), the yield-to-top-row behavior, and the pill's rendering. AT
 * REST it's just the label; scrolling or hovering widens the SAME pill in place (native `:hover` +
 * the JS-toggled `is-scroll-active` class in `markScrolling` — CSS alone drives the reveal, see
 * graph.scss).
 */
export class StickyTimelineController implements ReactiveController, CommitGraphStickyTimelineController {
	// One @state-equivalent object (not three separate fields) since they're always read/written
	// together. Written ONLY on a group-key change; undefined = not yet computed / feature off.
	private _bucket?: { key: string; label: string; span: string };
	// The last classified group's elapsed WINDOW [lo, hi) (hi = +Infinity for year groups — see
	// `update`) — lets a call land back in the SAME window short-circuit before even building a new
	// StickyTimelineGroup (skips the fromNowUnit walk entirely). Invalidated whenever `nowMs` is
	// refreshed (the window is elapsed-relative, so it can go stale as real time passes).
	private _window?: { key: string; lo: number; hi: number };
	private readonly _pillRef: Ref<HTMLElement> = createRef();
	// Toggles the pill's expanded state for the ~900ms after the last scroll (idempotent add per
	// scroll; a trailing debounce removes it once scrolling settles) — CSSOM only, so a scroll burst
	// never re-renders. Mirrors the host's `clearScrolling` idle-clear idiom.
	private readonly _clearScrollActive = debounce((): void => {
		this._pillRef.value?.classList.remove('is-scroll-active');
	}, 900);

	private readonly _controllerHost: ReactiveControllerHost;

	constructor(controllerHost: ReactiveControllerHost, deps: StickyTimelineHost) {
		this._controllerHost = controllerHost;
		this.deps = deps;
		controllerHost.addController(this);
	}

	private readonly deps: StickyTimelineHost;

	/** Whether a bucket is currently computed (drives the config-flip "ON → compute immediately" check). */
	get hasBucket(): boolean {
		return this._bucket != null;
	}

	// Hides the pill when the feature is off — a no-op when nothing was showing.
	clear(): void {
		if (this._bucket != null) {
			this._bucket = undefined;
			this._window = undefined;
			this._controllerHost.requestUpdate();
		}
	}

	hostDisconnected(): void {
		this._clearScrollActive.cancel();
		this._bucket = undefined;
		this._window = undefined;
	}

	dispose(): void {
		this.hostDisconnected();
		this._controllerHost.removeController(this);
	}

	// `gitlens.graph.stickyTimeline` OFF → clear (hides the pill/hairlines). Otherwise reclassifies
	// `topMs` (the topmost visible row's workdir-normalized date) and writes state ONLY when the
	// group's KEY actually changes — mirrors the head-pill direction's edge-crossing gate. The window
	// cache (`_window`) short-circuits BEFORE that: while `topMs` (any row's date) stays within the
	// last classified group's elapsed bounds, there's nothing to reclassify — pure numeric check, no
	// `stickyTimelineGroupFor`/`fromNowUnit` call (and hence no allocation) at all.
	update(topMs: number): void {
		if (!this.deps.stickyTimelineEnabled()) {
			this.clear();
			return;
		}

		const win = this._window;
		const nowMs = this.deps.nowMs();
		const elapsed = nowMs - topMs;
		if (win != null && elapsed >= win.lo && elapsed < win.hi) return;

		const group = stickyTimelineGroupFor(topMs, nowMs);
		// A year group's `hi` is deliberately undefined on the GROUP (stickyTimelineSpanFor reads that as
		// "open-ended" for the "before <date>" display) — but the WINDOW still needs a real reclassification
		// bound, or it'd cache as valid forever and never notice elapsed crossing into year:(n+1). Derive it
		// the same way fromNowUnit would classify the NEXT year boundary: elapsed is >=0 here (a year group
		// only classifies past dates — the future-date guard in stickyTimelineGroupFor redirects anything
		// newer to 'today' first), so this can't disagree with what re-running fromNowUnit would say.
		const year = unitDivisorMs('year');
		const hi = group.hi ?? (Math.trunc(elapsed / year) + 1) * year;
		this._window = { key: group.key, lo: group.lo, hi: hi };
		if (group.key === this._bucket?.key) return;

		this._bucket = { key: group.key, label: group.label, span: stickyTimelineSpanFor(group, nowMs) };
		this._controllerHost.requestUpdate();
	}

	// Derives the topmost-row index (via the shared `rowIndexAt`, the same helper the range-change
	// minimap-day read uses), then updates the bucket through the shared, edge-gated `update`. Shared by
	// `onScroll` (the scroll hot path — cheap index math + one array access, no DOM read beyond the
	// `scrollTop` the caller already has) and `recompute` (a live `scrollTop` read, fine there — not the
	// hot path).
	updateFromScrollTop(scrollTop: number): void {
		const rows = this.deps.displayRows();
		const rh = this.deps.rowHeight();
		if (rows.length === 0 || rh <= 0) return;

		const idx = this.deps.rowIndexAt(scrollTop);
		const row = rows[idx];
		// A workdir (WIP) row's OWN date is a synthetic stamp — resolve through its EXACT anchor
		// (parents[0], mirroring the wrapper's dateForMinimapRow) when it's loaded; the positional
		// nearestNonWorkdirDate walk is only a fallback for the rare case the anchor hasn't paged in yet.
		const anchorSha = row?.kind === 'workdir' ? row.parents[0] : undefined;
		const anchorIdx = anchorSha != null ? this.deps.indexBySha().get(anchorSha) : undefined;
		const anchorDate = anchorIdx != null ? rows[anchorIdx]?.date : undefined;
		const dateMs = anchorDate ?? nearestNonWorkdirDate(rows, idx, rows.length - 1) ?? NaN;
		if (!Number.isNaN(dateMs)) {
			this.update(dateMs);
		}
	}

	// Re-derives the bucket from the CURRENT scroll position outside a range-change/scroll event — used
	// when the setting flips on live (see willUpdate) so the pill appears immediately instead of waiting
	// for the next scroll, and on the 60s relative-time tick so a group can drift forward as real time
	// passes. A live scrollTop read is fine here (a deliberate, infrequent call, not the scroll hot
	// path) — same allowance already used by the reveal helpers.
	recompute(): void {
		const scrollTop = this.deps.liveScrollTop();
		if (scrollTop == null) return;

		this.updateFromScrollTop(scrollTop);
	}

	markScrolling(): void {
		// CSSOM-only expand-while-scrolling — classList + a debounced idle-clear, no reactive state, so
		// a scroll burst never triggers a render on its own.
		this._pillRef.value?.classList.add('is-scroll-active');
		this._clearScrollActive();
	}

	// Yields the pill to the row it's covering: fades it out AND makes it pointer-transparent (CSS
	// `.is-yielding`, wins over the expand states — see graph.scss) whenever the TOPMOST visible row —
	// the same index the bucket uses — needs its own top-right corner: it's selected, keyboard-focused,
	// hovered, or renders PERSISTENT action buttons (the WIP-row case — at scroll-top the pill stays
	// hidden entirely; it reappears once scrolling puts a normal, non-persistent-actions row on top).
	// Hover reads `pointerRowSha` (NOT the rich-hover card's sha, which clears when the pointer moves
	// onto a row's `data-tooltip` action buttons — the pill rides right over those, so it must keep
	// yielding while they're hovered). Both are plain fields (hover never triggers a Lit render), which
	// is exactly why this is CSSOM — a reactive-state-driven equivalent would re-render rows on every
	// hover in/out. No flicker loop: once yielded via hover, the pointer sits over the (now
	// pointer-transparent) pill's old spot, which hits the row/buttons underneath — the row stays
	// hovered, so it stays yielded until the pointer actually leaves the row. O(1): index math + a few
	// Set/Map lookups + one classList.toggle; `scrollTop` defaults to the last scroll position the
	// host's `onScroll` recorded — a plain field read, no DOM access — for the rare caller outside the
	// scroll hot path; `onScroll` itself passes the value it already has.
	updateYield(scrollTop?: number): void {
		const el = this._pillRef.value;
		if (el == null) return;

		const rows = this.deps.displayRows();
		const rh = this.deps.rowHeight();
		if (rows.length === 0 || rh <= 0) {
			el.classList.remove('is-yielding');
			return;
		}

		const idx = this.deps.rowIndexAt(scrollTop ?? this.deps.lastScrollTop());
		const row = rows[idx];
		const yielding =
			row != null &&
			(this.deps.selectedShas().has(row.sha) ||
				idx === this.deps.focusIndex() ||
				row.sha === this.deps.pointerRowSha() ||
				this.deps.hasPersistentActions(row));
		el.classList.toggle('is-yielding', yielding);
	}

	// Not a button — purely informational, so no click handler/tabstop.
	render(): TemplateResult | null {
		if (!this.deps.stickyTimelineEnabled() || this._bucket == null) return null;

		return html`<div ${ref(this._pillRef)} class="gl-graph__sticky-timeline" aria-hidden="true">
			<code-icon class="gl-graph__sticky-timeline-icon" icon="calendar"></code-icon>
			<span class="gl-graph__sticky-timeline-label">${this._bucket.label}</span>
			<span class="gl-graph__sticky-timeline-span">${this._bucket.span}</span>
		</div>`;
	}
}
