import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { CommitFrequencyData, TreemapData, TreemapMode, TreemapNode } from '../../../../plus/treemap/protocol.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import type { TreemapRect } from '../utils/squarify.js';
import { descendants, leaves, squarify } from '../utils/squarify.js';
import '../../../shared/components/indicators/watermark-loader.js';

const extensionHues: Record<string, number> = {
	ts: 210,
	tsx: 210,
	js: 50,
	jsx: 50,
	mjs: 50,
	cjs: 50,
	css: 300,
	scss: 300,
	less: 300,
	html: 15,
	htm: 15,
	svg: 15,
	json: 140,
	yaml: 140,
	yml: 140,
	toml: 140,
	md: 30,
	mdx: 30,
	txt: 30,
	py: 60,
	rb: 0,
	go: 180,
	rs: 25,
	java: 200,
	sh: 90,
	bash: 90,
	zsh: 90,
	png: 270,
	jpg: 270,
	jpeg: 270,
	gif: 270,
	ico: 270,
};

type ActivityKind = 'read' | 'edit';

/** Surrounding-chrome RGB triples for active-leaf highlights in Activity mode, keyed by tool
 *  kind. Each entry parallels the leaf fill (see `activityColor`): edits get a warm amber halo /
 *  stroke / folder tint; reads get a cool blue/cyan one. Stored as `'r, g, b'` strings so callers
 *  paste them straight into `rgba(${chrome.field}, alpha)` template literals. */
const activeChromeByKind: Record<ActivityKind, { base: string; stroke: string; label: string; glow: string }> = {
	edit: {
		base: '255, 175, 75', // warm amber — matches the leaf fill hue (~30°)
		stroke: '255, 200, 110',
		label: '255, 220, 160',
		glow: '255, 170, 60',
	},
	read: {
		base: '120, 200, 255', // cool blue/cyan — matches the leaf fill hue (~200°)
		stroke: '150, 210, 255',
		label: '180, 220, 255',
		glow: '120, 200, 255',
	},
};

/** Per-file activity entry, parallel to `AgentSession.fileActivity`. `readAt`/`editedAt` are
 *  milliseconds since the host's last PreToolUse for that kind, captured at the moment the
 *  snapshot was built. The chart ages them locally so the heatmap fades smoothly between IPC
 *  notifications. `reading`/`editing` are `true` while a tool of that kind is in flight on the
 *  path right now — drives the pulse + brightness boost. */
export interface ActivityEntry {
	readAt?: number;
	editedAt?: number;
	reading?: boolean;
	editing?: boolean;
}

/** Snapshot wrapper paired with the webview-local timestamp at which the snapshot was built.
 *  All entries' `readAt`/`editedAt` are expressed relative to that timestamp; the renderer ages
 *  them locally via `performance.now() - snapshotAt`. */
export interface ActivitySnapshot {
	readonly entries: ReadonlyMap<string, ActivityEntry>;
	readonly snapshotAt: number;
}

/** Per-(layout, activity) cache built once per IPC snapshot and reused across pulse frames — see
 *  `GlTreemapChart._renderCache` for the field doc. Named (rather than inlined on the field) so
 *  `ensureRenderCache` can declare its return type without reaching through the `this` type. */
interface TreemapRenderCache {
	layout: TreemapRect<TreemapNode>;
	activity: ActivitySnapshot | undefined;
	entryByNode: WeakMap<TreemapRect<TreemapNode>, ActivityEntry | null>;
}

/** A focused ("agent is here right now") leaf, projected to a host-relative CSS-pixel rect so a DOM
 *  overlay can render the breathing pulse + ping ring over it. The pulse animation lives in CSS
 *  (`@keyframes`, compositor-thread `opacity`/`transform`) rather than on the canvas, so it keeps
 *  gliding smoothly even when the renderer's main thread is blocked by unrelated work — the canvas
 *  rAF can't make that guarantee since a blocked main thread starves every requestAnimationFrame.
 *  `key` is the leaf's repo-relative path so Lit's `repeat` keeps each pulse element stable as the
 *  focused set shifts from file to file. */
interface FocusedPulse {
	key: string;
	x: number;
	y: number;
	w: number;
	h: number;
	kind: ActivityKind;
	/** Leaf basename, rendered as a dark label on top of the solid pulse block. */
	name: string;
	/** Whether the leaf is large enough to show its label (matches the canvas leaf-label threshold). */
	big: boolean;
}

/** Period of the breathing pulse applied to focused (recently-touched or in-flight) leaves. Slow
 *  and steady — a calm "live indicator" cadence rather than an urgent blink. */
const livePulsePeriodMs = 2000;

/** Re-render cadence used while only *cooling* heat is in play — no focused entry, just decay
 *  tails fading toward zero. Heat drops linearly over the WHOLE decay window, so the per-frame
 *  delta — and thus the cadence a smooth fade needs — scales with the window: a 30s window wants
 *  ~4 fps, but a 30m window fades ~0.06%/sec where 4 fps would be thousands of redundant full-
 *  canvas redraws. Scale the interval to the window (~600 frames total), clamped to [250ms,
 *  1000ms] so short windows stay smooth and long ones stop burning the main thread on sub-pixel
 *  steps. The "agent is here" pulse is unaffected — it's a compositor CSS animation, not this loop. */
function coolingRedrawIntervalMs(decayMs: number): number {
	return Math.min(1000, Math.max(250, Math.round(decayMs / 600)));
}

/** Recency window (ms) during which a freshly-touched leaf reads as "the agent is here right now"
 *  — it gets the brightness boost + pulse. Driven by recency rather than the in-flight
 *  `reading`/`editing` flag because file tools (Read/Edit/Write/…) complete in milliseconds, so
 *  the in-flight window is far too brief to perceive. Keeping the focus alive for a few seconds
 *  after the touch makes the pulse visible and lets it "move" from file to file as the agent
 *  works. The in-flight flags still force focus when set (covers a hypothetical slow tool). */
const focusWindowMs = 4000;

/** Edit-side multiplier for color blending. When a file has both read and edit heat, the mixed
 *  RGB tilts toward the edit chrome by this factor — keeps "agent is working on it" visually
 *  louder than passive observation, without going all the way back to write-wins. */
const editHeatBoost = 1.5;

/** Brightness multipliers for a focused leaf's fill, modulated by the pulse so the *whole block*
 *  visibly breathes (not just the chrome). At the dim phase the focused leaf still reads brighter
 *  than the cooling tail; at the bright phase it pops hard. The min stays above 1 so a cooling
 *  leaf is never brighter than a focused one mid-pulse. */
const focusedBrightnessMin = 1.1;
const focusedBrightnessMax = 1.45;

/** Lerp between two RGB triples (`'r, g, b'` strings) by weight `t ∈ [0, 1]`, returning a new
 *  `'r, g, b'` string. Used for the read↔edit blend when both kinds have heat on the same path. */
function lerpRgb(a: string, b: string, t: number): string {
	const [ar, ag, ab] = a.split(',').map(s => Number.parseInt(s.trim(), 10));
	const [br, bg, bb] = b.split(',').map(s => Number.parseInt(s.trim(), 10));
	const r = Math.round(ar + (br - ar) * t);
	const g = Math.round(ag + (bg - ag) * t);
	const bch = Math.round(ab + (bb - ab) * t);
	return `${r}, ${g}, ${bch}`;
}

/** Lift each RGB channel by `factor` (e.g. 1.15 for the live-brightness boost), clamped to 255. */
function brightenRgb(rgb: string, factor: number): string {
	const [r, g, b] = rgb.split(',').map(s => Number.parseInt(s.trim(), 10));
	const lift = (c: number): number => Math.min(255, Math.round(c * factor));
	return `${lift(r)}, ${lift(g)}, ${lift(b)}`;
}

/** Shared heat→alpha ramp for *active* (read/edit) chrome — used by both the leaf fill and the
 *  folder strokes so neither is ever brighter than the other for the same heat. The low floor (0.18)
 *  is what makes the heatmap decay legible: a freshly-cooled leaf reads ~as bright as a focused one
 *  (0.85 at heat≈1, continuous across the focus→cool handoff), fading to nearly invisible as heat
 *  approaches 0 at the end of the decay window. */
function activeAlphaForHeat(heat: number): number {
	return 0.18 + heat * 0.67;
}

/** A folder's peak read and edit heat across its subtree (each ∈ [0, 1]). The folder renderer
 *  paints the read (cyan) and edit (amber) chromes as two *separate, alpha-composited* layers — each
 *  at an opacity driven by its own heat — rather than lerping to a single averaged hue. So a folder
 *  with a hot edit and a cool read paints bright amber + faint cyan (and you see both), and the mix
 *  shifts as each kind's heat decays independently — "true" optical mixing by recency, not a muddy
 *  midpoint color. Max (not sum) across the subtree, so a folder glows as bright as its hottest
 *  descendant of each kind regardless of how many files it contains. */
interface FolderHeat {
	readHeat: number;
	editHeat: number;
}

function getExtensionHue(name: string): number {
	const dot = name.lastIndexOf('.');
	if (dot === -1) return 0;

	const ext = name.slice(dot + 1).toLowerCase();
	const known = extensionHues[ext];
	if (known != null) return known;

	let hash = 0;
	for (let i = 0; i < ext.length; i++) {
		hash = ((hash << 5) - hash + ext.charCodeAt(i)) | 0;
	}
	return ((hash % 360) + 360) % 360;
}

export interface TreemapZoomChangeDetail {
	path: TreemapNode[];
}

export interface TreemapFileClickDetail {
	node: TreemapNode;
}

/**
 * Canvas-based treemap renderer. Pure presentation: takes a tree + (optional) commit frequencies +
 * a mode and draws a squarified treemap. Owns interactive zoom/breadcrumbs and tooltip; emits
 * `gl-treemap-zoom-change` so a parent can sync its own breadcrumb UI if it wants.
 *
 * No IPC, no host coupling — `<gl-graph-treemap>` is responsible for fetching and feeding `data`.
 */
@customElement('gl-treemap-chart')
export class GlTreemapChart extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			min-height: 0;
			position: relative;
		}

		canvas {
			display: block;
			flex: 1 1 auto;
			width: 100%;
			min-height: 0;
			background: var(--vscode-editor-background);
			border-top: 1px solid var(--vscode-editorWidget-border, transparent);
		}

		.empty {
			flex: 1 1 auto;
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			padding: 1rem;
			text-align: center;
		}

		/* Mirrors gl-timeline-chart's .notice overlay so the loader sits centered over the
		 * canvas instead of dropping the chart out of the DOM during refresh. */
		.notice {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: none;
		}

		.notice--blur {
			backdrop-filter: blur(8px);
			-webkit-backdrop-filter: blur(8px);
			background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent);
		}

		/* Floating hint shown over the dim treemap when Activity mode is on but no agent is
		 * currently editing a file. Disappears the moment any session's fileActivity lights up. */
		.activity-hint {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%);
			display: flex;
			align-items: center;
			gap: 0.6rem;
			padding: 0.6rem 1rem;
			border-radius: 0.4rem;
			background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
			border: 1px solid var(--vscode-editorWidget-border, transparent);
			color: var(--vscode-descriptionForeground);
			font-size: 1.2rem;
			max-width: 80%;
			text-align: center;
			pointer-events: none;
		}

		.tooltip {
			position: fixed;
			pointer-events: none;
			background: var(--vscode-editorHoverWidget-background);
			border: 1px solid var(--vscode-editorHoverWidget-border);
			color: var(--vscode-editorHoverWidget-foreground);
			padding: 0.4rem 0.8rem;
			border-radius: 0.3rem;
			font-size: 1.2rem;
			font-family: var(--vscode-font-family);
			white-space: nowrap;
			z-index: 1000;
			box-shadow: 0 0.2rem 0.8rem rgba(0, 0, 0, 0.3);
		}

		/* Compositor-thread pulse overlay for "the agent is here right now" leaves. One element per
		 * focused leaf, positioned over its canvas rect. The breathing + ping ring animate via CSS
		 * keyframes on opacity/transform, which the compositor runs off the main thread — so the cue
		 * keeps gliding smoothly even while the main thread is blocked by unrelated webview work (the
		 * jank a canvas rAF pulse can't avoid). overflow:hidden clips glows/rings to the chart bounds. */
		.pulse-layer {
			position: absolute;
			inset: 0;
			overflow: hidden;
			pointer-events: none;
			z-index: 1;
		}

		/* The active leaf: a solid filled rounded box (like the reference) that emits a solid copy of
		 * itself (the ::after echo) expanding outward and fading — a "broadcast" in the box's own shape,
		 * at any zoom. Static box; only the echo animates. transform/opacity only → compositor thread,
		 * smooth even under main-thread load. isolation keeps each pulse's echo + label z-ordering
		 * self-contained. */
		.activity-pulse {
			position: absolute;
			border-radius: 0.5rem;
			background: rgb(var(--pulse-ring));
			box-shadow: 0 0 1rem 0.1rem rgba(var(--pulse-ring), 0.5);
			isolation: isolate;
		}

		/* Filename label drawn on top of the solid block (dark on the bright kind-color fill). Above
		 * the echo (z-index) so the broadcast copy never obscures it; clipped to the block. */
		.activity-pulse-label {
			position: absolute;
			z-index: 1;
			left: 0.4rem;
			top: 0.2rem;
			right: 0.4rem;
			color: rgba(20, 22, 28, 0.95);
			font-size: 1.1rem;
			font-family: var(--vscode-font-family, sans-serif);
			line-height: 1.5rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			pointer-events: none;
		}

		.activity-pulse--edit {
			--pulse-ring: 255, 170, 70;
		}

		.activity-pulse--read {
			--pulse-ring: 110, 195, 255;
		}

		/* Broadcast echo in the block's own shape — a rounded rectangle (inheriting the block's
		 * corners) whose size (--echo-w/--echo-h, set per-leaf in render) tracks the leaf with a floor,
		 * so it starts ≈ the leaf and expands beyond: a big leaf gets a big rectangular ripple (reads
		 * as pulsing when zoomed in), a tiny leaf a floored one (still a dramatic ping when zoomed
		 * out). cubic-bezier front-loads the growth then eases out. */
		.activity-pulse::after {
			content: '';
			position: absolute;
			left: 50%;
			top: 50%;
			width: var(--echo-w, 100%);
			height: var(--echo-h, 100%);
			margin-left: calc(var(--echo-w, 0px) / -2);
			margin-top: calc(var(--echo-h, 0px) / -2);
			border-radius: inherit;
			z-index: 0;
			/* Solid, same color as the block → at scale 1 it's seamless with the box, then a solid
			 * copy flies outward and fades. */
			background: rgb(var(--pulse-ring));
			will-change: transform, opacity;
			animation: activity-pulse-broadcast var(--pulse-period, 2000ms) cubic-bezier(0.25, 0, 0, 1) infinite;
		}

		@keyframes activity-pulse-broadcast {
			0% {
				transform: scale(1);
				opacity: 0.8;
			}
			100% {
				transform: scale(2.2);
				opacity: 0;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.activity-pulse {
				animation: none;
				opacity: 1;
			}
			.activity-pulse::after {
				animation: none;
				opacity: 0;
			}
		}
	`;

	@property({ attribute: false })
	data: TreemapData | undefined;

	@property({ type: String, reflect: true })
	mode: TreemapMode = 'files';

	/** Files currently being edited or read by any agent attributed to the active repo, keyed by
	 *  repo-relative path (forward-slash). Read- and edit-class kinds are tracked independently per
	 *  entry; the chart blends them by relative heat (with an edit-boost) so a file the agent
	 *  recently read then edited paints somewhere between cyan and amber. `reading`/`editing`
	 *  drive the live pulse + brightness boost. `snapshotAt` is the webview-local `performance.now()`
	 *  at which the parent built the map — the chart ages each entry's `readAt`/`editedAt` locally
	 *  by `performance.now() - snapshotAt` so the heatmap fades smoothly between IPC pushes. */
	@property({ attribute: false })
	activity?: ActivitySnapshot;

	/** Window (ms) over which a file's read/edit heat fades from full brightness to fully invisible
	 *  after the agent's last tool call. Driven by
	 *  `gitlens.graph.experimental.visualizations.activityDecay`. Defaults to 5 minutes when the
	 *  parent doesn't set it. */
	@property({ attribute: false })
	activityDecayMs = 5 * 60 * 1000;

	/** External "loading" signal from the parent — set while the host is fetching aggregate data.
	 *  Matches `gl-timeline-chart`'s `loading` prop; renders the same `<gl-watermark-loader pulse>`
	 *  overlay so both viz modes share the affordance and motion. */
	@property({ type: Boolean, reflect: true })
	loading = false;

	@state() private _zoomPath: TreemapNode[] = [];
	@state() private _tooltipText = '';
	@state() private _tooltipPos = { x: 0, y: 0, visible: false };
	/** Focused leaves projected to host CSS-pixel rects, driving the DOM pulse overlay (see
	 *  {@link FocusedPulse}). Recomputed inside `renderTreemap`; assigned only when the set or
	 *  positions actually change (keyed by {@link _focusedPulsesKey}) so the 4 fps cooling tick
	 *  doesn't churn Lit when focus is stable. */
	@state() private _focusedPulses: FocusedPulse[] = [];
	/** Signature of the last-assigned `_focusedPulses` (keys + rounded rects) so we can skip the
	 *  reactive write when nothing moved. */
	private _focusedPulsesKey = '';

	@query('#treemap-canvas')
	private _canvas?: HTMLCanvasElement;

	@query('#treemap-tooltip')
	private _tooltipEl?: HTMLElement;

	private _resizeObserver?: ResizeObserver;
	private _hovered?: TreemapRect<TreemapNode>;
	private _layoutCache?: TreemapRect<TreemapNode>;
	private _layoutKey = '';
	/** Lazy memo of `getRelativePath(node)` — the result is a pure function of `node.path` and
	 *  `this.root.path`, both stable for the lifetime of the current `data` prop. Reading a leaf's
	 *  relPath was previously ~2 regex calls + slice + startsWith per leaf per render (≥4500 ops on
	 *  a 2260-leaf tree at 60 fps); the WeakMap.get-then-fallback path collapses it to one map
	 *  probe after the first walk. Cleared when `data` changes (different `TreemapNode` instances). */
	private _relPathByNode = new WeakMap<TreemapNode, string>();
	/** Per-(layout, activity) cache for the activity-dependent slices of `renderTreemap`. Holds only
	 *  `entryByNode`: resolved `activity.entries.get(relPath)` per leaf rect — kills the per-leaf
	 *  `getRelativePath` regex + Map.get on every frame. Invalidated on layout change (zoom/resize)
	 *  or activity-ref change (new IPC snapshot). Neither per-leaf heat NOR folder heat
	 *  (`collectActiveAncestors`) is cached — both are time-dependent (they decay every frame, and
	 *  track a live `activityDecayMs` change) so both are re-derived fresh each render. */
	private _renderCache?: TreemapRenderCache;
	/** Marker for the canvas instance whose listeners we've already wired. The canvas may not exist
	 *  during `firstUpdated` (the empty state renders a `<div>` instead) — wiring happens lazily in
	 *  `updated()` once the canvas appears, but we don't want to re-wire on every render. */
	private _wiredCanvas?: HTMLCanvasElement;
	/** Slow setTimeout handle for the canvas redraw tick — runs roughly 4×/sec while any heat exists.
	 *  It drives two slow-changing things: the cooling heat fade (heat drops ~0.3%/sec on the default
	 *  5-min window, so 4 fps looks identical to 60 fps to the eye) and focus expiry (a leaf stops
	 *  being "focused" `focusWindowMs` after its last touch — the tick re-runs `renderTreemap`, which
	 *  recomputes `_focusedPulses` and drops the expired leaf's overlay). The *pulse itself* is no
	 *  longer redrawn here — it's a compositor-thread CSS animation on the overlay — so there's no
	 *  60 fps rAF loop anymore; this slow tick is all the canvas needs. */
	private _coolingRedrawTimer?: ReturnType<typeof setTimeout>;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._resizeObserver = new ResizeObserver(() => this.invalidateAndRender());
		// Pause the cooling redraw tick while the document is hidden, and re-arm it on return. The
		// browser already throttles CSS animations + rAF in hidden tabs, but `setTimeout` (the
		// cooling tick) doesn't, so without this the tick would keep redrawing the canvas behind an
		// unfocused window. The listener is on `document` (the webview's root) so it tracks the
		// webview host's visibility, not the VS Code window itself.
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this._onVisibilityChange);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		// Detach canvas listeners explicitly — without this, the detached canvas keeps closure
		// references to `this` (mousemove/mouseleave/click handlers) and the LitElement leaks
		// until the canvas itself is GC'd. Bounded leak per disconnect cycle, but accumulates.
		this.unwireCanvas();
		this.stopAnimationLoop();
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this._onVisibilityChange);
		}
	}

	private readonly _onVisibilityChange = (): void => {
		if (document.hidden) {
			this.stopAnimationLoop();
		} else {
			// Heat ages off the monotonic clock, which keeps advancing while the tab is hidden, so on
			// return the canvas can be showing stale heat (possibly fully decayed to nothing). Repaint
			// once immediately — ensureAnimationLoop would otherwise bail without drawing when heat has
			// already reached zero, or wait a full ~250 ms tick before the first redraw.
			if (this.mode === 'activity') {
				this.renderTreemap();
			}
			this.ensureAnimationLoop();
		}
	};

	/** Keep the slow (~250 ms) canvas redraw tick running while Activity mode has any live or
	 *  decaying heat, so the heat fade animates and focus expiry drops stale pulses. Stops the moment
	 *  heat reaches zero, the mode switches off Activity, the chart disconnects, or `document.hidden`
	 *  is true. There is intentionally no 60 fps loop: the "agent is here" pulse is a compositor-thread
	 *  CSS animation on the DOM overlay (see {@link FocusedPulse}), which stays smooth even when the
	 *  main thread is blocked — a canvas rAF could not, since a blocked main thread starves rAF. */
	private ensureAnimationLoop(): void {
		if (this.mode !== 'activity' || !this.hasAnyActivityHeat()) {
			this.stopAnimationLoop();
			return;
		}

		// Visibility gate — `setTimeout` isn't throttled when hidden, so drop the tick entirely
		// behind an unfocused window. (`document` is always present in this webview context — same
		// bare access as `_onVisibilityChange`.)
		if (document.hidden) {
			this.stopAnimationLoop();
			return;
		}

		if (this._coolingRedrawTimer != null) return;

		this._coolingRedrawTimer = setTimeout(() => {
			this._coolingRedrawTimer = undefined;
			this.renderTreemap();
			this.ensureAnimationLoop();
		}, coolingRedrawIntervalMs(this.activityDecayMs));
	}

	private stopAnimationLoop(): void {
		if (this._coolingRedrawTimer != null) {
			clearTimeout(this._coolingRedrawTimer);
			this._coolingRedrawTimer = undefined;
		}
	}

	/** True when at least one activity entry has positive read OR edit heat (live or decaying).
	 *  Cheap scan — `entries.size` is bounded by the active session count × cooldown-window file
	 *  set, typically a few dozen at most. Used to gate the redraw tick. */
	private hasAnyActivityHeat(): boolean {
		const entries = this.activity?.entries;
		if (entries == null || entries.size === 0) return false;

		for (const entry of entries.values()) {
			if (this.readHeat(entry) > 0 || this.editHeat(entry) > 0) return true;
		}
		return false;
	}

	private unwireCanvas(): void {
		const canvas = this._wiredCanvas;
		if (canvas == null) return;

		canvas.removeEventListener('mousemove', this.onMouseMove);
		canvas.removeEventListener('mouseleave', this.onMouseLeave);
		canvas.removeEventListener('click', this.onClick);
		this._resizeObserver?.unobserve(canvas);
		this._wiredCanvas = undefined;
	}

	protected override updated(changed: PropertyValues): void {
		// Wire (or re-wire) the canvas listeners whenever a new canvas instance lands. Doing this in
		// `firstUpdated` was insufficient: the empty state renders a `<div>` (no canvas), so the first
		// updated cycle has nothing to wire. Once data arrives the template swaps in the canvas.
		const canvas = this._canvas;
		const canvasJustAppeared = canvas != null && canvas !== this._wiredCanvas;
		if (canvasJustAppeared) {
			// Unwire the previous canvas (listeners + observer) before tracking the new one.
			this.unwireCanvas();
			this._resizeObserver?.observe(canvas);
			canvas.addEventListener('mousemove', this.onMouseMove);
			canvas.addEventListener('mouseleave', this.onMouseLeave);
			canvas.addEventListener('click', this.onClick);
			this._wiredCanvas = canvas;
		}

		// Anything that affects layout invalidates the cache. `data` change also invalidates the
		// per-node relPath WeakMap — the new tree has fresh `TreemapNode` instances anyway, so the
		// old entries would never get hit again; we drop the map outright for clean GC behavior
		// (the WeakMap would also let them GC, but a fresh allocation is one line and the intent
		// reads more clearly).
		const layoutChanged = changed.has('data') || changed.has('mode');
		if (changed.has('data')) {
			this._relPathByNode = new WeakMap();
		}
		if (layoutChanged) {
			// New data → re-tie the zoom path against the fresh tree. When `data` goes transiently
			// null (fetch errors, host-driven loading), we deliberately DO NOT reset `_zoomPath` —
			// the empty/loading state will render anyway (since `data?.root == null`), and when the
			// next non-null data lands we'll re-resolve against it. Resetting on the null tick would
			// silently destroy the user's breadcrumb depth across any error → recovery cycle.
			if (changed.has('data') && this._zoomPath.length > 0) {
				const root = this.data?.root;
				if (root != null) {
					// Re-resolve each segment by name against the new root so the wrapper's
					// mirrored breadcrumbs hold references that `findPath` (identity-compare) can
					// match on click. If the new tree no longer contains the path (file deleted,
					// mode changed leaves not reachable), reset and notify.
					const refreshed = resolvePathInTree(root, this._zoomPath);
					if (refreshed != null) {
						this._zoomPath = refreshed;
						this.dispatchEvent(
							new CustomEvent<TreemapZoomChangeDetail>('gl-treemap-zoom-change', {
								detail: { path: refreshed },
								bubbles: true,
								composed: true,
							}),
						);
					} else {
						this._zoomPath = [];
						this.dispatchEvent(
							new CustomEvent<TreemapZoomChangeDetail>('gl-treemap-zoom-change', {
								detail: { path: [] },
								bubbles: true,
								composed: true,
							}),
						);
					}
				}
				// Root is null (loading/error): the wrapper clears its own mirrored breadcrumbs
				// synchronously in `willUpdate`, so no dispatch is needed here. We deliberately
				// preserve the chart's internal `_zoomPath` so `resolvePathInTree` can re-anchor
				// when data returns.
			}
			this._layoutCache = undefined;
			this._renderCache = undefined;
			this._hovered = undefined;
		}

		// Repaint only when the canvas actually needs it — every Lit update is NOT a repaint trigger.
		// Mousemove mutates `_tooltipPos` and `_tooltipText` (60+/sec), which would each trigger a
		// full canvas repaint if we redrew unconditionally. Files/Activity modes draw thousands of
		// leaf rectangles uniform-sized, so the per-pixel repaint cost is visible as flicker.
		// Hover-driven repaints already happen in `onMouseMove` itself (gated on hover-target change).
		const activityChanged = (changed.has('activity') || changed.has('activityDecayMs')) && this.mode === 'activity';
		const modeChanged = changed.has('mode');
		if (canvasJustAppeared || layoutChanged || activityChanged) {
			this.renderTreemap();
		}

		// Drive the per-frame decay/pulse loop. Starts when activity arrives in Activity mode and
		// keeps going until everything has cooled to zero; stops immediately when leaving Activity
		// mode or when no live/decaying entries remain.
		if (activityChanged || modeChanged) {
			if (this.mode !== 'activity') {
				this.stopAnimationLoop();
			} else {
				this.ensureAnimationLoop();
			}
		}

		this.clampTooltipToViewport();
	}

	/** Keep the (position: fixed) tooltip inside the viewport. Render anchors it at cursor + (12, -8);
	 *  near the right/bottom edge that would overflow off-screen, so here — post-render, pre-paint —
	 *  we measure it and flip it to the other side of the cursor (or pin to the margin). Runs in
	 *  `updated()` so the adjusted position is applied before the browser paints (no visible jump). */
	private clampTooltipToViewport(): void {
		const tip = this._tooltipEl;
		if (tip == null || !this._tooltipPos.visible) return;

		const margin = 8;
		const rect = tip.getBoundingClientRect();
		const { x, y } = this._tooltipPos;

		// Horizontal: prefer right of the cursor; flip to the left when it would overflow the right
		// edge; pin to the left margin if even the flip doesn't fit.
		let left = x + 12;
		if (left + rect.width + margin > window.innerWidth) {
			left = x - 12 - rect.width;
		}
		if (left < margin) {
			left = margin;
		}

		// Vertical: prefer just above the cursor anchor; pin within the top/bottom margins.
		let top = y - 8;
		if (top + rect.height + margin > window.innerHeight) {
			top = window.innerHeight - rect.height - margin;
		}
		if (top < margin) {
			top = margin;
		}

		tip.style.left = `${left}px`;
		tip.style.top = `${top}px`;
	}

	private get root(): TreemapNode | undefined {
		return this.data?.root;
	}

	private get zoomedRoot(): TreemapNode | undefined {
		if (this._zoomPath.length === 0) return this.root;
		return this._zoomPath.at(-1);
	}

	private invalidateAndRender(): void {
		this._layoutCache = undefined;
		this._renderCache = undefined;
		this.renderTreemap();
	}

	private getRelativePath(node: TreemapNode): string {
		const cached = this._relPathByNode.get(node);
		if (cached != null) return cached;

		const rel = this._computeRelativePath(node);
		this._relPathByNode.set(node, rel);
		return rel;
	}

	private _computeRelativePath(node: TreemapNode): string {
		const rootPath = this.root?.path;
		if (rootPath == null || rootPath.length === 0) return node.path.replace(/\\/g, '/');

		let rel = node.path;
		if (rel === rootPath) {
			rel = '';
		} else {
			const rootEndsSep = rootPath.endsWith('/') || rootPath.endsWith('\\');
			if (rootEndsSep) {
				if (rel.startsWith(rootPath)) {
					rel = rel.slice(rootPath.length);
				}
			} else if (rel.startsWith(`${rootPath}/`) || rel.startsWith(`${rootPath}\\`)) {
				rel = rel.slice(rootPath.length + 1);
			}
		}
		return rel.replace(/\\/g, '/');
	}

	private getCommitCount(node: TreemapNode): number {
		const freq = this.data?.frequencies;
		if (freq == null) return 0;

		// Folder scopes use the host-aggregated `folderFrequencies` (unique-commit counts per
		// folder); only file scopes look up the per-file `frequencies` map.
		const map = node.type === 'file' ? freq.frequencies : freq.folderFrequencies;
		return map[this.getRelativePath(node)] ?? 0;
	}

	private hitTest(x: number, y: number): TreemapRect<TreemapNode> | undefined {
		const layout = this._layoutCache;
		if (layout == null) return undefined;

		let best: TreemapRect<TreemapNode> | undefined;
		for (const node of descendants(layout)) {
			if (node === layout) continue;

			if (x >= node.x0 && x <= node.x1 && y >= node.y0 && y <= node.y1) {
				if (best == null || node.depth > best.depth) {
					best = node;
				}
			}
		}
		return best;
	}

	private getTooltipText(rect: TreemapRect<TreemapNode>): string {
		const data = rect.data;
		const parts: string[] = [data.name];

		if (data.type === 'folder' && rect.children.length > 0) {
			let leafCount = 0;
			for (const _l of leaves(rect)) {
				leafCount++;
			}
			parts.push(`${leafCount} file${leafCount !== 1 ? 's' : ''}`);
		}

		if (this.mode === 'commits' && data.type === 'file') {
			const count = this.getCommitCount(data);
			parts.push(`${count} commit${count !== 1 ? 's' : ''}`);
		} else if (this.mode === 'commits' && data.type === 'folder') {
			// Unique-commit count from the host's per-folder aggregation — looking up the folder
			// path here mirrors `getCommitCount` for files but uses `folderFrequencies`.
			const folderCount = this.data?.frequencies?.folderFrequencies[this.getRelativePath(data)] ?? 0;
			if (folderCount > 0) {
				parts.push(`${folderCount} commit${folderCount !== 1 ? 's' : ''}`);
			}
		} else if (this.mode === 'activity' && data.type === 'file') {
			const entry = this.activity?.entries.get(this.getRelativePath(data));
			if (entry != null) {
				if (entry.editing === true) {
					parts.push('Editing');
				} else if (entry.reading === true) {
					parts.push('Reading');
				} else if (entry.editedAt != null && this.editHeat(entry) > 0) {
					parts.push('Edited');
				} else if (entry.readAt != null && this.readHeat(entry) > 0) {
					parts.push('Read');
				}
			}
		}

		return parts.join(' • ');
	}

	private buildLayout(width: number, height: number): TreemapRect<TreemapNode> | undefined {
		const root = this.zoomedRoot;
		if (root == null) return undefined;

		return squarify(
			root,
			leaf => {
				if (leaf.type !== 'file') return 0;
				if (this.mode === 'commits') {
					return Math.max(1, this.getCommitCount(leaf));
				}
				return leaf.size > 0 ? leaf.size : 1;
			},
			{
				width: width,
				height: height,
				paddingOuter: 3,
				paddingTop: 20,
				paddingInner: 1,
				round: true,
			},
		);
	}

	private renderTreemap(): void {
		const canvas = this._canvas;
		if (canvas == null) return;

		const ctx = canvas.getContext('2d');
		if (ctx == null) return;

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (width === 0 || height === 0) return;

		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(width * dpr);
		const targetH = Math.round(height * dpr);
		// Only reassign canvas.width/height when the backing-store size actually changed —
		// assignment re-allocates the framebuffer (and clears the canvas) every time, which on a
		// hover-driven repaint at 2x DPR throws away ~8MB per move. Setting the transform is
		// cheap, so always set that.
		if (canvas.width !== targetW || canvas.height !== targetH) {
			canvas.width = targetW;
			canvas.height = targetH;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const zoomKey = this._zoomPath.map(n => n.path).join('/');
		const cacheKey = `${zoomKey}::${this.mode}::${width}x${height}`;
		if (this._layoutCache == null || this._layoutKey !== cacheKey) {
			this._layoutCache = this.buildLayout(width, height);
			this._layoutKey = cacheKey;
		}

		const layout = this._layoutCache;
		ctx.clearRect(0, 0, width, height);

		if (layout == null) return;

		// In activity mode the whole tree fades back and we paint the active files on top with a
		// glow — chrome alpha gets multiplied by this dimming factor so the "what's editing"
		// signal reads at a glance instead of getting lost in folder structure noise. Folders on
		// the path from root to an active leaf get the full chrome (un-dimmed) so the user's eye
		// is led down the path to the highlighted file.
		const inActivity = this.mode === 'activity';
		// Ensure the per-(layout, activity) cache so per-leaf entry lookups skip the `getRelativePath`
		// regex (cheap when activity identity is unchanged — returns the existing cache). Then collect
		// folder heat FRESH every frame: it decays over time, so caching it would freeze folder
		// backgrounds at snapshot-time brightness while the leaves keep fading (and would miss a live
		// `activityDecayMs` change). The expensive part (the per-leaf path regex) stays cached via
		// `entryByNode`; only the cheap heat-walk re-runs. Skipped entirely outside activity mode.
		let activeAncestors: Map<TreemapRect<TreemapNode>, FolderHeat> | null = null;
		if (inActivity) {
			this.ensureRenderCache(layout);
			activeAncestors = this.collectActiveAncestors(layout);
		}

		// Folder backgrounds and labels
		for (const node of descendants(layout)) {
			if (node.children.length === 0 || node === layout) continue;

			const w = node.x1 - node.x0;
			const h = node.y1 - node.y0;
			if (w < 2 || h < 2) continue;

			const isHovered = node === this._hovered;
			const heat = activeAncestors?.get(node);
			const isOnActivePath = heat != null;
			// Folders containing active leaves stay at full chrome opacity (so the path is visible);
			// every other folder dims to 0.3 like the rest of the tree.
			const dim = inActivity && !isOnActivePath ? 0.3 : 1;

			if (isHovered) {
				ctx.fillStyle = `rgba(255, 255, 255, ${0.08 * dim})`;
				ctx.fillRect(node.x0, node.y0, w, h);
				ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * dim})`;
				ctx.lineWidth = 2;
				ctx.strokeRect(node.x0, node.y0, w, h);
			} else if (heat != null) {
				// True mix: paint the read (cyan) and edit (amber) chromes as two independent layers,
				// each at an opacity driven by its own heat, and let them alpha-composite. Crucially we
				// paint the *higher*-heat kind first (underneath) and the lower-heat kind last (on top)
				// at its smaller alpha — so the dominant kind shows through the thin top layer and
				// leads the color while the cooler kind only tints. The lead flips automatically as the
				// heats cross: a fresh read over a cooling edit reads cyan-dominant, and vice versa.
				const fillScale = 0.07 + node.depth * 0.012;
				const layers = [
					{ chrome: activeChromeByKind.read, heat: heat.readHeat },
					{ chrome: activeChromeByKind.edit, heat: heat.editHeat },
				]
					.filter(l => l.heat > 0)
					.sort((a, b) => b.heat - a.heat);
				for (const l of layers) {
					ctx.fillStyle = `rgba(${l.chrome.base}, ${fillScale * l.heat})`;
					ctx.fillRect(node.x0, node.y0, w, h);
				}
				ctx.lineWidth = 1.5;
				for (const l of layers) {
					// Same heat→alpha ramp as the leaf fill (see `activeAlphaForHeat`) so a folder's
					// border is never brighter than the leaf that lit it — a cool read fades on both
					// the block and its folder together, a hot one lights both.
					ctx.strokeStyle = `rgba(${l.chrome.stroke}, ${activeAlphaForHeat(l.heat)})`;
					ctx.strokeRect(node.x0, node.y0, w, h);
				}
			} else {
				ctx.fillStyle = `rgba(255, 255, 255, ${(0.02 + node.depth * 0.008) * dim})`;
				ctx.fillRect(node.x0, node.y0, w, h);
				ctx.strokeStyle = `rgba(255, 255, 255, ${(0.06 + node.depth * 0.03) * dim})`;
				ctx.lineWidth = 1;
				ctx.strokeRect(node.x0, node.y0, w, h);
			}
			ctx.lineWidth = 1;

			if (w > 30) {
				// Label uses the louder kind's tint (edit wins ties, boosted) so it stays legible
				// rather than compositing two translucent text passes.
				const labelColor = isHovered
					? `rgba(255, 255, 255, ${0.9 * dim})`
					: heat != null
						? heat.editHeat * editHeatBoost >= heat.readHeat
							? `rgba(${activeChromeByKind.edit.label}, 0.95)`
							: `rgba(${activeChromeByKind.read.label}, 0.95)`
						: `rgba(255, 255, 255, ${0.6 * dim})`;
				ctx.fillStyle = labelColor;
				ctx.font = '11px var(--vscode-font-family, sans-serif)';
				ctx.save();
				ctx.beginPath();
				ctx.rect(node.x0, node.y0, w, 18);
				ctx.clip();
				ctx.fillText(node.data.name, node.x0 + 4, node.y0 + 14);
				ctx.restore();
			}
		}
		// Shorthand for the leaf chrome reads below — once the tree's drawn, the "is this leaf
		// dimmed?" decision is purely "are we in activity mode AND this leaf isn't active?".
		const chromeDim = inActivity ? 0.3 : 1;

		// Leaf rectangles (files) — in activity mode draw inactive files first, then active files
		// on top with a glow so the highlighted edits aren't occluded by hover-stroke neighbors.
		const activeLeaves: TreemapRect<TreemapNode>[] = [];
		for (const node of leaves(layout)) {
			const w = node.x1 - node.x0;
			const h = node.y1 - node.y0;
			if (w < 1 || h < 1) continue;

			const isHovered = node === this._hovered;
			const isActive = inActivity && this.isActivityActive(node);
			if (isActive) {
				activeLeaves.push(node);
				continue;
			}

			ctx.fillStyle = this.getLeafColor(node, isHovered);
			ctx.fillRect(node.x0, node.y0, w, h);

			ctx.strokeStyle = isHovered
				? `rgba(255, 255, 255, ${0.8 * chromeDim})`
				: `rgba(255, 255, 255, ${0.12 * chromeDim})`;
			ctx.lineWidth = isHovered ? 2 : 1;
			ctx.strokeRect(node.x0, node.y0, w, h);
			ctx.lineWidth = 1;

			if (w > 40 && h > 16) {
				ctx.fillStyle = isHovered
					? `rgba(255, 255, 255, ${chromeDim})`
					: `rgba(255, 255, 255, ${0.85 * chromeDim})`;
				ctx.font = `${h > 30 ? 11 : 10}px var(--vscode-font-family, sans-serif)`;
				ctx.save();
				ctx.beginPath();
				ctx.rect(node.x0 + 2, node.y0 + 2, w - 4, h - 4);
				ctx.clip();
				ctx.fillText(node.data.name, node.x0 + 4, node.y0 + 13);
				ctx.restore();
			}
		}

		// Active files drawn last with an accent stroke per dominant kind (warm for edits, cool for
		// reads) so each recently-active file pops out of the dimmed-down background. Focused leaves
		// (touched within `focusWindowMs` — "the agent is here right now") additionally get a
		// brighter fill + heavier stroke on the canvas AND a DOM pulse overlay on top (breathing glow
		// + ping ring). The breathing/ring animation is CSS, NOT canvas: a canvas pulse rides the
		// main-thread rAF, which stutters whenever the renderer's main thread is blocked by unrelated
		// work (e.g. graph state churn) — the exact "smooth then chunky" jank we measured. CSS
		// `opacity`/`transform` keyframes run on the compositor thread and stay smooth through those
		// blocks. So here we only paint the *static* focused state; `_focusedPulses` + the overlay in
		// `render()` carry the motion.
		const offsetX = canvas.offsetLeft + canvas.clientLeft;
		const offsetY = canvas.offsetTop + canvas.clientTop;
		const pulses: FocusedPulse[] = [];

		for (const node of activeLeaves) {
			const w = node.x1 - node.x0;
			const h = node.y1 - node.y0;
			const isHovered = node === this._hovered;
			const entry = this.getEntryForLeaf(node);
			const focused = entry != null && this.isFocused(entry);
			const kind = this.getActivityKind(node) ?? 'edit';
			const chrome = activeChromeByKind[kind];

			ctx.fillStyle = this.getLeafColor(node, isHovered);
			ctx.fillRect(node.x0, node.y0, w, h);
			// Soft accent stroke for all active leaves — focused leaves are distinguished by the soft
			// glowing pulse overlay (see `_focusedPulses`), not a hard bright rectangle outline, so the
			// focused state reads as organic rather than a sharp-edged box.
			ctx.strokeStyle = `rgba(${chrome.stroke}, ${isHovered ? 0.8 : 0.55})`;
			ctx.lineWidth = isHovered ? 2 : 1.25;
			ctx.strokeRect(node.x0, node.y0, w, h);
			ctx.lineWidth = 1;

			if (focused) {
				pulses.push({
					key: this.getRelativePath(node.data),
					x: offsetX + node.x0,
					y: offsetY + node.y0,
					w: w,
					h: h,
					kind: kind,
					name: node.data.name,
					big: w > 40 && h > 16,
				});
			}

			if (w > 40 && h > 16) {
				// Bright active leaves are light cyan/amber (and lighter still under the focused glow),
				// so white text is unreadable — flip to a dark label on bright leaves and keep white on
				// the faint cooling ones (which sit over the dark editor background).
				const overallHeat = entry != null ? Math.max(this.readHeat(entry), this.editHeat(entry)) : 0;
				const brightFill = focused || overallHeat > 0.45;
				ctx.fillStyle = brightFill ? 'rgba(20, 22, 28, 0.95)' : 'rgba(255, 255, 255, 0.9)';
				ctx.font = `${h > 30 ? 11 : 10}px var(--vscode-font-family, sans-serif)`;
				ctx.save();
				ctx.beginPath();
				ctx.rect(node.x0 + 2, node.y0 + 2, w - 4, h - 4);
				ctx.clip();
				ctx.fillText(node.data.name, node.x0 + 4, node.y0 + 13);
				ctx.restore();
			}
		}

		// Hand the focused set to the DOM pulse overlay — but only reassign the reactive state when
		// the set or any rect actually moved, so the 4 fps cooling tick (which re-runs this whole
		// method) doesn't churn Lit while focus is stable.
		const key = pulses.map(p => `${p.key}@${p.x | 0},${p.y | 0},${p.w | 0}x${p.h | 0}:${p.kind}`).join('|');
		if (key !== this._focusedPulsesKey) {
			this._focusedPulsesKey = key;
			this._focusedPulses = pulses;
		}
	}

	/** Effective age (ms) of the entry's read-side, factoring in local elapsed time since the
	 *  snapshot was captured. `entry.readAt` is the host's ms-since-PreToolUse at serialize time;
	 *  we add the time the webview has been holding this snapshot. Returns `Infinity` when the
	 *  entry has no read-side timestamp so callers can compare uniformly. */
	private readEffectiveAge(entry: ActivityEntry): number {
		if (entry.readAt == null) return Infinity;

		const snapshotAt = this.activity?.snapshotAt ?? performance.now();
		return entry.readAt + (performance.now() - snapshotAt);
	}

	/** Effective age (ms) of the entry's edit-side. See {@link readEffectiveAge}. */
	private editEffectiveAge(entry: ActivityEntry): number {
		if (entry.editedAt == null) return Infinity;

		const snapshotAt = this.activity?.snapshotAt ?? performance.now();
		return entry.editedAt + (performance.now() - snapshotAt);
	}

	/** Linear-decay heat ∈ [0, 1] for the read-side of an entry. Hits zero once the effective age
	 *  reaches `activityDecayMs`. A live `reading === true` flag forces full heat regardless of
	 *  age — covers the "tool started but the next snapshot hasn't aged the timestamp yet" gap. */
	private readHeat(entry: ActivityEntry): number {
		if (entry.reading === true) return 1;

		const age = this.readEffectiveAge(entry);
		if (!Number.isFinite(age)) return 0;
		return Math.max(0, 1 - age / this.activityDecayMs);
	}

	/** Linear-decay heat ∈ [0, 1] for the edit-side of an entry. See {@link readHeat}. */
	private editHeat(entry: ActivityEntry): number {
		if (entry.editing === true) return 1;

		const age = this.editEffectiveAge(entry);
		if (!Number.isFinite(age)) return 0;
		return Math.max(0, 1 - age / this.activityDecayMs);
	}

	/** Lookup the activity entry for a leaf rect. Reads from the per-(layout, activity) render cache
	 *  when available — populated by {@link ensureRenderCache} before any per-leaf work in
	 *  `renderTreemap`. Falls back to a one-shot lookup for off-render-path callers (tooltip hover,
	 *  click handlers) where the cache may not be built. `null` is a valid "no entry" cache hit. */
	private getEntryForLeaf(node: TreemapRect<TreemapNode>): ActivityEntry | null {
		const cache = this._renderCache;
		if (cache != null && cache.activity === this.activity && cache.entryByNode.has(node)) {
			return cache.entryByNode.get(node) ?? null;
		}
		return this.activity?.entries.get(this.getRelativePath(node.data)) ?? null;
	}

	/** True when a leaf's repo-relative path has any positive heat (read OR edit) in the activity
	 *  map. Only meaningful in activity mode; callers gate on `mode === 'activity'` before calling. */
	private isActivityActive(node: TreemapRect<TreemapNode>): boolean {
		const entry = this.getEntryForLeaf(node);
		if (entry == null) return false;
		return this.readHeat(entry) > 0 || this.editHeat(entry) > 0;
	}

	/** True when an entry is "in focus" — the agent is here *right now*. Drives the brightness boost
	 *  + pulse. Focus is recency-based (freshest touch within {@link focusWindowMs}) rather than
	 *  strictly in-flight, because file tools complete in milliseconds so the `reading`/`editing`
	 *  flag is never observable on its own. The flags still force focus when set. As the agent
	 *  works through files, focus moves from one freshly-touched leaf to the next. */
	private isFocused(entry: ActivityEntry): boolean {
		if (entry.reading === true || entry.editing === true) return true;

		const freshest = Math.min(this.readEffectiveAge(entry), this.editEffectiveAge(entry));
		return Number.isFinite(freshest) && freshest < focusWindowMs;
	}

	/** Returns the entry's *dominant* kind based on current heat — the louder side wins. Edit gets
	 *  a `editHeatBoost` multiplier so a ~50/50 split still tilts toward "agent is working on it"
	 *  rather than splitting the leaf into a neutral middle. Returns `undefined` when no kind has
	 *  heat. Used for the per-leaf glow/stroke and folder-ancestor coloring. */
	private getActivityKind(node: TreemapRect<TreemapNode>): ActivityKind | undefined {
		const entry = this.getEntryForLeaf(node);
		if (entry == null) return undefined;

		const readH = this.readHeat(entry);
		const editH = this.editHeat(entry) * editHeatBoost;
		if (readH <= 0 && editH <= 0) return undefined;
		return editH >= readH ? 'edit' : 'read';
	}

	/** Cache build: populates `entryByNode` (per-leaf entry lookup) per (layout, activity) tuple.
	 *  The redraw tick hits the same tuple every frame until the next IPC notification, so building
	 *  this once amortizes ~4.5k `getRelativePath` regex/Map.get calls down to a single build per
	 *  activity snapshot. Folder heat is intentionally NOT cached here — it's time-dependent (decays
	 *  every frame), so {@link collectActiveAncestors} is re-run fresh per render off this cache. */
	private ensureRenderCache(layout: TreemapRect<TreemapNode>): TreemapRenderCache {
		const existing = this._renderCache;
		if (existing?.layout === layout && existing.activity === this.activity) {
			return existing;
		}

		// Pre-populate `entryByNode` for every leaf so subsequent `getEntryForLeaf` calls (from
		// `getActivityKind`, `isActivityActive`, `activityColor`, the focused-pass lookup) hit
		// O(1) instead of doing per-leaf `getRelativePath` + Map.get. `null` is a valid hit when
		// the leaf has no entry — `WeakMap.has` distinguishes "absent from cache" from "absent
		// from activity"; `getEntryForLeaf` relies on that.
		const entryByNode = new WeakMap<TreemapRect<TreemapNode>, ActivityEntry | null>();
		const entries = this.activity?.entries;
		if (entries != null && entries.size > 0) {
			for (const node of leaves(layout)) {
				entryByNode.set(node, entries.get(this.getRelativePath(node.data)) ?? null);
			}
		}

		const cache = {
			layout: layout,
			activity: this.activity,
			entryByNode: entryByNode,
		};
		this._renderCache = cache;
		return cache;
	}

	/** Walk the layout once and collect folder rects that have at least one active leaf descendant,
	 *  paired with the peak read and edit heat across that folder's subtree (see {@link FolderHeat}).
	 *  The folder renderer composites the two kinds as separate cyan/amber layers by those heats, so
	 *  a mixed subtree shows both hues weighted by recency rather than a single averaged color.
	 *  Called via {@link ensureRenderCache}. */
	private collectActiveAncestors(root: TreemapRect<TreemapNode>): Map<TreemapRect<TreemapNode>, FolderHeat> {
		const result = new Map<TreemapRect<TreemapNode>, FolderHeat>();
		const entries = this.activity?.entries;
		if (entries == null || entries.size === 0) return result;

		// Returns the peak read/edit heat of the subtree rooted at `node`, recording it on each
		// folder passed on the way back up so the renderer can composite the two kinds independently.
		const visit = (node: TreemapRect<TreemapNode>): FolderHeat => {
			if (node.children.length === 0) {
				const entry = this.getEntryForLeaf(node);
				if (entry == null) return { readHeat: 0, editHeat: 0 };
				return { readHeat: this.readHeat(entry), editHeat: this.editHeat(entry) };
			}

			let readHeat = 0;
			let editHeat = 0;
			for (const child of node.children) {
				const sub = visit(child);
				if (sub.readHeat > readHeat) {
					readHeat = sub.readHeat;
				}
				if (sub.editHeat > editHeat) {
					editHeat = sub.editHeat;
				}
			}

			if (node !== root && (readHeat > 0 || editHeat > 0)) {
				result.set(node, { readHeat: readHeat, editHeat: editHeat });
			}
			return { readHeat: readHeat, editHeat: editHeat };
		};
		visit(root);
		return result;
	}

	private getLeafColor(node: TreemapRect<TreemapNode>, hovered: boolean): string {
		switch (this.mode) {
			case 'files':
				return this.fileColor(node, hovered);
			case 'commits':
				return this.commitColor(node, hovered);
			case 'activity':
				return this.activityColor(node, hovered);
		}
	}

	private fileColor(node: TreemapRect<TreemapNode>, hovered: boolean): string {
		const hue = getExtensionHue(node.data.name);
		return `hsla(${hue}, 50%, ${hovered ? 50 : 38}%, ${hovered ? 0.8 : 0.65})`;
	}

	private commitColor(node: TreemapRect<TreemapNode>, hovered: boolean): string {
		const freq: CommitFrequencyData | undefined = this.data?.frequencies;
		if (freq == null || freq.maxFrequency === 0) {
			return hovered ? 'rgba(80, 80, 80, 0.5)' : 'rgba(50, 50, 50, 0.4)';
		}

		const count = this.getCommitCount(node.data);
		const t = Math.log1p(count) / Math.log1p(freq.maxFrequency);
		const boost = hovered ? 15 : 0;

		if (t < 0.01) {
			return hovered ? 'rgba(60, 70, 60, 0.5)' : 'rgba(40, 50, 40, 0.35)';
		}
		return `hsla(${120 - t * 120}, ${60 + t * 20}%, ${25 + t * 20 + boost}%, ${0.5 + t * 0.35})`;
	}

	/** Heat overlay for Activity mode. Cold rectangles fall back to a muted neutral so the user can
	 *  still see the file structure. Active rectangles paint a *blend* of the read (cool cyan) and
	 *  edit (warm amber) chrome RGB triples, weighted by each kind's current heat ∈ [0, 1] with an
	 *  edit-side boost so a roughly equal read+edit mix still leans toward "agent is working on
	 *  this". Heat decays linearly from 1 → 0 over `activityDecayMs` ms after the last PreToolUse
	 *  for that kind; while `reading`/`editing` is `true`, heat is pinned at 1. Focused leaves get a
	 *  *static* brightness lift here — the breathing animation rides the CSS pulse overlay (see
	 *  `_focusedPulses` / `renderTreemap`), not the canvas fill, so this color stays constant frame
	 *  to frame and the canvas only repaints on real changes (data/hover/cooling), never per pulse. */
	private activityColor(node: TreemapRect<TreemapNode>, hovered: boolean): string {
		const entry = this.getEntryForLeaf(node);
		if (entry == null) {
			return hovered ? 'rgba(60, 70, 90, 0.45)' : 'rgba(40, 50, 70, 0.3)';
		}

		const readH = this.readHeat(entry);
		const editH = this.editHeat(entry);
		const editWeighted = editH * editHeatBoost;
		const total = readH + editWeighted;
		if (total <= 0) {
			return hovered ? 'rgba(60, 70, 90, 0.45)' : 'rgba(40, 50, 70, 0.3)';
		}

		// Blend the two RGB chromes by relative heat. `editWeight = 1` → pure edit amber;
		// `editWeight = 0` → pure read cyan. With the edit boost, a literal 50/50 split still
		// lands at ~60/40 edit-favored — keeps "agent is working" louder than passive observation.
		const editWeight = editWeighted / total;
		let mixedRgb = lerpRgb(activeChromeByKind.read.base, activeChromeByKind.edit.base, editWeight);

		let alpha: number;
		if (this.isFocused(entry)) {
			// Static brightness lift (no sine) so the focused leaf reads brighter than the cooling
			// tail at all times; the breathing is the CSS overlay's job. Use the midpoint of the old
			// pulse swing so the fill matches the overlay's resting brightness.
			mixedRgb = brightenRgb(mixedRgb, (focusedBrightnessMin + focusedBrightnessMax) / 2);
			alpha = 0.85 + (hovered ? 0.1 : 0);
		} else {
			// Overall heat (max of read/edit) drives alpha for cooling leaves — a hot read is just
			// as opaque as a hot edit; only the hue differs. The floor is intentionally low (0.18) so
			// the heatmap decay actually *reads*: a freshly-cooled leaf is ~as bright as a focused one
			// (continuous across the focus→cool handoff at heat≈0.99), fading to nearly invisible as it
			// approaches the end of the decay window. Folder strokes use the same curve so a folder is
			// never brighter than the leaf that lit it. Hover lifts it for cursor focus.
			const overallHeat = Math.max(readH, editH);
			alpha = activeAlphaForHeat(overallHeat) + (hovered ? 0.1 : 0);
		}
		return `rgba(${mixedRgb}, ${Math.min(1, alpha)})`;
	}

	private readonly onMouseMove = (e: MouseEvent): void => {
		const canvas = this._canvas;
		if (canvas == null) return;

		const rect = canvas.getBoundingClientRect();
		const node = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
		const changed = node !== this._hovered;
		this._hovered = node;

		// Both `_tooltipText` and `_tooltipPos` are `@state` — every assignment queues a Lit
		// re-render. mousemove fires at ~60Hz, so guarding the writes (set only on actual change)
		// avoids running the entire update/render pipeline per mouse pixel.
		if (node != null) {
			// Every non-root hit is now actionable — folders zoom, file leaves dispatch
			// `gl-treemap-file-click` (wrapper routes to open / file history / focus session).
			if (canvas.style.cursor !== 'pointer') {
				canvas.style.cursor = 'pointer';
			}
			const nextText = this.getTooltipText(node);
			if (this._tooltipText !== nextText) {
				this._tooltipText = nextText;
			}
			// Tooltip position uses `position: fixed` so we must follow the mouse — but we can
			// avoid the @state write when nothing material changed.
			const prev = this._tooltipPos;
			if (prev.x !== e.clientX || prev.y !== e.clientY || !prev.visible) {
				this._tooltipPos = { x: e.clientX, y: e.clientY, visible: true };
			}
		} else {
			if (canvas.style.cursor !== 'default') {
				canvas.style.cursor = 'default';
			}
			if (this._tooltipPos.visible) {
				this._tooltipPos = { ...this._tooltipPos, visible: false };
			}
		}

		if (changed) {
			this.renderTreemap();
		}
	};

	private readonly onMouseLeave = (): void => {
		if (this._hovered != null) {
			this._hovered = undefined;
			this._tooltipPos = { ...this._tooltipPos, visible: false };
			this.renderTreemap();
		}
	};

	private readonly onClick = (e: MouseEvent): void => {
		const canvas = this._canvas;
		if (canvas == null) return;

		const rect = canvas.getBoundingClientRect();
		const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
		if (hit == null) return;

		// Folder click → zoom into that folder. File click → emit a domain-agnostic `file-click`
		// event; the wrapper interprets it per mode (open / file history / focus agent session).
		if (hit.data.type === 'file') {
			this.dispatchEvent(
				new CustomEvent<TreemapFileClickDetail>('gl-treemap-file-click', {
					detail: { node: hit.data },
					bubbles: true,
					composed: true,
				}),
			);
			return;
		}

		this.zoomTo(hit.data);
	};

	/** Programmatically zoom to a specific node. Public so the wrapper's toolbar breadcrumbs can
	 *  navigate (their click handlers live outside the chart's shadow DOM). */
	zoomTo(node: TreemapNode): void {
		const root = this.root;
		if (root == null) return;

		if (node === root) {
			this._zoomPath = [];
		} else {
			const path: TreemapNode[] = [];
			const found = findPath(root, node, path);
			if (!found) return;

			this._zoomPath = path;
		}

		this.dispatchEvent(
			new CustomEvent<TreemapZoomChangeDetail>('gl-treemap-zoom-change', {
				detail: { path: this._zoomPath },
				bubbles: true,
				composed: true,
			}),
		);

		this.invalidateAndRender();
	}

	override render(): unknown {
		const root = this.root;
		const hasData = root != null && (root.children?.length ?? 0) > 0;

		// Mirrors `gl-timeline-chart`'s loader behavior: when there's nothing on screen yet AND
		// the parent is fetching, show the watermark pulse over a blurred surface. Once any data
		// has landed we keep the canvas painted (no flash to empty) — the parent doesn't currently
		// signal soft refreshes, but the structure is in place if it ever does.
		if (!hasData) {
			return html`<div class="empty">
				${this.loading
					? html`<gl-watermark-loader pulse><p>Loading…</p></gl-watermark-loader>`
					: html`<gl-watermark-loader><p>No files to visualize</p></gl-watermark-loader>`}
			</div>`;
		}

		// Activity mode with no in-flight edits — paint the dimmed tree underneath, but float a
		// small hint over it so the user knows the visualization is alive and waiting. Disappears
		// the moment any session's `fileActivity` lights up a leaf.
		const showActivityHint =
			this.mode === 'activity' && (this.activity == null || this.activity.entries.size === 0) && !this.loading;

		// Breadcrumbs are rendered by the wrapper (`gl-graph-treemap`) in the shared header row
		// alongside the visualization switcher, period picker, and agents cluster — see
		// `renderBreadcrumbs` in the wrapper. The chart still owns the zoom state and dispatches
		// `gl-treemap-zoom-change` whenever it shifts, so the wrapper's crumbs follow.
		return html`
			<canvas id="treemap-canvas" role="img" aria-label="File tree treemap"></canvas>
			${this.mode === 'activity' && this._focusedPulses.length > 0
				? html`<div class="pulse-layer" aria-hidden="true">
						${repeat(
							this._focusedPulses,
							p => p.key,
							p =>
								html`<div
									class="activity-pulse activity-pulse--${p.kind}"
									style=${cspStyleMap({
										left: `${p.x}px`,
										top: `${p.y}px`,
										width: `${p.w}px`,
										height: `${p.h}px`,
										// Broadcast echo tracks the leaf's own width/height (floored) so it starts ≈
										// the leaf's shape and expands beyond at any zoom.
										'--echo-w': `${Math.max(p.w, 20)}px`,
										'--echo-h': `${Math.max(p.h, 20)}px`,
										'--pulse-period': `${livePulsePeriodMs}ms`,
									})}
								>
									${p.big ? html`<span class="activity-pulse-label">${p.name}</span>` : nothing}
								</div>`,
						)}
					</div>`
				: nothing}
			${this.loading
				? html`<div class="notice notice--blur">
						<gl-watermark-loader pulse><p>Loading…</p></gl-watermark-loader>
					</div>`
				: nothing}
			${showActivityHint
				? html`<div class="activity-hint">
						<code-icon icon="robot"></code-icon>
						<span>Waiting for agent activity — files will light up here as agents read or edit them</span>
					</div>`
				: nothing}
			${this._tooltipPos.visible
				? html`<div
						id="treemap-tooltip"
						class="tooltip"
						style=${cspStyleMap({
							left: `${this._tooltipPos.x + 12}px`,
							top: `${this._tooltipPos.y - 8}px`,
						})}
					>
						${this._tooltipText}
					</div>`
				: nothing}
		`;
	}
}

function findPath(current: TreemapNode, target: TreemapNode, path: TreemapNode[]): boolean {
	if (current === target) return true;
	if (current.children == null) return false;

	for (const child of current.children) {
		if (findPath(child, target, path)) {
			path.unshift(child);
			return true;
		}
	}
	return false;
}

/** Re-tie a path of stale TreemapNode references to fresh node identities under `root`. Each
 *  step matches by `name + type`. Returns the new path or `undefined` if any segment can't be
 *  resolved — caller treats that as "reset zoom". */
function resolvePathInTree(root: TreemapNode, path: TreemapNode[]): TreemapNode[] | undefined {
	const refreshed: TreemapNode[] = [];
	let current: TreemapNode = root;
	for (const node of path) {
		const child = current.children?.find(c => c.name === node.name && c.type === node.type);
		if (child == null) return undefined;

		refreshed.push(child);
		current = child;
	}
	return refreshed;
}

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-treemap-zoom-change': CustomEvent<TreemapZoomChangeDetail>;
		'gl-treemap-file-click': CustomEvent<TreemapFileClickDetail>;
	}
	interface HTMLElementTagNameMap {
		'gl-treemap-chart': GlTreemapChart;
	}
}
