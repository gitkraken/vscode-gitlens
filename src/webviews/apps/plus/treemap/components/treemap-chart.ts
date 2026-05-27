import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
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

/** Surrounding-chrome RGB triples for active-leaf highlights in Activity mode, keyed by tool
 *  kind. Each entry parallels the leaf fill (see `activityColor`): writes get a warm amber halo /
 *  stroke / folder tint; reads get a cool blue/cyan one. Stored as `'r, g, b'` strings so callers
 *  paste them straight into `rgba(${chrome.field}, alpha)` template literals. */
const activeChromeByKind: Record<'read' | 'write', { base: string; stroke: string; label: string; glow: string }> = {
	write: {
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
		 * currently editing a file. Disappears the moment any session's currentFiles lights up. */
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
	`;

	@property({ attribute: false })
	data: TreemapData | undefined;

	@property({ type: String, reflect: true })
	mode: TreemapMode = 'files';

	/** Files currently being edited or read by any agent attributed to the active repo, keyed by
	 *  repo-relative path (forward-slash). `heat` is preserved as a 0–1 intensity field for future
	 *  multi-level visualizations, but in the current implementation the parent always emits 1 for
	 *  active files — the host already handles temporal smoothing via its ~120s post-tool
	 *  cooldown, so the chart doesn't need to model decay itself. `kind` distinguishes write-class
	 *  tools (Edit/Write/MultiEdit/NotebookEdit) from read-only tools (Read/NotebookRead); the
	 *  parent enforces write precedence when both apply to the same path. */
	@property({ attribute: false })
	activity?: ReadonlyMap<string, { heat: number; kind: 'read' | 'write' }>;

	/** External "loading" signal from the parent — set while the host is fetching aggregate data.
	 *  Matches `gl-timeline-chart`'s `loading` prop; renders the same `<gl-watermark-loader pulse>`
	 *  overlay so both viz modes share the affordance and motion. */
	@property({ type: Boolean, reflect: true })
	loading = false;

	@state() private _zoomPath: TreemapNode[] = [];
	@state() private _tooltipText = '';
	@state() private _tooltipPos = { x: 0, y: 0, visible: false };

	@query('#treemap-canvas')
	private _canvas?: HTMLCanvasElement;

	private _resizeObserver?: ResizeObserver;
	private _hovered?: TreemapRect<TreemapNode>;
	private _layoutCache?: TreemapRect<TreemapNode>;
	private _layoutKey = '';
	/** Marker for the canvas instance whose listeners we've already wired. The canvas may not exist
	 *  during `firstUpdated` (the empty state renders a `<div>` instead) — wiring happens lazily in
	 *  `updated()` once the canvas appears, but we don't want to re-wire on every render. */
	private _wiredCanvas?: HTMLCanvasElement;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._resizeObserver = new ResizeObserver(() => this.invalidateAndRender());
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		// Detach canvas listeners explicitly — without this, the detached canvas keeps closure
		// references to `this` (mousemove/mouseleave/click handlers) and the LitElement leaks
		// until the canvas itself is GC'd. Bounded leak per disconnect cycle, but accumulates.
		this.unwireCanvas();
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

		// Anything that affects layout invalidates the cache.
		const layoutChanged = changed.has('data') || changed.has('mode');
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
			this._hovered = undefined;
		}

		// Repaint only when the canvas actually needs it — every Lit update is NOT a repaint trigger.
		// Mousemove mutates `_tooltipPos` and `_tooltipText` (60+/sec), which would each trigger a
		// full canvas repaint if we redrew unconditionally. Files/Activity modes draw thousands of
		// leaf rectangles uniform-sized, so the per-pixel repaint cost is visible as flicker.
		// Hover-driven repaints already happen in `onMouseMove` itself (gated on hover-target change).
		const activityChanged = changed.has('activity') && this.mode === 'activity';
		if (canvasJustAppeared || layoutChanged || activityChanged) {
			this.renderTreemap();
		}
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
		this.renderTreemap();
	}

	private getRelativePath(node: TreemapNode): string {
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
			const entry = this.activity?.get(this.getRelativePath(data));
			if (entry != null && entry.heat > 0) {
				parts.push(entry.kind === 'write' ? 'Editing' : 'Reading');
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
		const activeAncestors = inActivity ? this.collectActiveAncestors(layout) : null;

		// Folder backgrounds and labels
		for (const node of descendants(layout)) {
			if (node.children.length === 0 || node === layout) continue;

			const w = node.x1 - node.x0;
			const h = node.y1 - node.y0;
			if (w < 2 || h < 2) continue;

			const isHovered = node === this._hovered;
			const isOnActivePath = activeAncestors?.has(node) ?? false;
			// Folders containing active leaves stay at full chrome opacity (so the path is visible);
			// every other folder dims to 0.3 like the rest of the tree.
			const dim = inActivity && !isOnActivePath ? 0.3 : 1;

			const activeKind = activeAncestors?.get(node);
			const chrome = activeKind != null ? activeChromeByKind[activeKind] : undefined;

			ctx.fillStyle = isHovered
				? `rgba(255, 255, 255, ${0.08 * dim})`
				: chrome != null
					? // Tint active-path folder backgrounds with the dominant kind's hue (warm for
						// writes, cool for reads) so the breadcrumb path reads as a color, not just a
						// brightness change — matches the leaf colorization at the bottom.
						`rgba(${chrome.base}, ${0.04 + node.depth * 0.01})`
					: `rgba(255, 255, 255, ${(0.02 + node.depth * 0.008) * dim})`;
			ctx.fillRect(node.x0, node.y0, w, h);

			ctx.strokeStyle = isHovered
				? `rgba(255, 255, 255, ${0.5 * dim})`
				: chrome != null
					? `rgba(${chrome.stroke}, 0.5)`
					: `rgba(255, 255, 255, ${(0.06 + node.depth * 0.03) * dim})`;
			ctx.lineWidth = isHovered ? 2 : isOnActivePath ? 1.5 : 1;
			ctx.strokeRect(node.x0, node.y0, w, h);
			ctx.lineWidth = 1;

			if (w > 30) {
				ctx.fillStyle = isHovered
					? `rgba(255, 255, 255, ${0.9 * dim})`
					: chrome != null
						? `rgba(${chrome.label}, 0.95)`
						: `rgba(255, 255, 255, ${0.6 * dim})`;
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

		// Active files drawn last, with a canvas shadow ("glow") so each in-flight edit pops out
		// of the dimmed-down background regardless of zoom or how many leaves are around it. Glow
		// + accent stroke per kind so warm-fill writes get a warm halo and cool-fill reads stay
		// cool — keeps the leaf fill and surrounding chrome on the same hue.
		for (const node of activeLeaves) {
			const w = node.x1 - node.x0;
			const h = node.y1 - node.y0;
			const isHovered = node === this._hovered;
			const kind = this.getActivityKind(node) ?? 'write';
			const chrome = activeChromeByKind[kind];

			ctx.save();
			ctx.shadowColor = `rgba(${chrome.glow}, 0.9)`;
			ctx.shadowBlur = 12;
			ctx.fillStyle = this.getLeafColor(node, isHovered);
			ctx.fillRect(node.x0, node.y0, w, h);
			ctx.restore();

			ctx.strokeStyle = `rgba(${chrome.stroke}, 0.9)`;
			ctx.lineWidth = isHovered ? 2.5 : 1.5;
			ctx.strokeRect(node.x0, node.y0, w, h);
			ctx.lineWidth = 1;

			if (w > 40 && h > 16) {
				ctx.fillStyle = 'rgba(255, 255, 255, 1)';
				ctx.font = `${h > 30 ? 11 : 10}px var(--vscode-font-family, sans-serif)`;
				ctx.save();
				ctx.beginPath();
				ctx.rect(node.x0 + 2, node.y0 + 2, w - 4, h - 4);
				ctx.clip();
				ctx.fillText(node.data.name, node.x0 + 4, node.y0 + 13);
				ctx.restore();
			}
		}
	}

	/** True when a leaf's repo-relative path matches an entry in the `activity` map. Only meaningful
	 *  in activity mode; callers gate on `mode === 'activity'` before calling. */
	private isActivityActive(node: TreemapRect<TreemapNode>): boolean {
		const map = this.activity;
		if (map == null || map.size === 0) return false;

		const heat = map.get(this.getRelativePath(node.data))?.heat ?? 0;
		return heat > 0;
	}

	/** Returns the active leaf's kind (`'write'` or `'read'`), or `undefined` when not active. */
	private getActivityKind(node: TreemapRect<TreemapNode>): 'read' | 'write' | undefined {
		const entry = this.activity?.get(this.getRelativePath(node.data));
		if (entry == null || entry.heat <= 0) return undefined;

		return entry.kind;
	}

	/** Walk the layout once and collect folder rects that have at least one active leaf descendant,
	 *  tagged with the dominant kind below them. Folders containing any write descendant resolve to
	 *  `'write'`; pure-read subtrees resolve to `'read'`. The folder renderer + active-leaf chrome
	 *  read from this map so ancestor tints, glow, and strokes all match the leaf colorization
	 *  (writes warm, reads cool) instead of a single hardcoded hue. */
	private collectActiveAncestors(root: TreemapRect<TreemapNode>): Map<TreemapRect<TreemapNode>, 'read' | 'write'> {
		const result = new Map<TreemapRect<TreemapNode>, 'read' | 'write'>();
		const map = this.activity;
		if (map == null || map.size === 0) return result;

		const visit = (node: TreemapRect<TreemapNode>): 'read' | 'write' | undefined => {
			if (node.children.length === 0) {
				return this.getActivityKind(node);
			}

			let dominant: 'read' | 'write' | undefined;
			for (const child of node.children) {
				const childKind = visit(child);
				if (childKind === 'write') {
					dominant = 'write';
				} else if (childKind === 'read' && dominant !== 'write') {
					dominant = 'read';
				}
			}
			if (dominant != null && node !== root) {
				result.set(node, dominant);
			}
			return dominant;
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

	/** Heat overlay for Activity mode. Cold rectangles fall back to a muted neutral so the user
	 *  can still see the file structure; active rectangles paint per-kind in near-complementary
	 *  hues — writes glow warm orange→yellow (active work), reads stay cool blue→cyan (passive
	 *  observation). Heat ∈ [0, 1] is supplied per-file by the parent component (see
	 *  `gl-graph-treemap`). */
	private activityColor(node: TreemapRect<TreemapNode>, hovered: boolean): string {
		const entry = this.activity?.get(this.getRelativePath(node.data));
		const heat = entry?.heat ?? 0;
		const boost = hovered ? 0.15 : 0;

		if (heat > 0) {
			if (entry!.kind === 'read') {
				// Cool blue→cyan, lower saturation than writes so writes always read as "louder".
				const hue = 210 - heat * 30; // 210° → 180° (blue → cyan)
				const sat = 55 - heat * 10;
				const lightness = Math.min(80, 40 + heat * 20 + boost * 60);
				const alpha = 0.45 + heat * 0.25;
				return `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
			}

			// Warm orange→yellow, ~180° opposite the read ramp on the wheel.
			const hue = 25 + heat * 25; // 25° → 50° (orange → amber)
			const sat = 90 - heat * 10;
			const lightness = Math.min(85, 45 + heat * 15 + boost * 100);
			const alpha = 0.55 + heat * 0.35;
			return `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
		}
		return hovered ? 'rgba(60, 70, 90, 0.45)' : 'rgba(40, 50, 70, 0.3)';
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
		// the moment any session's `currentFiles` lights up a leaf.
		const showActivityHint =
			this.mode === 'activity' && (this.activity == null || this.activity.size === 0) && !this.loading;

		// Breadcrumbs are rendered by the wrapper (`gl-graph-treemap`) in the shared header row
		// alongside the visualization switcher, period picker, and agents cluster — see
		// `renderBreadcrumbs` in the wrapper. The chart still owns the zoom state and dispatches
		// `gl-treemap-zoom-change` whenever it shifts, so the wrapper's crumbs follow.
		return html`
			<canvas id="treemap-canvas" role="img" aria-label="File tree treemap"></canvas>
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
