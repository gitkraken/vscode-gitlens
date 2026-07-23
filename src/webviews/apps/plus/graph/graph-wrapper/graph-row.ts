import { buildAriaLabel } from '@gitkraken/commit-graph/a11y.js';
import { colorForColumn, contrastColor, withAlpha } from '@gitkraken/commit-graph/colors.js';
import type { GraphCommit, ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { LaneWindow } from '@gitkraken/commit-graph/laneClamp.js';
import { graphEdgeFadePx, rowShiftedGutterWidth } from '@gitkraken/commit-graph/laneClamp.js';
import type { ChangesColumnMode, RowStats } from '@gitkraken/commit-graph/stats.js';
import {
	changesModeOrDefault,
	changesTrackWidth,
	computeChangesBarWidths,
	computeChangesBipolarWidths,
	computeChangesSquares,
	formatChangesFiles,
} from '@gitkraken/commit-graph/stats.js';
import type { GraphPlacement, RefsPlacement, ResolvedGraphStyle, ZoneSpec } from '@gitkraken/commit-graph/view.js';
import { relativeTime, rowGutterWidth, xForColumn } from '@gitkraken/commit-graph/view.js';
import type { TemplateResult } from 'lit';
import { html, nothing, svg } from 'lit';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { pluralize } from '@gitlens/utils/string.js';
import { agentSuffixIconFor } from '../../../shared/agentUtils.js';
import type { StyleInfo } from '../../../shared/components/csp-style-map.directive.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import type { RunningOperationBucket } from '../components/detailsState.js';
import { rowAdornmentTooltipFor, statusIconFor } from '../components/runningOperationStatus.js';
import type { WipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { agentIndicatorTooltipFor } from '../components/wipRowAgentStatus.js';
import type { GutterCache } from './graph-gutter-cache.js';
import type { NodeStyle } from './graph-gutter.js';
import { nodeRadiusFor } from './graph-gutter.js';
import '../../../shared/components/code-icon.js';

/**
 * Pure Lit port of the React `GraphRow` from `GraphView.tsx`. Renders one virtualized row:
 * the lane gutter (standalone or inline) plus the multi-zone content (refs / message /
 * author / date / sha). Interaction is delegated at the host (click / dblclick / contextmenu
 * resolve `data-sha` / ref pills / `data-lane-tip` from `composedPath`), so this stays a pure
 * render function with no per-row closures — required for cheap virtualizer recycling.
 *
 * lit-virtualizer positions the row element itself, so (unlike the React renderer's absolute
 * `top`) we set only `height` here.
 */

export interface RowRenderContext {
	/** The row's commit payload (message/author/date/context). Engine rows are topology-only —
	 *  the host resolves the aligned commit and passes it here so payload swaps never touch rows. */
	commit: GraphCommit;
	index: number;
	total: number;
	rowHeight: number;
	/** Sticky-timeline hairline: this row's bucket (Today/Yesterday/This week/...) differs from the row
	 *  above it — renders a `.gl-graph__row-timeline-sep` overlay (1px, no row/height cost; fades out
	 *  before the lane gutter — see graph.scss). See `gl-lit-graph.ts`'s `renderRowItem`. */
	isBucketBoundary?: boolean;
	/** Fixed standalone graph-column width (used in `column` placement) — the lane-art width, NOT
	 *  including the fold strip (see `foldLaneWidth`). */
	gutterWidth: number;
	/** Width of the dedicated lane-fold strip prepended to the lanes (0 when folding is disabled). */
	foldLaneWidth: number;
	/** Displayed width of the graph column (fold strip + gutter viewport). When narrower than the lane
	 *  content (`gutterWidth + foldLaneWidth`), the gutter clips + scrolls horizontally. */
	graphColumnWidth: number;
	/** Cap width (fold strip excluded) for GROUPED placement — the epoch-wide fit ceilinged to the inline-
	 *  lane setting. Each row's inline gutter hugs its OWN footprint (`rowGutterWidth`) up to this; a row
	 *  past it clips here, its lanes past the cap collapsing to the edge via the (static, offset-0) clamp. */
	inlineGutterWidth: number;
	/** GROUPED placement with a revealed (non-zero) lane offset: rows switch from hugging their own
	 *  absolute footprint to hugging their VISIBLE extent at that offset (`rowShiftedGutterWidth`) — all
	 *  windowed builds in ONE shifted lane range (mixing unwindowed lanes-0..n gutters in would fracture
	 *  the lanes into two coordinate systems). Offset-0 flow resumes when the reveal returns. */
	groupedShifted?: boolean;
	/** The revealed lane offset (px) backing `groupedShifted` — 0 when unshifted. */
	laneOffset?: number;
	columnWidth: number;
	/** Shared ref to the host's per-sha diffstat map (files/additions/deletions) driving the Changes
	 *  column; an absent key means that row's stats are still pending (the cell renders blank). */
	rowsStats?: Readonly<Record<string, RowStats>>;
	/** Narrowest graph-column width: render nodes as a single dot rail (no lane spread / connectors). */
	singleColumn?: boolean;
	/** Lane build window (deep scrolled graphs) — edge art wholly outside it is skipped in the gutter
	 *  build; undefined = build every lane. See `computeLaneWindow`. */
	laneWindow?: LaneWindow;
	zones: readonly ZoneSpec[];
	/** Teleport-scroll skeleton: render the STRUCTURAL row — zones, the (cache-shared) gutter, message/
	 *  author/date/sha text — and skip the expensive extras (ref pills, avatars, actions, adornments,
	 *  aria/context payloads). Same zone layout + gutter cache keys as the full row, so the settle swap
	 *  only fills in the extras; the lanes never repaint. */
	skeleton?: boolean;
	/** Row layout: single-line zone columns vs the stacked 2-line layout for narrow panes. */
	style: ResolvedGraphStyle;
	/**
	 * Where the lane art renders: `column` = its own leftmost column; `grouped` = folded into
	 * the first visible content column; `hidden` = no lanes at all.
	 */
	graphPlacement: GraphPlacement;
	/** Visible-column slot the graph occupies in column mode (interleaved among the zone cells). */
	graphColumnPos: number;
	/** When the graph is grouped, the host zone id its lanes render on — BY ID, not position — so the
	 *  [graph + host] pair travels together through reorders. Undefined when not grouped, or grouped with
	 *  no resolvable host (falls back to `graphColumnPos`'s anchor-slot clamp). */
	graphHostId?: string;
	/** Where refs render: `grouped` = pills at the head of the first content column (default); `column`
	 *  = a dedicated Refs column (expanded density only). Drives whether refs prepend inline. */
	refsPlacement: RefsPlacement;
	/** When refs are grouped (inline), the host zone id they render on — BY ID, not position — so the
	 *  [refs + host] group travels together through reorders instead of jumping to whatever lands
	 *  leftmost. Undefined when refs are a column. */
	refsHostId?: string;
	/** `showGhostRefsOnRowHover` — shows a faint ghost ref pill (the branch/tag the row's lane belongs
	 *  to) in the dedicated Refs column only, on hover/selection, for rows that render no ref adornment
	 *  (commit/merge rows only; never workdir or stash; never inline — that would reserve layout space
	 *  on every ref-less row). See `ghostRef` for the resolved pill content. */
	showGhostRefs?: boolean;
	/** Per-`gl-lit-graph` memo over `renderGutterSvg` — the instance's gutter-template cache. Its epoch
	 *  is set once per render by the host; `renderRow` keys into it per row. */
	gutterCache: GutterCache;
	/** Commit-node style: small geometric dot vs author avatar/initials at the lane. */
	nodeMode: 'compact' | 'avatar';
	/** Whether avatar images (vs author letters) are used for identity nodes + the author cell. */
	avatars: boolean;
	/** Workdir-only clean/dirty WIP signal for the node glyph (undefined = no glyph / not loaded). */
	wipState?: 'clean' | 'dirty';
	/** Workdir-only: running compose/review operation state — drives the action buttons' status icons. */
	wipOperation?: RunningOperationBucket;
	/** Workdir-only: attached AI-agent status — drives the agent-indicator action button. */
	wipAgent?: WipRowAgentStatus;
	/** Workdir-only: whether this worktree's working tree has merge/rebase conflicts — gates the Resolve action button. */
	hasConflicts?: boolean;
	/** Commit/merge-only: the commit is ahead of HEAD's upstream — drives the always-on Push-to-Commit
	 *  indicator (and flips the row-action strip into per-button mode so the indicator shows at rest). */
	isUnpushed?: boolean;
	/** Commit/merge-only: resolved Undo Commit target (leaf worktree HEAD), when undo is offered. The
	 *  optional `worktreePath` routes the undo to a non-active worktree; `branchName` labels the button. */
	undoTarget?: { worktreePath?: string; branchName?: string };
	/** Commit/merge-only: a WIP/workdir row sits on this commit (it's a worktree branch tip) — gates the
	 *  Jump to Working Changes action (the inverse of the WIP row's Jump to Branch Tip). */
	hasWipRow?: boolean;
	/** Right-click context for the author avatar zone (contributor menu) — stamped on the avatar element
	 *  itself so it's NEARER than the row's own `commit.contextData` and wins there. */
	avatarVscodeContext?: string;
	isSelected: boolean;
	isFocused: boolean;
	isAnchor: boolean;
	anchorKind?: 'focal' | 'fork' | 'target';
	/** The target row is ALSO the fork point (merge-base === target tip) — adds a combined base marker. */
	anchorAlsoFork?: boolean;
	isDimmed: boolean;
	/** Row matches the active search (normal mode) — gets the search-highlight treatment. */
	isSearchMatch: boolean;
	isInRefChain: boolean;
	/** Fold chevron for this row, when its node tips a collapsible lane segment (folding enabled).
	 *  Rendered in the dedicated fold strip at the lanes' left edge. */
	foldContent?: readonly TemplateResult[];
	/** Ref chips for this row (inline at the head of the first content column). */
	refsContent?: readonly TemplateResult[];
	/** Adornments slotted before the message (e.g. lane-collapse chevron, stack chip). */
	messageAdornments?: readonly TemplateResult[];
	adornmentLabel?: string;
	formatDate?: (date: number) => string;
	/** Resolved avatar image URL for this commit's author email, when available (undefined when the URL
	 *  previously failed to load — the caller already treats a miss as "no avatar", so failure and
	 *  "unknown" fall back to initials identically). */
	avatarUrl?: string;
	/** Reports a failed avatar image load (email + attempted url); a single bound reference shared by
	 *  every row (not a per-row closure) — reads the failed element's email/url off the DOM event. */
	onAvatarError?: (event: Event) => void;
	/** Tip sha when this row's node toggles a collapsible lane segment. */
	laneTipSha?: string;
	/** True when this row's collapsible lane segment is currently collapsed (drives `aria-expanded`). */
	laneCollapsed?: boolean;
	/** The ghost-ref pill's content for a ref-less row: the primary visible ref (head/remote/tag) of
	 *  this row's lane-segment tip — i.e. the branch/tag this commit BELONGS to, not the row's own sha.
	 *  Resolved upstream (`segmentByCommit` + `getCommit`, filtered through the active ref-visibility
	 *  filters) so this stays a plain per-row value; `undefined` when the tip has no visible ref (an
	 *  unnamed/detached lane) — never falls back to a sha. */
	ghostRef?: { name: string; kind: 'head' | 'remote' | 'tag' };
}

// Returned as a `StyleInfo` for the `styleMap` directive (NOT a `style="..."` attribute
// string): the graph webview's CSP forbids inline style attributes (`style-src` has no
// `'unsafe-inline'`), so styles must be set via CSSOM — which `styleMap` does, mirroring how
// the React `GraphView` applied its `style` prop.
function zoneStyle(zone: ZoneSpec): Readonly<StyleInfo> {
	// Zero-scroll solved widths (`zone.width` is the solved currentWidth by render time): the fill zone
	// may shrink (0 1) to absorb any sub-px/rounding overflow but does NOT grow — otherwise the body row
	// (full scroller width) would stretch it past the header, which stops short at the reserved end
	// gutter. Every other zone is rigid (0 0). Columns then hold precisely and align with the header.
	const w = `${zone.width}px`;
	if (zone.flex) return { flex: `0 1 ${w}`, minWidth: `${zone.minWidth}px` };
	return { flex: `0 0 ${w}`, width: w, minWidth: `${zone.minWidth}px` };
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

	const last = parts.at(-1) ?? parts[0];
	return (parts[0][0] + last[0]).toUpperCase();
}

// Author names are a small, tab-lifetime-bounded set; cache so the regex split runs once per
// distinct name instead of per visible row per render (called from both the node + author cell).
// LRU-bounded so a long-lived session evicts the coldest names incrementally instead of wiping
// the whole cache (and its hot entries) at the cap.
const initialsCache = new LruMap<string, string>(5000);
function cachedInitials(name: string): string {
	let value = initialsCache.get(name);
	if (value == null) {
		value = initials(name);
		initialsCache.set(name, value);
	}
	return value;
}

function anchorTitle(kind: RowRenderContext['anchorKind'], alsoFork?: boolean): string {
	switch (kind) {
		case 'focal':
			return 'Focus branch tip';
		case 'fork':
			return 'Fork point';
		case 'target':
			return alsoFork === true ? 'Merge target & fork point' : 'Merge target';
		default:
			return 'Scope anchor';
	}
}

// Scope-anchor marker pills (legacy "TARGET" parity): a labeled, colored chip rendered BEFORE the
// branch pills so the thin rail isn't the only cue for what an anchor row is. Target wins as the primary
// label; when a row is also the fork point a "Base" chip follows. The focal tip is skipped — its own
// branch pill already names it.
function anchorMarkerPill(kind: 'fork' | 'target', icon: string, label: string): TemplateResult {
	return html`<span
		class="gl-graph__anchor-pill gl-graph__anchor-pill--${kind}"
		data-tooltip=${label === 'Target' ? 'Merge target' : 'Fork point (base)'}
		><code-icon icon=${icon}></code-icon><span class="gl-graph__anchor-pill-label">${label}</span></span
	>`;
}

function renderAnchorMarkers(ctx: RowRenderContext): TemplateResult | typeof nothing {
	if (!ctx.isAnchor) return nothing;

	if (ctx.anchorKind === 'target') {
		const target = anchorMarkerPill('target', 'target', 'Target');
		return ctx.anchorAlsoFork ? html`${target}${anchorMarkerPill('fork', 'git-merge', 'Base')}` : target;
	}
	if (ctx.anchorKind === 'fork') {
		return anchorMarkerPill('fork', 'git-merge', 'Base');
	}
	return nothing;
}

/** A single ref-chip container for the first content column (inline refs), with any scope-anchor
 *  marker pills prepended before the branch/tag pills, and an optional resolved ghost ref appended. */
function renderInlineRefs(
	row: ProcessedGraphRow,
	refs: readonly TemplateResult[],
	ctx: RowRenderContext,
	ghost?: RowRenderContext['ghostRef'],
): TemplateResult {
	return html`<span class="gl-graph__refs" data-sha=${row.sha}
		>${renderAnchorMarkers(ctx)}${refs}${ghost != null ? renderGhostRefPill(ghost, row.column) : nothing}</span
	>`;
}

/** Whether the row has a scope-anchor marker to show (so the refs cell renders even with no branch pills). */
function hasAnchorMarker(ctx: RowRenderContext): boolean {
	return ctx.isAnchor === true && (ctx.anchorKind === 'target' || ctx.anchorKind === 'fork');
}

/** Whether a ref-less row gets the ghost pill: the config is on, the row is a normal commit/merge —
 *  never a workdir/WIP row or a stash (neither has a meaningful "ref-less" state) — AND its lane tip
 *  actually resolved to a visible ref (`ctx.ghostRef`); an unnamed/detached lane shows no ghost at all. */
function wantsGhostRef(row: ProcessedGraphRow, ctx: RowRenderContext): boolean {
	return ctx.showGhostRefs === true && row.kind !== 'workdir' && row.kind !== 'stash' && ctx.ghostRef != null;
}

/** Icon for the ghost pill's resolved ref kind — mirrors the resting pill's plain kind icons (no
 *  worktree/provider variants; a ghost is a hint, not a full pill). */
const ghostRefIcon: Record<'head' | 'remote' | 'tag', string> = { head: 'vm', remote: 'cloud', tag: 'tag' };

/** Faint placeholder ghost pill — the BRANCH/TAG this ref-less row's lane BELONGS TO (its lane-segment
 *  tip's primary ref), not the row's own sha — rendered ONLY in the dedicated Refs column (see
 *  `renderZoneContent` case 'ref') — inline placement never shows one, so a ref-less row never reserves
 *  layout space for it. Label is always the bare ref name (never `owner/name`, even when
 *  `showRemoteNames` is on) — a ghost is a hint, not a full pill. Revealed on row hover/selection only
 *  (pure CSS, see `.gl-graph__ref-pill--ghost` in graph.scss), faded to a low-opacity real pill there —
 *  not interactive. Colored by the row's lane (not a resolved ref color, since the ghost never resolves
 *  a full ref chip) via the same `--ref-*` custom props a real pill gets, mirroring `refStyle`'s
 *  non-head branch (`refAdornmentProvider.ts`) without importing it — the two stay decoupled. */
function renderGhostRefPill(ghost: NonNullable<RowRenderContext['ghostRef']>, column: number): TemplateResult {
	const color = colorForColumn(column);
	return html`<span
		class="gl-graph__ref-pill gl-graph__ref-pill--ghost"
		aria-hidden="true"
		style=${cspStyleMap({
			'--ref-color': color,
			'--ref-on-color': contrastColor(color),
			'--ref-bg': 'transparent',
			'--ref-border': withAlpha(color, 0.6),
		})}
		><span class="gl-graph__ref-pill-icon"><code-icon icon=${ghostRefIcon[ghost.kind]}></code-icon></span
		><span class="gl-graph__ref-pill-label">${ghost.name}</span></span
	>`;
}

/** The author avatar (image, or author initials when no image). Normally only in dot node-mode — in
 *  avatar node-mode the graph node IS the avatar, so showing it again would duplicate — but `forceAvatar`
 *  overrides that: the min-width author cell drops the name and shows the avatar as the sole identity cue.
 *  Workdir/WIP rows have no author, so they get no avatar (and thus no reserved avatar gap). A plain <img>
 *  (not <gl-avatar>) — the row already shows the author name + a full rich hover, so the avatar's own
 *  hover/tooltip would be redundant; all we need here is the image. */
function renderAvatar(
	row: ProcessedGraphRow,
	ctx: RowRenderContext,
	forceAvatar = false,
): TemplateResult | typeof nothing {
	if (row.kind === 'workdir') return nothing;
	if (ctx.nodeMode !== 'compact' && !forceAvatar) return nothing;

	const url = ctx.avatars ? ctx.avatarUrl : undefined;
	// Nearer than the row's own `data-vscode-context` (the commit context), so a click ON the avatar
	// resolves the contributor menu while a click elsewhere on the row still gets the commit menu.
	const avatarContext = ctx.avatarVscodeContext ?? nothing;
	return url != null && url.length > 0
		? html`<img
				class="gl-graph__avatar"
				src=${url}
				alt=""
				aria-hidden="true"
				data-vscode-context=${avatarContext}
				data-avatar-email=${ctx.commit.authorEmail}
				@error=${ctx.onAvatarError}
			/>`
		: html`<span
				class="gl-graph__avatar gl-graph__avatar--initials"
				aria-hidden="true"
				data-vscode-context=${avatarContext}
				>${cachedInitials(ctx.commit.author)}</span
			>`;
}

/** The author avatar + name (expanded author cell). No per-cell tooltip — the full-row rich
 *  hover covers author/email/date/sha/message details. At the column's min width the name can't fit,
 *  so drop it and show just the avatar (forced on even in avatar node-mode) as the identity cue. */
function renderAuthor(row: ProcessedGraphRow, ctx: RowRenderContext, atMinWidth: boolean): TemplateResult {
	if (atMinWidth) return html`${renderAvatar(row, ctx, true)}`;
	return html`${renderAvatar(row, ctx)}<span class="gl-graph__author">${ctx.commit.author}</span>`;
}

// Simplified inline markup for commit messages: `code`, **bold**, *italic* / _italic_. Deliberately
// NOT full markdown — no links, headings, lists, or `$(icon)` (those stay out of gl-markdown's shadow
// DOM; we render light-DOM <code>/<strong>/<em> styled in graph.scss for full control). A cheap string
// scan that runs only for visible rows and returns the raw string untouched when there is no markup or
// no run resolves (the common case allocates nothing extra). lit auto-escapes text nodes, so commit
// text is never injected as HTML.
//
// The `\S…\S` emphasis guards require a non-space just inside the delimiters so a bare multiplication
// ("3 * 4") isn't italicized; the `\b` around `_…_` keeps `snake_case` identifiers intact. Bold is
// tried before italic so `**x**` reads as bold, not two empty italics.
const inlineMarkupRe = /`([^`]+)`|\*\*(\S(?:[^*]*\S)?)\*\*|\*(\S(?:[^*]*\S)?)\*|\b_(\S(?:[^_]*\S)?)_\b/g;

function renderInlineMarkup(text: string): unknown {
	if (!text.includes('`') && !text.includes('*') && !text.includes('_')) return text;

	const parts: Array<string | TemplateResult> = [];
	let last = 0;
	for (const m of text.matchAll(inlineMarkupRe)) {
		const idx = m.index ?? 0;
		if (idx > last) {
			parts.push(text.slice(last, idx));
		}
		if (m[1] != null) {
			parts.push(html`<code class="gl-graph__message-code">${m[1]}</code>`);
		} else if (m[2] != null) {
			parts.push(html`<strong>${m[2]}</strong>`);
		} else {
			parts.push(html`<em>${m[3] ?? m[4]}</em>`);
		}
		last = idx + m[0].length;
	}
	// No delimiter formed a valid run (e.g. a lone `*`) — return the original string, no extra nodes.
	if (parts.length === 0) return text;

	if (last < text.length) {
		parts.push(text.slice(last));
	}
	return parts;
}

// Commit message: the subject (first line) in the foreground color, then — when the commit has a body
// — a muted bullet separator + the body collapsed to a single line in muted color (matching the legacy
// graph). Inline markup (`code`, **bold**, *italic*) renders in both parts. The whole line lives inside
// the truncating `.gl-graph__message` container, so overflow ellipsizes at the END: the body truncates
// first and the subject stays. Newlines in the body collapse to spaces (the body may span multiple
// paragraphs).
//
// `message` is the function's only input (no row/config/style state leaks in), so the whole built
// `TemplateResult` is memoized by message — same pattern as `GutterCache`: handing back the SAME
// instance on a hit lets Lit skip reconciling the subtree, not just skip the split + regex scan.
const messageContentCache = new LruMap<string, TemplateResult>(2000);
function renderMessageContent(message: string): TemplateResult {
	let result = messageContentCache.get(message);
	if (result != null) return result;

	const { summary, body } = splitCommitMessage(message);
	const bodyText = body ? body.replace(/\s+/g, ' ').trim() : '';
	result = html`<span class="gl-graph__message-subject">${renderInlineMarkup(summary)}</span>${bodyText
			? html`<span class="gl-graph__message-sep">•</span
					><span class="gl-graph__message-body">${renderInlineMarkup(bodyText)}</span>`
			: nothing}`;
	messageContentCache.set(message, result);
	return result;
}

// The Changes cell's tooltip + aria text: "N files changed, N lines added, N lines deleted", each part
// omitted when zero. `pluralize` thousands-separates ≥4-digit counts. Cached by the stable stats object
// (both the memoized cell and the per-row aria path read it, the latter every render for every row).
const changesAriaTextCache = new WeakMap<RowStats, string>();
function changesAriaText(stats: RowStats): string {
	let text = changesAriaTextCache.get(stats);
	if (text != null) return text;

	const parts: string[] = [];
	if (stats.files) {
		parts.push(`${pluralize('file', stats.files)} changed`);
	}
	if (stats.additions) {
		parts.push(`${pluralize('line', stats.additions)} added`);
	}
	if (stats.deletions) {
		parts.push(`${pluralize('line', stats.deletions)} deleted`);
	}
	text = parts.join(', ');
	changesAriaTextCache.set(stats, text);
	return text;
}

// The Changes column's per-row cell: files count + hairline + the mode's magnitude viz. Pure fn of
// (stats, mode); plain spans only (no per-row custom elements); absent stats = pending → `nothing`.
// Memoized by (stats, mode): the SAME TemplateResult on a hit lets Lit skip the cell's subtree.
const changesCellCache = new WeakMap<RowStats, Partial<Record<ChangesColumnMode, TemplateResult>>>();
function renderChangesCell(
	zone: ZoneSpec,
	row: ProcessedGraphRow,
	ctx: RowRenderContext,
): TemplateResult | typeof nothing {
	if (ctx.skeleton) return nothing;

	const stats = ctx.rowsStats?.[row.sha];
	if (stats == null) return nothing;

	const mode = changesModeOrDefault(zone.mode);
	let byMode = changesCellCache.get(stats);
	const cached = byMode?.[mode];
	if (cached != null) return cached;

	// No data-tooltip here: a tooltip-bearing element suppresses the row hover card (tooltip exclusivity),
	// and the stats already ride the row's aria-label + hover surface.
	const result = html`<span class="gl-graph__changes"
		><span class="gl-graph__changes-files"
			><span class="codicon codicon-files gl-graph__changes-files-icon" aria-hidden="true"></span
			><span class="gl-graph__changes-files-count">${formatChangesFiles(stats.files)}</span></span
		>${renderChangesViz(mode, stats)}</span
	>`;
	byMode ??= {};
	byMode[mode] = result;
	changesCellCache.set(stats, byMode);
	return result;
}

// The mode-specific magnitude visualization inside the Changes cell. Segment widths flow through
// `cspStyleMap` (the graph webview's CSP forbids inline style attributes); colors come from graph.scss.
function renderChangesViz(mode: ChangesColumnMode, stats: RowStats): TemplateResult {
	const { additions, deletions } = stats;
	switch (mode) {
		case 'numbers':
			// U+2212 MINUS SIGN (not an ASCII hyphen) so the deletions read as a true minus at this weight.
			return html`<span class="gl-graph__changes-numbers"
				><span class="gl-graph__changes-added">+${additions}</span
				><span class="gl-graph__changes-deleted">−${deletions}</span></span
			>`;
		case 'squares': {
			const squares = computeChangesSquares(additions, deletions);
			return html`<span class="gl-graph__changes-squares"
				><span class="gl-graph__changes-churn">${additions + deletions}</span
				><span class="gl-graph__changes-squares-cells"
					>${squares.map(
						fill => html`<span class="gl-graph__changes-square gl-graph__changes-square--${fill}"></span>`,
					)}</span
				></span
			>`;
		}
		case 'bipolar': {
			// Widths as PERCENTAGES of the (CSS-sized, responsive) track — the math stays px-vs-78 so the
			// magnitude scale is unchanged at the default width, and the cached template stays zone-independent.
			const { addedWidth, deletedWidth } = computeChangesBipolarWidths(additions, deletions);
			const half = changesTrackWidth / 2;
			return html`<span class="gl-graph__changes-bipolar"
				><span class="gl-graph__changes-bipolar-axis" aria-hidden="true"></span
				><span
					class="gl-graph__changes-bipolar-deleted"
					style=${cspStyleMap({ width: `${((deletedWidth / half) * 50).toFixed(2)}%` })}
				></span
				><span
					class="gl-graph__changes-bipolar-added"
					style=${cspStyleMap({ width: `${((addedWidth / half) * 50).toFixed(2)}%` })}
				></span
			></span>`;
		}
		default: {
			// 'bar' — the churn-magnitude fill split into added/deleted segments, as % of the responsive track.
			const { addedWidth, deletedWidth } = computeChangesBarWidths(additions, deletions);
			return html`<span class="gl-graph__changes-bar"
				><span
					class="gl-graph__changes-bar-added"
					style=${cspStyleMap({ width: `${((addedWidth / changesTrackWidth) * 100).toFixed(2)}%` })}
				></span
				><span
					class="gl-graph__changes-bar-deleted"
					style=${cspStyleMap({ width: `${((deletedWidth / changesTrackWidth) * 100).toFixed(2)}%` })}
				></span
			></span>`;
		}
	}
}

/**
 * Inner content of a expanded zone cell (no leading gutter/refs — those go on the first zone).
 * Plain function (not a per-row closure factory) so it allocates nothing extra per visible row.
 */
/** Teleport-scroll skeleton gutter: the row's pass-through lanes as STRAIGHT verticals (a `row.edges`
 *  lookup — no geometry pass, no raster, no connector curves) plus a lane-colored dot at the row's lane
 *  x, pinned inside the visible width like the clamp pins real dots. `graph-edge` class so the lines pick
 *  up the real edges' stroke styling; the settle swap restores curves/connectors in place. The dot uses
 *  the ACTIVE node mode's radius so the settle swap fills it in place instead of jumping sizes. */
function renderSkeletonGutter(
	row: ProcessedGraphRow,
	width: number,
	rowHeight: number,
	columnWidth: number,
	singleColumn: boolean,
	laneOffset: number,
	nodeMode: NodeStyle['mode'],
): TemplateResult {
	// SCREEN coordinates: subtract the active lane offset (grouped reveal / column h-scroll) so skeleton
	// dots + lanes land where the real (clamp-written) geometry will — absolute x here would paint the
	// lanes unshifted for the burst and snap them on settle.
	// The mode's radius, SHRUNK to fit narrow shifted rows (a lone lane at the offset yields a viewport
	// narrower than an avatar dot); the pin bounds match the real node's CSS clamp (left at the
	// first-lane `--gutter-pin-x`, right trailing by radius + 2) so edge-pinned dots don't shift on the
	// settle swap.
	const r = Math.min(nodeRadiusFor(nodeMode), Math.max(2, Math.floor(width / 2) - 2));
	const inset = r + 2;
	const pinX = xForColumn(0, columnWidth);
	const x = (singleColumn ? xForColumn(0, columnWidth) : xForColumn(row.column, columnWidth)) - laneOffset;
	const cx = width < pinX + inset ? width / 2 : Math.max(pinX, Math.min(x, width - inset));
	const lanes: TemplateResult[] = [];
	if (!singleColumn) {
		for (const key in row.edges) {
			const col = Number(key);
			const lx = xForColumn(col, columnWidth) - laneOffset;
			if (lx < 0 || lx >= width || row.edges[col].passThrough == null) continue;

			lanes.push(
				svg`<line class="graph-edge" x1=${lx} y1="0" x2=${lx} y2=${rowHeight} stroke=${colorForColumn(col)} />`,
			);
		}
	}
	return html`<svg class="graph-gutter" aria-hidden="true" role="presentation" width=${width} height=${rowHeight}>
		${lanes}
		<circle cx=${cx} cy=${rowHeight / 2} r=${r} fill=${colorForColumn(row.column)} />
	</svg>`;
}

function renderZoneContent(
	zone: ZoneSpec,
	row: ProcessedGraphRow,
	ctx: RowRenderContext,
	relativeDate: string | undefined,
): TemplateResult | typeof nothing {
	// Workdir/WIP rows carry no author/date/sha/changes — leave those cells empty so columns align.
	if (
		row.kind === 'workdir' &&
		(zone.id === 'author' || zone.id === 'datetime' || zone.id === 'sha' || zone.id === 'changes')
	) {
		return nothing;
	}

	switch (zone.id) {
		case 'ref': {
			// Skeleton rows skip pills entirely (the settle fills them in).
			if (ctx.skeleton) return nothing;

			// Dedicated Refs column: the same ref pills that otherwise render inline, in their own cell.
			const refs = ctx.refsContent ?? [];
			if (refs.length > 0 || hasAnchorMarker(ctx)) return renderInlineRefs(row, refs, ctx);

			return wantsGhostRef(row, ctx) ? renderInlineRefs(row, refs, ctx, ctx.ghostRef) : nothing;
		}
		case 'message':
			return html`${ctx.messageAdornments?.length
					? html`<span class="gl-graph__msg-adornments">${ctx.messageAdornments}</span>`
					: nothing}<span class="gl-graph__message">${renderMessageContent(ctx.commit.message)}</span>`;
		case 'author':
			return renderAuthor(row, ctx, zone.width <= zone.minWidth);
		case 'datetime':
			return html`<span class="gl-graph__date">${relativeDate ?? ''}</span>`;
		case 'sha':
			return html`<span class="gl-graph__sha">${ctx.commit.shortHash}</span>`;
		case 'changes':
			return renderChangesCell(zone, row, ctx);
		default:
			return nothing;
	}
}

// Compact 2-line layout: the avatar spans BOTH lines (left, vertically centered); line 1 = inline
// refs + adornments + message; line 2 = sha (monospace, left edge) · author, with the date pushed
// to the right edge. Workdir rows have no author/date/sha, so line 2 is skipped.
function renderListBody(
	row: ProcessedGraphRow,
	ctx: RowRenderContext,
	inlineGutter: TemplateResult | typeof nothing,
	inlineRefs: TemplateResult | typeof nothing,
	relativeDate: string | undefined,
): TemplateResult {
	const isWorkdir = row.kind === 'workdir';
	// Line 2 carries the branch/WIP pills FIRST, then the commit metadata (sha · author … date). Workdir
	// rows have no sha/author/date, so line 2 is just their WIP pills. Line 1 is the message alone.
	const meta = isWorkdir
		? nothing
		: html`<span class="gl-graph__sha">${ctx.commit.shortHash}</span>
				<span class="gl-graph__author">${ctx.commit.author}</span>
				<span class="gl-graph__date gl-graph__list-date">${relativeDate ?? ''}</span>`;
	const line2 =
		!isWorkdir || inlineRefs !== nothing
			? html`<div class="gl-graph__list-line2">${inlineRefs}${meta}</div>`
			: nothing;
	return html`${inlineGutter}${renderAvatar(row, ctx)}
		<div class="gl-graph__list-content">
			<div class="gl-graph__list-line1">
				${ctx.messageAdornments?.length
					? html`<span class="gl-graph__msg-adornments">${ctx.messageAdornments}</span>`
					: nothing}
				<span class="gl-graph__message">${renderMessageContent(ctx.commit.message)}</span>
			</div>
			${line2}
		</div>`;
}

// A row-action button's optional status suffix icon (compose/review operation state, or the agent
// indicator's category) — a small corner badge that spins while generating/working.
function renderActionStatus(icon: string | null | undefined, spin: boolean): TemplateResult | typeof nothing {
	return icon != null && icon.length > 0
		? html`<code-icon class="gl-graph__row-action-status" icon=${icon} modifier=${spin ? 'spin' : ''}></code-icon>`
		: nothing;
}

/** Whether a row's action strip has a PERSISTENT button (agent attached, an active resolve/compose/
 *  review op, or an unpushed commit) — i.e. it switches to per-button `--has-persistent` mode instead of
 *  the whole-strip hover/focus/selected fade. NOT simply `kind === 'workdir'` — a workdir row with no
 *  agent/active op is JUST as hover-gated as a commit row. Exported so callers outside the row template
 *  (the sticky-timeline pill's yield-to-row check) read the EXACT same decision `renderRowActions` makes
 *  below, rather than re-deriving/drifting from it. */
export function hasPersistentRowActions(
	kind: ProcessedGraphRow['kind'],
	wipAgent: WipRowAgentStatus | undefined,
	wipOperation: RunningOperationBucket | undefined,
	isUnpushed: boolean | undefined,
): boolean {
	if (kind === 'workdir') {
		return (
			wipAgent != null ||
			wipOperation?.resolve != null ||
			wipOperation?.compose != null ||
			wipOperation?.review != null
		);
	}
	if (kind === 'stash') return false;
	return isUnpushed === true;
}

// Row-action strip (right-aligned): per row kind — workdir gets Resolve (conflicts only) / Compose /
// Review / Stash-Save (+ an agent indicator when agents are attached), stash gets Apply/Drop, commit/
// merge gets Undo (leaf worktree tip) / Open-Changes / Push-to-Commit (unpushed). Buttons carry
// data-row-action / data-wip-open; gl-lit-graph's click delegation turns them into the
// gl-graph-rowaction / gl-graph-wiprowopen events the wrapper routes to the host. WIP buttons reflect
// the live resolve/compose/review operation + agent status.
//
// Per-button visibility (matches the legacy adornment): each button is `--persistent` (always shown) or
// `--gated` (revealed only on row hover/focus/selected). When a row has ANY persistent button the strip
// adds `--has-persistent` and switches to per-button mode (CSS, zero JS); otherwise it keeps the whole-
// strip fade. Persistent cases: an active agent, an active resolve/compose/review operation, the
// unpushed badge.
function renderRowActions(row: ProcessedGraphRow, ctx: RowRenderContext): TemplateResult {
	let actions: TemplateResult;
	let hasPersistent = false;
	switch (row.kind) {
		case 'workdir': {
			const op = ctx.wipOperation;
			const composeActive = op?.compose != null;
			const reviewActive = op?.review != null;
			const composeHasResult = op?.compose?.result != null;
			const reviewHasResult = op?.review?.result != null;
			const composeStatus = op?.compose != null ? statusIconFor(op.compose.execState, composeHasResult) : null;
			const reviewStatus = op?.review != null ? statusIconFor(op.review.execState, reviewHasResult) : null;
			const composeTip = rowAdornmentTooltipFor('compose', op?.compose?.execState, composeHasResult);
			const reviewTip = rowAdornmentTooltipFor('review', op?.review?.execState, reviewHasResult);
			const agent = ctx.wipAgent;
			const agentIcon = agent != null ? agentSuffixIconFor(agent.category) : undefined;
			const agentTip = agent != null ? agentIndicatorTooltipFor(agent.category) : '';
			const resolveActive = op?.resolve != null;
			const resolveHasResult = op?.resolve?.result != null;
			const resolveStatus = op?.resolve != null ? statusIconFor(op.resolve.execState, resolveHasResult) : null;
			const resolveTip = rowAdornmentTooltipFor('resolve', op?.resolve?.execState, resolveHasResult);
			// Resolve only appears at all when there's something to resolve (or a run is already engaged) —
			// unlike Compose/Review, which are always-available actions on any workdir row.
			const showResolve = resolveActive || ctx.hasConflicts === true;

			// Active compose/review stay visible at rest so their status icon reads; idle ones reveal on
			// interaction. The agent indicator is always visible when present.
			hasPersistent = hasPersistentRowActions(row.kind, agent, op, undefined);

			actions = html`${agent != null
					? html`<button
							class="gl-graph__row-action gl-graph__row-action--persistent gl-graph__row-action--agent agent-indicator--${agent.category}"
							type="button"
							data-wip-open="agents"
							data-tooltip=${agentTip}
							aria-label=${agentTip}
						>
							<code-icon icon="robot"></code-icon>${renderActionStatus(
								agentIcon,
								agent.category === 'working',
							)}
						</button>`
					: nothing}${showResolve
					? html`<button
							class="gl-graph__row-action ${resolveActive
								? 'gl-graph__row-action--persistent'
								: 'gl-graph__row-action--gated'}"
							type="button"
							data-wip-open="resolve"
							data-tooltip=${resolveTip}
							aria-label=${resolveTip}
						>
							<code-icon icon="gl-merge"></code-icon>${renderActionStatus(
								resolveStatus,
								resolveStatus === 'loading',
							)}
						</button>`
					: nothing}<button
					class="gl-graph__row-action ${composeActive
						? 'gl-graph__row-action--persistent'
						: 'gl-graph__row-action--gated'}"
					type="button"
					data-wip-open="compose"
					data-tooltip=${composeTip}
					aria-label=${composeTip}
				>
					<code-icon icon="wand"></code-icon>${renderActionStatus(composeStatus, composeStatus === 'loading')}</button
				><button
					class="gl-graph__row-action ${reviewActive
						? 'gl-graph__row-action--persistent'
						: 'gl-graph__row-action--gated'}"
					type="button"
					data-wip-open="review"
					data-tooltip=${reviewTip}
					aria-label=${reviewTip}
				>
					<code-icon icon="checklist"></code-icon>${renderActionStatus(
						reviewStatus,
						reviewStatus === 'loading',
					)}</button
				><button
					class="gl-graph__row-action gl-graph__row-action--gated"
					type="button"
					data-row-action="stash-save"
					data-tooltip="Stash All Changes..."
					aria-label="Stash All Changes..."
				>
					<code-icon icon="gl-stash-save"></code-icon></button
				>${ctx.commit.parents[0] != null
					? html`<button
							class="gl-graph__row-action gl-graph__row-action--gated"
							type="button"
							data-jump-sha=${ctx.commit.parents[0]}
							data-tooltip="Jump to Branch Tip"
							aria-label="Jump to Branch Tip"
						>
							<code-icon icon="download"></code-icon>
						</button>`
					: nothing}`;
			break;
		}
		case 'stash':
			actions = html`<button
					class="gl-graph__row-action gl-graph__row-action--gated"
					type="button"
					data-row-action="stash-apply"
					data-tooltip="Apply / Pop Stash..."
					aria-label="Apply / Pop Stash..."
				>
					<code-icon icon="git-stash-apply"></code-icon></button
				><button
					class="gl-graph__row-action gl-graph__row-action--gated"
					type="button"
					data-row-action="stash-drop"
					data-tooltip="Drop Stash..."
					aria-label="Drop Stash..."
				>
					<code-icon icon="trash"></code-icon>
				</button>`;
			break;
		default: {
			// commit / merge: Undo Commit (leaf worktree tip only) + Open All Changes (Alt = with working
			// tree, resolved in the click handler) + the always-on unpushed Push-to-Commit badge. The push
			// badge is persistent and rendered LAST so it stays pinned to the right edge while the gated
			// actions grow leftward; on pushed rows the whole strip stays hover-only (no persistent button).
			const undo = ctx.undoTarget;
			const isUnpushed = ctx.isUnpushed === true;
			hasPersistent = hasPersistentRowActions(row.kind, undefined, undefined, isUnpushed);
			const undoLabel = undo?.branchName != null ? `Undo Commit on ${undo.branchName}` : 'Undo Commit';

			actions = html`${undo != null
					? html`<button
							class="gl-graph__row-action gl-graph__row-action--gated"
							type="button"
							data-row-action="undo-commit"
							data-worktree-path=${undo.worktreePath ?? nothing}
							data-tooltip=${undoLabel}
							aria-label=${undoLabel}
						>
							<code-icon icon="discard"></code-icon>
						</button>`
					: nothing}<button
					class="gl-graph__row-action gl-graph__row-action--gated"
					type="button"
					data-row-action="open-changes"
					data-tooltip="Open All Changes (Alt: with Working Tree)"
					aria-label="Open All Changes"
				>
					<code-icon icon="diff-multiple"></code-icon></button
				>${ctx.hasWipRow === true
					? html`<button
							class="gl-graph__row-action gl-graph__row-action--gated"
							type="button"
							data-jump-nearest-wip="true"
							data-tooltip="Jump to Working Changes"
							aria-label="Jump to Working Changes"
						>
							<code-icon icon="download" flip="block"></code-icon>
						</button>`
					: nothing}${isUnpushed
					? html`<button
							class="gl-graph__row-action gl-graph__row-action--persistent unpushed-push-button"
							type="button"
							data-row-action="push-to-commit"
							data-tooltip="Push to Commit..."
							aria-label="Push to Commit..."
						>
							<code-icon icon="cloud-upload"></code-icon>
						</button>`
					: nothing}`;
		}
	}
	// Gated buttons leave the tab order + a11y tree at rest (whole-strip `visibility:hidden` in default
	// mode; per-button `display:none` in `--has-persistent` mode) and become reachable on hover/focus/
	// selected; persistent buttons are always present + reachable. So no aria-hidden is needed.
	return html`<div class="gl-graph__row-actions ${hasPersistent ? 'gl-graph__row-actions--has-persistent' : ''}">
		${actions}
	</div>`;
}

export function renderRow(row: ProcessedGraphRow, ctx: RowRenderContext): TemplateResult {
	const { rowHeight, columnWidth } = ctx;
	const isWorkdir = row.kind === 'workdir';
	const refs = ctx.refsContent ?? [];
	const hasRefs = refs.length > 0;
	// Format the relative date ONCE per row, then reuse for the date cell + both aria-label builds (one
	// `new Date()` + Intl format per visible row instead of two producing the same string).
	const relativeDate = ctx.commit.date ? (ctx.formatDate ?? relativeTime)(ctx.commit.date) : undefined;
	// A11y: append the changes summary to the row label, but only when the Changes column is actually
	// shown — announce only what's displayed. Skeleton rows keep the bare message label.
	const changesStats = ctx.skeleton ? undefined : ctx.rowsStats?.[row.sha];
	const changesText =
		changesStats != null && ctx.zones.some(z => z.id === 'changes') ? changesAriaText(changesStats) : '';
	// Zero-churn rows produce empty text — no dangling ", " on the label.
	const changesAriaSuffix = changesText ? `, ${changesText}` : '';

	const nodeStyle: NodeStyle = {
		mode: ctx.nodeMode,
		avatars: ctx.avatars,
		avatarUrl: ctx.avatarUrl,
		avatarEmail: ctx.commit.authorEmail,
		initials: cachedInitials(ctx.commit.author),
		wipState: isWorkdir ? ctx.wipState : undefined,
		onAvatarError: ctx.onAvatarError,
	};
	// Skeleton rows swap the REAL gutter (geometry pass + raster + per-edge overlay elements — the
	// dominant cost of a full row, measured ~equal to everything else combined) for a single lane-colored
	// dot at the row's lane x. Same `graph-gutter` class so the clamp walk finds a target and no-ops
	// cleanly (no clamp hooks present); the settle swap restores the cached full gutter.
	const gutter = (width: number, laneWindow: LaneWindow | undefined = ctx.laneWindow): TemplateResult =>
		ctx.skeleton
			? renderSkeletonGutter(
					row,
					width,
					rowHeight,
					columnWidth,
					ctx.singleColumn === true,
					ctx.laneOffset ?? 0,
					ctx.nodeMode,
				)
			: ctx.gutterCache.render(
					row,
					{
						gutterWidth: width,
						rowHeight: rowHeight,
						columnWidth: columnWidth,
						singleColumn: ctx.singleColumn,
						laneWindow: laneWindow,
					},
					ctx.laneTipSha,
					nodeStyle,
				);

	// The dedicated fold strip prepended to the lanes (IDE code-folding gutter): a fixed-width column
	// holding this row's fold chevron, when one is present. `nothing` when folding is disabled
	// (foldLaneWidth === 0) so it reserves no space.
	const foldLane =
		ctx.foldLaneWidth > 0
			? html`<div
					class="gl-graph__fold-lane"
					style=${cspStyleMap({ width: `${ctx.foldLaneWidth}px`, minWidth: `${ctx.foldLaneWidth}px` })}
				>
					${ctx.foldContent ?? nothing}
				</div>`
			: nothing;

	// Placement: own column (resizable viewport), integrated into the first content column (per-row
	// width), or no lanes at all. In column mode the cell is `graphColumnWidth` wide: a fixed fold strip
	// + a gutter VIEWPORT the width of the lane area. The gutter SVG is drawn at the viewport width at
	// LOGICAL lane positions; the host's per-frame `applyClampOverlay` slides scrolled-past lanes' dots to
	// the edges (dimmed) + fades their connectors imperatively — no re-render, no clamp baked in the build.
	const graphColumn =
		ctx.graphPlacement === 'column'
			? html`<div
					class="gl-graph__zone gl-graph__zone--graph is-flush"
					style=${cspStyleMap({ width: `${ctx.graphColumnWidth}px`, minWidth: `${ctx.graphColumnWidth}px` })}
				>
					${foldLane}
					<div
						class="gl-graph__gutter-viewport"
						style=${cspStyleMap({ width: `${ctx.graphColumnWidth - ctx.foldLaneWidth}px` })}
					>
						${gutter(ctx.graphColumnWidth - ctx.foldLaneWidth)}
					</div>
				</div>`
			: nothing;
	// Grouped: the inline gutter hugs THIS row's own lane footprint (`rowGutterWidth`), clipped to the cap
	// (`ctx.inlineGutterWidth`) — restoring the per-row flow where the message snaps to each row's right-most
	// lane. A row WITHIN the cap builds unwindowed at its own width (no raster split, no edge mask — byte-
	// identical to the pre-cap inline gutter); only a row PAST the cap clips to the cap width + builds windowed
	// so its raster edge-fade mask + clamp hooks engage, and `applyClampOverlay` (offset pinned at 0) statically
	// pins its dots past the cap to the right edge + fades their connectors. The 0.8rem `--inline` margin (see
	// graph.scss) sits outside the clip, keeping a constant gap to the message either way.
	const inlineFit = ctx.graphPlacement === 'grouped' ? rowGutterWidth(row, columnWidth) : 0;
	const inlineClipped =
		ctx.graphPlacement === 'grouped' && (ctx.groupedShifted === true || inlineFit > ctx.inlineGutterWidth);
	// Shifted: hug the row's VISIBLE extent at the offset (per-row flow, translated); unshifted clipped
	// rows clip at the uniform cap; fitting rows hug their absolute footprint.
	const inlineWidth =
		ctx.groupedShifted === true && ctx.graphPlacement === 'grouped'
			? rowShiftedGutterWidth(
					row,
					columnWidth,
					ctx.laneOffset ?? 0,
					ctx.inlineGutterWidth,
					nodeRadiusFor(ctx.nodeMode) + 2,
				)
			: inlineClipped
				? ctx.inlineGutterWidth
				: inlineFit;
	// PER-ROW fade gates (grouped only): the host's global gates describe a uniformly-scrolled column;
	// grouped rows have their OWN hidden-content facts — fade left only when this row actually has lane
	// content left of the offset, fade right only when its content is clipped at the cap. Inline vars win
	// over the host globals; column rows don't set them (their offset is live, the globals track it).
	let groupedFades: StyleInfo | undefined;
	if (ctx.graphPlacement === 'grouped') {
		const offset = ctx.laneOffset ?? 0;
		let minLaneX = xForColumn(row.column, columnWidth);
		for (const key in row.edges) {
			const x = xForColumn(Number(key), columnWidth);
			if (x < minLaneX) {
				minLaneX = x;
			}
		}
		groupedFades = {
			'--gutter-fade-left-on': offset > 0 && minLaneX < offset ? '1' : '0',
			'--gutter-fade-right-on': inlineWidth >= ctx.inlineGutterWidth ? '1' : '0',
		};
	}
	const inlineGutter =
		ctx.graphPlacement === 'grouped'
			? html`${foldLane}
					<div
						class="gl-graph__gutter-viewport gl-graph__gutter-viewport--inline"
						style=${cspStyleMap({ width: `${inlineWidth}px`, ...groupedFades })}
					>
						${gutter(inlineWidth, inlineClipped ? ctx.laneWindow : undefined)}
					</div>`
			: nothing;
	// Refs render inline at the head of their host column UNLESS the dedicated Branches/Tags column is on
	// (expanded density) — then they render in that zone via renderZoneContent — or the column is
	// hidden entirely (`refsPlacement === 'hidden'`), in which case no inline pills either.
	const refsInColumn = ctx.refsPlacement === 'column' && ctx.style === 'table';
	// Ghost pills only ever render in the dedicated Refs column (`renderZoneContent` case 'ref') — inline
	// placement (here) never reserves layout space for one on a ref-less row.
	const inlineRefs =
		ctx.skeleton !== true && ctx.refsPlacement !== 'hidden' && (hasRefs || hasAnchorMarker(ctx)) && !refsInColumn
			? renderInlineRefs(row, refs, ctx)
			: nothing;

	// String concatenation (not array+filter+join) — this runs for every visible row on every
	// render; avoid the two intermediate array allocations on the hot path.
	let rowClasses = 'gl-graph__row';
	if (ctx.style === 'list') {
		rowClasses += ' is-list';
	}
	if (ctx.isSelected) {
		rowClasses += ' is-selected';
	}
	if (ctx.isFocused) {
		rowClasses += ' is-focused';
	}
	if (ctx.isSearchMatch) {
		rowClasses += ' is-highlighted';
	}
	if (ctx.isInRefChain) {
		rowClasses += ' is-inRefChain';
	}
	if (ctx.isDimmed) {
		rowClasses += ' is-dimmed';
	}
	if (isWorkdir) {
		rowClasses += ' is-workdir';
	}
	if (ctx.skeleton) {
		rowClasses += ' gl-graph__row--skeleton';
	}
	// Tint the whole anchor row by its role (target = colored, base = monochromatic, focal = brand) so
	// the anchor reads across the row, not just at the marker pill.
	if (ctx.isAnchor && ctx.anchorKind != null) {
		rowClasses += ` is-anchor--${ctx.anchorKind}`;
	}
	// Edge-fade gate (the narrow-row guard, see the mask rule in graph.scss): windowed rows wide enough to
	// actually hide content get the mask; rows narrower than the two fade zones combined would wash out
	// entirely. Gated HERE (not in the cached gutter fragment) because it depends on this row's per-offset
	// viewport width — keeping it row-side keeps the gutter cache offset-agnostic.
	if (
		ctx.laneWindow != null &&
		(ctx.graphPlacement === 'column' || inlineClipped) &&
		(ctx.graphPlacement === 'column' ? ctx.graphColumnWidth - ctx.foldLaneWidth : inlineWidth) >
			graphEdgeFadePx * 2 + columnWidth
	) {
		rowClasses += ' is-row-fadeable';
	}
	// Lane-color treatment (see graph.scss): a BAND emanates from the row's node (the dot), fading in to
	// a crisp lane-color line at `--row-band-edge`. That edge is: the graph column's width (fold strip +
	// lanes) when graph is its own column; the REFS column's width when the graph is inlined INTO the
	// refs column (they form a combined graph+refs region, so the band spans it — the fold strip sits
	// inside that cell so it doesn't extend the edge); otherwise the fold strip + inline gutter — the
	// band stops at the START of the host column (the lanes' right edge), since a non-refs host owns its
	// own content. `hidden` has no node, so it falls back to the thin left EDGE.
	const isGraphColumn = ctx.graphPlacement === 'column';
	// Which zone slot the lanes occupy: the graph's own slot (column) or — when inlined — its grouped HOST
	// zone, tracked BY ID (`graphHostId`) so it never crams a leading Refs column with lane art. Falls back
	// to the anchor-slot clamp (last zone) when the host id is unset or no longer visible.
	const graphHostIdx = ctx.graphHostId != null ? ctx.zones.findIndex(z => z.id === ctx.graphHostId) : -1;
	const laneZoneIdx =
		graphHostIdx >= 0 ? graphHostIdx : Math.min(ctx.graphColumnPos, Math.max(0, ctx.zones.length - 1));
	const laneZone = ctx.zones[laneZoneIdx];
	// Lead offset = total RENDERED width of every zone BEFORE the lanes (flex zones included — their
	// solved `width` is the rendered width); the band (an absolute overlay) shifts right by it so it
	// lines up with the actual lanes regardless of slot. Skipping flex zones mis-anchored the band when
	// the graph sits AFTER the flex Message column (band landed at Message's start, not the graph).
	// Column placement splices the graph as its OWN cell at `graphColumnPos` (0..zones.length), so the
	// lead sums every zone before that splice point — NOT `laneZoneIdx`, whose last-zone clamp (needed
	// for the inline host lookup) dropped the final column's width when the graph was the LAST column.
	const graphLeadCount = isGraphColumn ? Math.min(ctx.graphColumnPos, ctx.zones.length) : laneZoneIdx;
	let graphLeadOffset = 0;
	for (let i = 0; i < graphLeadCount; i++) {
		graphLeadOffset += ctx.zones[i].width;
	}
	// Band geometry. Column: confined to the graph viewport (left = graphLeadOffset, width =
	// graphColumnWidth) so it never bleeds into adjacent columns; fades to a crisp line at the viewport's
	// right edge. Inline: full-row overlay fading to the host Refs column's right edge (graph combined
	// into Refs) or the lanes' right edge otherwise. `hidden` → thin EDGE.
	const bandEdge = isGraphColumn
		? ctx.graphColumnWidth
		: laneZone?.id === 'ref'
			? graphLeadOffset + laneZone.width
			: graphLeadOffset + ctx.foldLaneWidth + inlineWidth;
	// Dot center. Column: relative to the graph-cell left (the ::before sits there). Inline: absolute
	// from the row's left, so include the lead offset. Built at the LOGICAL lane x (single-column rail →
	// column 0, else the natural lane); in column placement the host's per-frame `applyClampOverlay`
	// overwrites `--row-node-x` with the CLAMPED x so the band emanates from the stuck dot as it scrolls.
	// The dot's ABSOLUTE lane x + the zones/fold widths before the lanes + the lane viewport width — the
	// three static inputs the CSS pin (`--gutter-node-x`) and the band origin derive the dot's live
	// screen position from (see graph.scss; the only dynamic input is the shared `--graph-gutter-scroll`).
	const laneCenterX = ctx.singleColumn ? xForColumn(0, columnWidth) : xForColumn(row.column, columnWidth);
	const laneLead = (isGraphColumn ? 0 : graphLeadOffset) + ctx.foldLaneWidth;
	const laneViewportW = isGraphColumn ? ctx.graphColumnWidth - ctx.foldLaneWidth : inlineWidth;
	rowClasses += ctx.graphPlacement === 'hidden' ? ' is-graph-edge' : ' is-graph-band';
	if (isGraphColumn) {
		rowClasses += ' is-graph-column';
	} else if (ctx.graphPlacement === 'grouped' && ctx.refsPlacement === 'grouped') {
		// Both graph + refs inlined into Message: the band edge falls mid-column (no host-column
		// boundary there), so soften it to a fade-out that bleeds a little into the message instead of
		// a hard colorized line.
		rowClasses += ' is-graph-bleed';
	}

	let body: TemplateResult | (TemplateResult | typeof nothing)[];
	// The graph column cell. In expanded mode it's interleaved into `body` at `graphColumnPos`
	// (movable); in compact it renders as a fixed leading cell. `nothing` when not in column mode.
	let leadingGraph: TemplateResult | typeof nothing = graphColumn;
	if (ctx.style === 'list') {
		body = renderListBody(row, ctx, inlineGutter, inlineRefs, relativeDate);
	} else {
		// Expanded: one cell per visible zone. The inline gutter hosts in the lanes' slot (`laneZoneIdx` —
		// the graph's grouped host, by id) so inlining combines into that column; inline refs sit at the
		// head of the first content zone. The cell holding the gutter is flush (no left padding).
		const cells: (TemplateResult | typeof nothing)[] = ctx.zones.map((zone, zoneIndex) => {
			const gutterHere = ctx.graphPlacement === 'grouped' && zoneIndex === laneZoneIdx;
			// Grouped refs render on their HOST zone by id (so the group moves as a unit); fall back to the
			// first zone only when no host is set (refs as a column → `inlineRefs` is `nothing` anyway).
			const refsHere = ctx.refsHostId != null ? zone.id === ctx.refsHostId : zoneIndex === 0;
			const cellClass = `gl-graph__zone gl-graph__zone--${zone.id}${gutterHere ? ' is-flush' : ''}`;
			const leading =
				gutterHere || refsHere
					? html`${gutterHere ? inlineGutter : nothing}${refsHere ? inlineRefs : nothing}`
					: nothing;
			return html`<div class=${cellClass} style=${cspStyleMap(zoneStyle(zone))}>
				${leading}${renderZoneContent(zone, row, ctx, relativeDate)}
			</div>`;
		});
		// Movable graph column: splice the graph cell into the zone cells at `graphColumnPos` so it
		// renders at the user-chosen slot (not always leftmost). Then it's part of `body`, not leading.
		if (ctx.graphPlacement === 'column') {
			const pos = Math.min(ctx.graphColumnPos, cells.length);
			cells.splice(pos, 0, graphColumn);
			leadingGraph = nothing;
		}
		body = cells;
	}

	return html`<div
		id="graph-row-${row.sha}"
		class=${rowClasses}
		role="treeitem"
		aria-level="1"
		aria-posinset=${ctx.index + 1}
		aria-setsize=${ctx.total}
		aria-selected=${ctx.isSelected}
		aria-expanded=${ctx.laneTipSha === row.sha ? (ctx.laneCollapsed ? 'false' : 'true') : nothing}
		aria-label=${ctx.skeleton
			? ctx.commit.message
			: ctx.isAnchor && ctx.anchorKind != null
				? `${anchorTitle(ctx.anchorKind, ctx.anchorAlsoFork)}. ${buildAriaLabel(ctx.commit, row.kind, ctx.adornmentLabel, relativeDate)}${changesAriaSuffix}`
				: `${buildAriaLabel(ctx.commit, row.kind, ctx.adornmentLabel, relativeDate)}${changesAriaSuffix}`}
		data-sha=${row.sha}
		data-index=${ctx.index}
		data-focused=${ctx.isFocused || nothing}
		data-vscode-context=${ctx.skeleton ? nothing : (ctx.commit.contextData ?? nothing)}
		style=${cspStyleMap({
			height: `${rowHeight}px`,
			'--row-height': `${rowHeight}px`,
			'--row-lane-color': colorForColumn(row.column),
			'--row-lane-x': `${laneCenterX}px`,
			'--row-lane-lead': `${laneLead}px`,
			'--row-gutter-w': `${laneViewportW}px`,
			'--row-band-edge': `${bandEdge}px`,
			// Column mode: the band ::before is positioned at the graph cell (left/width) so it stays
			// inside the resizable viewport; inline mode ignores these (spans the full row).
			'--row-graph-left': `${isGraphColumn ? graphLeadOffset : 0}px`,
			'--row-graph-width': `${isGraphColumn ? ctx.graphColumnWidth : 0}px`,
		})}
	>
		${ctx.isAnchor
			? html`<span
					class="gl-graph__anchor gl-graph__anchor--${ctx.anchorKind ?? 'generic'}${ctx.anchorAlsoFork
						? ' gl-graph__anchor--also-fork'
						: ''}"
					aria-hidden="true"
					data-tooltip=${anchorTitle(ctx.anchorKind, ctx.anchorAlsoFork)}
				></span>`
			: nothing}
		${ctx.isBucketBoundary ? html`<div class="gl-graph__row-timeline-sep" aria-hidden="true"></div>` : nothing}
		${leadingGraph}${body}${ctx.skeleton ? nothing : renderRowActions(row, ctx)}
	</div>`;
}
