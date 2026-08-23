import { colorForColumn } from '@gitkraken/commit-graph/colors.js';
import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import { xForColumn } from '@gitkraken/commit-graph/view.js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ChainLaneRun } from '../utils/chainLane.utils.js';
import { computeChainLaneRuns } from '../utils/chainLane.utils.js';
import { nodeRadiusFor } from './graph-gutter.js';

/** The slice of the virtualizer surface the overlay mounts into — an ordinary element plus the
 *  layout-completion promise `syncDom`'s first-layout retry waits on. */
type OverlayScroller = HTMLElement & { layoutComplete?: Promise<void> };

/** Per-pass geometry the box math bakes in — re-threaded on every `update` since it can change
 *  without the run memo's identity changing. */
export type ChainLaneGeometry = {
	readonly rowHeight: number;
	readonly columnWidth: number;
	readonly nodeSizingMode: 'compact' | 'avatar';
};

/**
 * Render-ready geometry for one chain-lane run (see `buildBox`) — the pixel counterpart of a
 * `ChainLaneRun`, consumed by `syncDom`.
 *
 * `top`/`height` are the CLIP CONTAINER's box (content px) — it always starts where the rule does and
 * spans down through the rule and, when present, the elbow. `ruleHeight` is the rule's OWN height within
 * that container (the rule always starts at the container's top, i.e. relative top 0, so no separate
 * offset is needed for it).
 */
type ChainLaneBox = {
	top: number;
	height: number;
	ruleHeight: number;
	x: number;
	color: string;
	/** The reach into the run's fork point — present only for a `'fork'`-kind `ChainLaneExtension`; a
	 *  `'clamp'` just makes the rule taller (`ruleHeight`/`height` above), with no elbow to draw. */
	elbow?: {
		height: number;
		/** Absolute content-space px (NOT relative to the chain x) — see the CSS comment on
		 *  `.gl-graph__chain-lane-elbow` for how these land the border precisely. */
		left: number;
		width: number;
		/** Which side of the chain column the fork sits on — selects the `is-elbow-left`/`-right` CSS
		 *  variant (which edge carries the vertical border + corner). */
		direction: 'left' | 'right';
	};
};

/**
 * The chain-lane highlight overlay: one bright rule per contiguous same-column run of the active ref
 * chain, painted OUTSIDE every row so `.is-dimmed`'s opacity can never dim it.
 *
 * Owns the run memoization (keyed on the identity of the active chain set + the display rows — the
 * same "for" pattern as `_scopeIdentityFor`), the per-pass box rebuild, and the imperative DOM sync
 * keyed on a no-op-detection string key.
 */
export class ChainLaneOverlayController implements ReactiveController {
	private _chainFor?: ReadonlySet<string>;
	private _rowsFor?: readonly ProcessedGraphRow[];
	private _runs?: readonly ChainLaneRun[];
	private _boxes?: readonly ChainLaneBox[];
	// The DOM elements `syncDom` currently owns (mirrors `_boxes` 1:1) + the key (`JSON.stringify` of
	// the boxes, `undefined` = none) it last synced the DOM to — lets a no-op pass (idle renders, the
	// overwhelming majority) skip touching the DOM entirely.
	private _els: HTMLDivElement[] = [];
	private _key: string | undefined;
	// Cached once true: whether the overlay is safe to mount into the `<lit-virtualizer>`'s light DOM.
	// It MUST carry `virtualizer-sizer` — Virtualizer 2.1.1's `_children` getter treats every child
	// WITHOUT that attribute as a rendered item (node_modules/@lit-labs/virtualizer/Virtualizer.js:
	// 443-453, SIZER_ATTRIBUTE :23) and `_positionChildren` indexes into that list by `index - this._first`
	// (:516-523), so one un-excluded extra child shifts every row's position by one. `_getSizer()`
	// (:220-245) lazily ADOPTS the first `[virtualizer-sizer]` child it finds in document order the first
	// time it's called and overwrites its inline styles — if our overlay mounted before the virtualizer's
	// own sizer exists, ours could be adopted instead. `disconnected()` never clears `_sizer` (:190-204),
	// so this can only race on first layout, never on reconnect. The overlay is mounted IMPERATIVELY (see
	// `syncDom`), not as a declared template child: a declared `<lit-virtualizer>` child was tried first
	// and verified LIVE to corrupt the virtualizer — its render part interleaves with the directive's own
	// light-DOM part, and the child expression's flip from `nothing` to content cleared that part's
	// committed rows (and the real sizer) along with it. Checked once per empty→non-empty transition via
	// `querySelector`, not every pass.
	private _mountSafe = false;

	constructor(private readonly host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostDisconnected(): void {
		// The overlay's DOM goes away with the (detached) virtualizer — drop our references and the
		// mount-safety latch so a reconnect re-checks the new virtualizer's sizer and remounts cleanly
		// instead of trusting stale state from the old one.
		this._els = [];
		this._key = undefined;
		this._mountSafe = false;
	}

	/** Recomputes the render-ready box set for this pass. `undefined` chain clears the overlay while
	 *  leaving the run memo intact — the caller gates on placement/column collapse, which must not
	 *  poison the memo, or leaving single-column mode with the same chain would never restore the
	 *  overlay. */
	update(
		activeChain: ReadonlySet<string> | undefined,
		rows: readonly ProcessedGraphRow[],
		indexBySha: ReadonlyMap<string, number>,
		geometry: ChainLaneGeometry,
	): void {
		if (activeChain == null) {
			this._boxes = undefined;
			return;
		}

		// The O(chain) walk reruns only when a chain is set/cleared or displayRows swaps (paging, lane
		// collapse/expand, filter). The render-ready BOXES are rebuilt every pass (≤2 runs, trivial):
		// they bake in `rowHeight` (zoom/DPR) and `columnWidth` (density), which can change without
		// either memo identity changing.
		if (this._chainFor !== activeChain || this._rowsFor !== rows) {
			this._chainFor = activeChain;
			this._rowsFor = rows;
			this._runs = computeChainLaneRuns(activeChain, indexBySha, rows);
		}

		this._boxes = this._runs?.map(run => this.buildBox(run, geometry));
	}

	// The overlay is mounted IMPERATIVELY (not as a declared `<lit-virtualizer>` template child) —
	// verified live: a declared child interleaves with the virtualize directive's OWN light-DOM render
	// part, and the child expression's re-render from `nothing` to content cleared that part's committed
	// nodes too, wiping every row (and the virtualizer's real sizer) the moment the chain activated.
	// Imperative DOM ownership (same strategy the virtualizer uses for its own sizer, see `_mountSafe`)
	// never touches Lit's parts, so it can't collide with them. Called from the host's `updated()` every
	// pass; short-circuits on an unchanged box set (via `_key`), so idle renders (the overwhelming
	// majority — no active chain) do nothing.
	syncDom(scroller: OverlayScroller | undefined): void {
		const boxes = this._boxes ?? [];
		const key = boxes.length === 0 ? undefined : JSON.stringify(boxes);
		if (key === this._key) return;

		for (const el of this._els) {
			el.remove();
		}
		this._els = [];

		if (key == null) {
			this._key = key;
			return;
		}

		// No virtualizer yet — leave the key UNSET so the next `updated()` pass retries from scratch
		// instead of silently giving up on this box set.
		const v = scroller;
		if (v == null) return;

		if (!this._mountSafe) {
			// The virtualizer hasn't adopted its own sizer yet (first layout pass) — mounting now risks OUR
			// `[virtualizer-sizer]` element being adopted instead (`_getSizer()`, Virtualizer.js:220-245,
			// lazily adopts the FIRST such child in document order). `:not(.gl-graph__chain-lane)` excludes
			// our own elements from a PRIOR successful mount so a later re-check can't be fooled by them.
			// Leave the key unset here too — this pass didn't mount anything, so it must retry.
			if (v.querySelector(':scope > [virtualizer-sizer]:not(.gl-graph__chain-lane)') == null) {
				void v.layoutComplete?.then(() => this.host.requestUpdate());
				return;
			}

			this._mountSafe = true;
		}

		for (const box of boxes) {
			const el = document.createElement('div');
			el.className = 'gl-graph__chain-lane';
			el.setAttribute('virtualizer-sizer', '');
			el.setAttribute('aria-hidden', 'true');
			el.style.top = `${box.top}px`;
			el.style.height = `${box.height}px`;
			// `--chain-lane-color` inherits down to the rule AND the elbow below — set once here, not per
			// child.
			el.style.setProperty('--chain-lane-x', `${box.x}px`);
			el.style.setProperty('--chain-lane-color', box.color);

			const rule = document.createElement('div');
			rule.className = 'gl-graph__chain-lane-rule';
			rule.style.height = `${box.ruleHeight}px`;
			el.append(rule);

			if (box.elbow != null) {
				const elbow = document.createElement('div');
				elbow.className = `gl-graph__chain-lane-elbow ${box.elbow.direction === 'left' ? 'is-elbow-left' : 'is-elbow-right'}`;
				// The elbow starts where the rule ends.
				elbow.style.top = `${box.ruleHeight}px`;
				elbow.style.height = `${box.elbow.height}px`;
				elbow.style.left = `${box.elbow.left}px`;
				elbow.style.width = `${box.elbow.width}px`;
				el.append(elbow);
			}

			// FIRST child, not appended — DOM order is paint order among these z-index:auto positioned
			// siblings, and the rule/elbow must paint UNDER the rows (see the class comment in graph.scss).
			v.insertBefore(el, v.firstChild);
			this._els.push(el);
		}

		this._key = key;
	}

	// Converts one `ChainLaneRun` (display-row indices + an optional fork `extension`) into the
	// render-ready pixel geometry `syncDom` mounts. Kept OUT of the caller's thin per-run map so the
	// elbow's border-centering math has room to be commented properly.
	private buildBox(run: ChainLaneRun, geometry: ChainLaneGeometry): ChainLaneBox {
		const rowHeight = geometry.rowHeight;
		const top = (run.startIndex + 0.5) * rowHeight; // the tip dot's center
		const x = xForColumn(run.column, geometry.columnWidth);
		const color = colorForColumn(run.column);
		// Default: the rule ends at the last chained row's dot center (matches the pre-extension geometry).
		let ruleHeight = (run.endIndex - run.startIndex) * rowHeight;

		if (run.extension?.kind === 'clamp') {
			// No elbow — the engine's own art doesn't lead anywhere further, so neither does the rule. Just
			// a taller vertical stub, reaching the TOP of the row where continuity broke.
			ruleHeight = run.extension.clampIndex * rowHeight - top;
		}

		if (run.extension?.kind !== 'fork') {
			return { top: top, height: ruleHeight, ruleHeight: ruleHeight, x: x, color: color };
		}

		const { forkIndex, forkColumn } = run.extension;
		const forkX = xForColumn(forkColumn, geometry.columnWidth);
		const direction: 'left' | 'right' = forkX < x ? 'left' : 'right';
		// Keep the horizontal segment off the fork row's own (possibly dimmed) dot — the same clearance
		// the live gutter pin uses for `--gutter-inset`.
		const inset = nodeRadiusFor(geometry.nodeSizingMode, rowHeight) + 2;
		// `border-box` sizing: a border paints INWARD from its box's outer edge by its own width, so its
		// visual centerline sits half a width in from that edge (0.2rem / 2 = 0.1rem = 1px at 1rem=10px —
		// the SAME half-width the rule's translate subtracts to center itself on `x`). Whichever edge
		// carries the CHAIN-side vertical border is offset by that 1px so its centerline lands exactly on
		// `x`; the FORK-side edge is inset off the fork's dot instead, not centered on anything.
		const halfBorderPx = 1;
		const left = direction === 'left' ? forkX + inset : x - halfBorderPx;
		const right = direction === 'left' ? x + halfBorderPx : forkX - inset;
		const elbowHeight = (forkIndex - run.endIndex) * rowHeight; // ends at the fork row's dot center

		return {
			top: top,
			// The container spans the rule AND the elbow beneath it — `syncDom` clips both to this one box.
			height: ruleHeight + elbowHeight,
			ruleHeight: ruleHeight,
			x: x,
			color: color,
			elbow: {
				height: elbowHeight,
				left: left,
				width: Math.max(0, right - left),
				direction: direction,
			},
		};
	}
}
