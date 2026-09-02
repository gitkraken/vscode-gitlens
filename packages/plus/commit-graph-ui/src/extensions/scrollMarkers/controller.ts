import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import { isPrimaryWipRowId } from '@gitkraken/commit-graph/wip/identity.js';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { cspStyleMap } from '@gitlens/components/cspStyleMap.directive.js';
import type { CommitGraphScrollMarkersController, ScrollMarkersHost } from '../../contracts/scrollMarkers.js';
import type {
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphRefsMetadata,
	GraphScrollMarkerTypes,
} from '../../contracts/state.js';
import type { GraphCommitView } from '../../rows/commit.js';
import { isRefHidden } from '../../rows/commit.js';
import { shortRefName } from '../../rows/markers.js';
import type { WipRowInfo } from '../../rows/wip.js';

/**
 * Marker box shape, assigned per marker type. `block` fills its lane(s); `fullLine`/`thinLine` span
 * the full rail width as a thin horizontal rule (used for selection).
 */
export type ScrollMarkerShape = 'block' | 'fullLine' | 'thinLine';

/**
 * A single scroll-rail marker box. Position + size are FRACTIONS of the rail so the renderer maps
 * them to `left`/`width` percentages within its TYPE's dedicated lane column(s) (vertical position
 * comes from `index`); the rail is divided into `laneCount` columns — markers are constrained to
 * their lane(s). `color` is the per-type theme color; `index` drives
 * click-to-jump + vertical placement; `label` is the tooltip; `shape` drives the rendered box height
 * (see ScrollMarkerShape).
 */
export interface ScrollMarker {
	leftPct: number;
	widthPct: number;
	color: string;
	index: number;
	label: string;
	/** Codicon name for the tooltip — conveys the marker type at a glance. */
	icon: string;
	shape: ScrollMarkerShape;
	/** Type priority (higher = primary; drawn on top + expands on hover). */
	priority: number;
}

// The marker rail is divided into laneCount fixed columns; each marker TYPE owns one or more of them.
// The assignment is FIXED (never packed to fill gaps) so a type keeps the same horizontal position all
// the way down the rail — markers stay comparable row-to-row, and where types share a lane the higher
// `priority` draws on top rather than either one shifting sideways.
const laneCount = 3;

interface MarkerLane {
	lanes: readonly number[];
	color: string;
	icon: string;
	shape: ScrollMarkerShape;
	priority: number;
}

// Per-type priority: higher = primary (drawn on top where lanes overlap + expands on hover + leads the
// tooltip). Order (highest→lowest): selection > highlights > wip > head > upstream > pinned > mergeTarget >
// stashes > pullRequests > localBranches > remoteBranches > tags. The row-marker trio keeps its own
// precedence (HEAD > upstream > merge target — see `primaryRowMarkerRole`) so the rail and the row's
// row-marker rail agree on which one leads.
//
// ⚠ Priority doubles as the rendered `z-index` (see `renderScrollMarkers`), so these must stay small
// integers — the rail's hovered-primary rule uses `z-index: 20`.
const markerLanes: Readonly<Record<GraphScrollMarkerTypes, MarkerLane>> = {
	stashes: {
		lanes: [0],
		color: 'var(--color-graph-scroll-marker-stashes)',
		icon: 'archive',
		shape: 'block',
		priority: 5,
	},
	localBranches: {
		lanes: [0],
		color: 'var(--color-graph-scroll-marker-local-branches)',
		icon: 'git-branch',
		shape: 'block',
		priority: 3,
	},
	wip: { lanes: [0, 1], color: 'var(--color-graph-scroll-marker-wip)', icon: 'pencil', shape: 'block', priority: 10 },
	head: {
		lanes: [0, 1],
		color: 'var(--color-graph-scroll-marker-head)',
		icon: 'git-branch',
		shape: 'block',
		priority: 9,
	},
	highlights: {
		lanes: [1],
		color: 'var(--color-graph-scroll-marker-highlights)',
		icon: 'search',
		shape: 'block',
		priority: 11,
	},
	upstream: {
		lanes: [1, 2],
		color: 'var(--color-graph-scroll-marker-upstream)',
		icon: 'cloud',
		shape: 'block',
		priority: 8,
	},
	// One row at most, like `mergeTarget` below — so it spans the full rail as a thin rule rather than
	// competing for a lane column with the per-ref blocks.
	//
	// ⚠ It gets its OWN colour rather than borrowing the pinned ref's local/remote branch colour. A pinned
	// branch's tip row ALWAYS also carries that branch's own marker, so sharing the hue would put a
	// same-coloured line and block on one row with only shape to tell them apart — the pin would read as
	// extra emphasis on the branch rather than as a distinct thing. Pinning is a ROLE assigned to a ref
	// (like merge target), and every other role marker owns its identity colour. That colour is shared with
	// the pinned WAYPOINT segment, exactly as `head` is shared with the HEAD waypoint.
	pinned: {
		lanes: [0, 1, 2],
		color: 'var(--color-graph-scroll-marker-pinned)',
		icon: 'gl-pinned-filled',
		shape: 'thinLine',
		priority: 7,
	},
	// A single row, at most — so it spans the full rail as a thin rule rather than competing for a lane
	// column with the per-ref blocks. Same hue as the row's row-marker rail + the HEAD pill's target segment.
	mergeTarget: {
		lanes: [0, 1, 2],
		color: 'var(--color-graph-scroll-marker-merge-target)',
		icon: 'gl-merge-target',
		shape: 'thinLine',
		priority: 6,
	},
	tags: { lanes: [2], color: 'var(--color-graph-scroll-marker-tags)', icon: 'tag', shape: 'block', priority: 1 },
	remoteBranches: {
		lanes: [2],
		color: 'var(--color-graph-scroll-marker-remote-branches)',
		icon: 'cloud',
		shape: 'block',
		priority: 2,
	},
	pullRequests: {
		lanes: [2],
		color: 'var(--color-graph-scroll-marker-pull-requests)',
		icon: 'git-pull-request',
		shape: 'block',
		priority: 4,
	},
	selection: {
		lanes: [0, 1, 2],
		color: 'var(--color-graph-scroll-marker-selection)',
		icon: 'check',
		shape: 'fullLine',
		priority: 12,
	},
};

interface ScrollMarkerInputs {
	/** The RENDERED rows (topology-only; index = position down the list). */
	rows: readonly ProcessedGraphRow[];
	/** Resolves a row's commit payload (refs/message) — rows are topology-only. */
	getCommit: (sha: Sha) => GraphCommitView | undefined;
	/** The marker types the host's scroll-marker option has enabled. */
	enabled: ReadonlySet<GraphScrollMarkerTypes>;
	/** Shas matched by the active search (the `highlights` marker). */
	searchShas?: ReadonlySet<string>;
	/** Hide-by-type filter — drops the matching local/remote/tag ref markers (current HEAD kept). */
	excludeTypes?: GraphExcludeTypes;
	/** Hide-by-id filter — drops the matching ref's marker. */
	excludeRefs?: GraphExcludeRefs;
	/** Tracked-upstream lookup (packages/git-cli's `downstreamMap`) — drives the Hide-Remote-Branches
	 *  exception `isRefHidden` applies. */
	downstreams?: GraphDownstreams;
	/** Lazily-fetched ref metadata — drives the `pullRequests` marker. */
	refsMetadata?: GraphRefsMetadata | null;
	/** The graph's own repo path — identifies the primary WIP row (peers are other worktrees). */
	repoPath?: string;
	/** Per-row branch/worktree identity for the `wip` marker's label — the row message is now the same
	 *  bare "Working Changes" for every worktree (see `wipRowMessage`), so a peer's worktree name comes
	 *  from here instead. */
	wipRowInfoByRowSha?: ReadonlyMap<string, WipRowInfo>;
}

function laneBox(type: GraphScrollMarkerTypes): {
	leftPct: number;
	widthPct: number;
	color: string;
	icon: string;
	shape: ScrollMarkerShape;
	priority: number;
} {
	const { lanes, color, icon, shape, priority } = markerLanes[type];
	return {
		leftPct: (lanes[0] / laneCount) * 100,
		widthPct: (lanes.length / laneCount) * 100,
		color: color,
		icon: icon,
		shape: shape,
		priority: priority,
	};
}

/**
 * Compute the scroll-rail marker boxes from the rendered rows. One box per (row, enabled type), so
 * a row with both a tag and a local branch yields two boxes in their respective lane columns
 * (rather than one ambiguous blob).
 *
 * Selection + merge-target markers are deliberately NOT built here — this full-row scan runs only when
 * the rendered rows / ref filters / search change; those two patch via
 * {@link buildSelectionScrollMarkers} / {@link buildMergeTargetScrollMarkers} (O(selection) and
 * O(targets), not O(rows)) and merge on top.
 */
function computeScrollMarkers(inputs: ScrollMarkerInputs): ScrollMarker[] {
	const {
		rows,
		getCommit,
		enabled,
		searchShas,
		excludeTypes,
		excludeRefs,
		downstreams,
		refsMetadata,
		repoPath,
		wipRowInfoByRowSha,
	} = inputs;
	const total = rows.length;
	if (total <= 0 || enabled.size === 0) return [];

	const wantsHead = enabled.has('head');
	const wantsLocal = enabled.has('localBranches');
	const wantsRemote = enabled.has('remoteBranches');
	const wantsTags = enabled.has('tags');
	const wantsStashes = enabled.has('stashes');
	const wantsWip = enabled.has('wip');
	const wantsHighlights = enabled.has('highlights') && searchShas != null && searchShas.size > 0;
	const wantsUpstream = enabled.has('upstream');
	const wantsPullRequests = enabled.has('pullRequests');

	const markers: ScrollMarker[] = [];
	const push = (index: number, type: GraphScrollMarkerTypes, label: string): void => {
		const box = laneBox(type);
		markers.push({
			leftPct: box.leftPct,
			widthPct: box.widthPct,
			color: box.color,
			index: index,
			label: label,
			icon: box.icon,
			shape: box.shape,
			priority: box.priority,
		});
	};

	// Current branch name (for the primary workdir's "Working changes (<name>)" label) — the workdir
	// row sits ABOVE the current-HEAD commit, so resolve it up-front rather than mid-loop.
	let currentBranchName: string | undefined;
	if (wantsWip) {
		for (const r of rows) {
			const cur = getCommit(r.sha)?.commitRefs.find(ref => ref.kind === 'head' && ref.current);
			if (cur != null) {
				currentBranchName = cur.name;
				break;
			}
		}
	}

	for (let i = 0; i < total; i++) {
		const row = rows[i];
		const commit = getCommit(row.sha);
		if (commit == null) continue;

		for (const ref of commit.commitRefs) {
			// Drop ref markers hidden by the visibility filters (current HEAD always kept).
			if (isRefHidden(ref, excludeTypes, excludeRefs, downstreams)) continue;

			if (ref.kind === 'head') {
				// Current-head branch: emit ONLY the head marker — a current head is categorized as head,
				// not also a local branch — so the rail shows a single mark.
				if (ref.current) {
					if (wantsHead) {
						push(i, 'head', ref.name.length > 0 ? `HEAD → ${ref.name}` : 'HEAD');
					}
				} else if (wantsLocal) {
					push(i, 'localBranches', ref.name);
				}
			} else if (ref.kind === 'remote') {
				// HEAD's upstream: emit ONLY the upstream marker, mirroring the current-head rule above, so
				// the rail shows a single mark. `current` on a remote means "this ref IS HEAD's upstream"
				// (the provider sets it from `headRefUpstreamName`) — which is what the marker means. Keying
				// off `isTrackedUpstream` instead marked EVERY remote that any local branch tracks.
				if (ref.current) {
					if (wantsUpstream) {
						push(i, 'upstream', ref.owner ? `${ref.owner}/${ref.name}` : ref.name);
					}
				} else if (wantsRemote) {
					push(i, 'remoteBranches', ref.owner ? `${ref.owner}/${ref.name}` : ref.name);
				}
			} else if (wantsTags) {
				push(i, 'tags', ref.name);
			}

			if (wantsPullRequests && ref.id != null) {
				const prs = refsMetadata?.[ref.id]?.pullRequest;
				if (prs != null && prs.length > 0) {
					push(i, 'pullRequests', prs[0].title);
				}
			}
		}

		if (wantsStashes && row.kind === 'stash') {
			// The stash message itself (deviates from the legacy "Stash: …" — no prefix).
			push(i, 'stashes', commit.message.length > 0 ? commit.message : 'Stash');
		}
		if (wantsWip && row.kind === 'workdir') {
			// The row message is the same bare "Working Changes" for every worktree now (see
			// `wipRowMessage`), so the per-worktree name comes from `wipRowInfoByRowSha` instead: the
			// PRIMARY row names the current branch, a peer names its worktree (falling back to its
			// branch, for a peer whose `label` hasn't landed yet).
			const name = isPrimaryWipRowId(row.sha, repoPath)
				? currentBranchName
				: (wipRowInfoByRowSha?.get(row.sha)?.worktreeName ?? wipRowInfoByRowSha?.get(row.sha)?.branchName);
			const label = name != null && name.length > 0 ? `${commit.message} (${name})` : commit.message;
			push(i, 'wip', label);
		}
		if (wantsHighlights && searchShas.has(row.sha)) {
			push(i, 'highlights', 'Search match');
		}
	}

	return markers;
}

/**
 * Selection markers alone — O(selection) via the display index instead of the O(rows) scan above,
 * so a click/keyboard selection change never rescans the graph. Merge the result onto the cached
 * base markers; `groupScrollMarkersByRow` re-sorts per row, so merge order doesn't matter.
 */
function buildSelectionScrollMarkers(
	selectedShas: ReadonlySet<string> | undefined,
	indexBySha: ReadonlyMap<string, number>,
	enabled: ReadonlySet<GraphScrollMarkerTypes>,
): ScrollMarker[] {
	if (!enabled.has('selection') || selectedShas == null || selectedShas.size === 0) return [];

	const box = laneBox('selection');
	const markers: ScrollMarker[] = [];
	for (const sha of selectedShas) {
		const index = indexBySha.get(sha);
		if (index == null) continue;

		markers.push({
			leftPct: box.leftPct,
			widthPct: box.widthPct,
			color: box.color,
			index: index,
			label: 'Selected',
			icon: box.icon,
			shape: box.shape,
			priority: box.priority,
		});
	}
	return markers;
}

/**
 * Merge-target markers alone — the same O(1)-per-sha patch as {@link buildSelectionScrollMarkers}, and for
 * the same reason: the target resolves AFTER the first paint (the scope-anchor pull) and can move again on
 * a ref invalidation, so it must never cost a rescan of the rendered rows.
 *
 * `targetShas` unions the current branch's resolved target with the active scope's, so the rail can't
 * disagree with the row's row-marker rail. A sha whose row isn't loaded is skipped — the marker appears if and
 * when that row pages in (the rail doesn't page the graph on its own).
 */
export function buildMergeTargetScrollMarkers(
	targetShas: ReadonlySet<string> | undefined,
	indexBySha: ReadonlyMap<string, number>,
	enabled: ReadonlySet<GraphScrollMarkerTypes>,
	targetName?: string,
): ScrollMarker[] {
	if (!enabled.has('mergeTarget') || targetShas == null || targetShas.size === 0) return [];

	const box = laneBox('mergeTarget');
	// Only the CURRENT branch's target carries a name (the scope protocol ships the tip sha alone), so a
	// scope-only target reads as the bare role — the same information the row's rail has.
	const label =
		targetName != null && targetName.length > 0 ? `Merge Target (${shortRefName(targetName)})` : 'Merge Target';

	const markers: ScrollMarker[] = [];
	const seen = new Set<number>();
	for (const sha of targetShas) {
		const index = indexBySha.get(sha);
		// RowMarker and scope can resolve to the SAME row — one marker, or the row's tooltip lists it twice.
		if (index == null || seen.has(index)) continue;

		seen.add(index);
		markers.push({
			leftPct: box.leftPct,
			widthPct: box.widthPct,
			color: box.color,
			index: index,
			label: label,
			icon: box.icon,
			shape: box.shape,
			priority: box.priority,
		});
	}
	return markers;
}

/**
 * The pinned branch's marker alone — the same O(1) patch as {@link buildSelectionScrollMarkers}, and for the
 * same reason: the pin is set/cleared interactively and its sha resolves only once that row is loaded, so it
 * must never cost a rescan of the rendered rows.
 *
 * `pinnedSha` is the sha the pin RESOLVED to (`resolvePinnedSha`), so a pin whose row hasn't paged in yet
 * simply has no marker — it appears if and when that row loads, matching the merge-target marker's behaviour
 * (the rail never pages the graph on its own).
 */
function buildPinnedScrollMarkers(
	pinnedSha: Sha | undefined,
	indexBySha: ReadonlyMap<string, number>,
	enabled: ReadonlySet<GraphScrollMarkerTypes>,
	pinnedName?: string,
): ScrollMarker[] {
	if (!enabled.has('pinned') || pinnedSha == null) return [];

	const index = indexBySha.get(pinnedSha);
	if (index == null) return [];

	const box = laneBox('pinned');
	return [
		{
			leftPct: box.leftPct,
			widthPct: box.widthPct,
			color: box.color,
			index: index,
			label:
				pinnedName != null && pinnedName.length > 0 ? `Pinned (${shortRefName(pinnedName)})` : 'Pinned Branch',
			icon: box.icon,
			shape: box.shape,
			priority: box.priority,
		},
	];
}

/** One lane-colored tick within a row's rail band (its lane position + per-type color/icon/label). */
interface RowMarkerEntry {
	color: string;
	leftPct: number;
	widthPct: number;
	icon: string;
	label: string;
	shape: ScrollMarkerShape;
	priority: number;
}

/** All markers that fall on a single row, for one full-width interactive rail band. */
interface RowMarkers {
	index: number;
	entries: RowMarkerEntry[];
}

/**
 * Collapse the flat per-(row,type) markers into one entry per ROW so the rail can render a single
 * full-width interactive band per row (hover/click anywhere on the row's y-band, one tooltip listing
 * all of its markers). Entries within a row are ordered by PRIORITY descending (primary first), so the
 * tooltip leads with the primary ref and `entries[0]` is the marker that expands on hover (the
 * renderer also z-orders by priority so the primary draws on top where lanes overlap).
 */
function groupScrollMarkersByRow(markers: readonly ScrollMarker[]): RowMarkers[] {
	const byRow = new Map<number, RowMarkers>();
	for (const m of markers) {
		let row = byRow.get(m.index);
		if (row == null) {
			row = { index: m.index, entries: [] };
			byRow.set(m.index, row);
		}
		row.entries.push({
			color: m.color,
			leftPct: m.leftPct,
			widthPct: m.widthPct,
			icon: m.icon,
			label: m.label,
			shape: m.shape,
			priority: m.priority,
		});
	}
	// Primary first (highest priority); ties keep emit order (lane 0 → 2 from the ref scan).
	for (const row of byRow.values()) {
		row.entries.sort((a, b) => b.priority - a.priority);
	}

	return [...byRow.values()];
}

type ScrollMarkerScale = {
	markerRowPx: number;
	realRowPositions: boolean;
};

const scrollMarkerMagnetPx = 8;
const scrollMarkerGapPx = 1;
const scrollMarkerMaxBlockPx = 6;
const scrollMarkerDragThresholdPx = 3;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Owns scroll-marker computation, rail rendering, and rail interaction for an opted-in profile. */
export class ScrollMarkersController implements ReactiveController, CommitGraphScrollMarkersController {
	private readonly controllerHost: ReactiveControllerHost;
	private readonly deps: ScrollMarkersHost;
	private scrollMarkers: readonly ScrollMarker[] = [];
	private scrollMarkerRows: readonly RowMarkers[] = [];
	private baseScrollMarkers: readonly ScrollMarker[] = [];
	private hoveredMarkerIndex?: number;
	private drag?: { startY: number; startScrollTop: number; moved: boolean; pointerId: number };
	private tooltipAnchor?: HTMLElement;
	private tooltipEntries: readonly { icon: string; label: string }[] = [];
	private tooltipOpen = false;
	private tooltipShowTimer?: ReturnType<typeof setTimeout>;
	private tooltipHideTimer?: ReturnType<typeof setTimeout>;

	constructor(controllerHost: ReactiveControllerHost, deps: ScrollMarkersHost) {
		this.controllerHost = controllerHost;
		this.deps = deps;
		controllerHost.addController(this);
	}

	hostDisconnected(): void {
		this.drag = undefined;
		this.hoveredMarkerIndex = undefined;
		this.clearTooltipTimers();
		this.tooltipAnchor = undefined;
		this.tooltipEntries = [];
		this.tooltipOpen = false;
	}

	dispose(): void {
		this.hostDisconnected();
		this.controllerHost.removeController(this);
	}

	/**
	 * Rebuilds row-scanned markers only when their inputs change. Selection, pinned, and merge-target
	 * changes patch onto the cached base in O(changed shas), preserving the existing update cost.
	 */
	recompute(patchOnly = false): void {
		const types = this.deps.markerTypes();
		const displayRows = this.deps.displayRows();
		if (types == null || types.length === 0 || displayRows.length === 0) {
			this.baseScrollMarkers = [];
			this.scrollMarkers = [];
			this.scrollMarkerRows = [];
			return;
		}

		const enabled = new Set(types);
		if (!patchOnly) {
			const searchShas = this.deps.searchMode() === 'filter' ? undefined : this.deps.searchMatchedShas();
			this.baseScrollMarkers = computeScrollMarkers({
				rows: displayRows,
				getCommit: sha => this.deps.getCommit(sha),
				enabled: enabled,
				searchShas: searchShas,
				excludeTypes: this.deps.excludeTypes(),
				excludeRefs: this.deps.excludeRefs(),
				downstreams: this.deps.downstreams(),
				refsMetadata: this.deps.refsMetadata(),
				repoPath: this.deps.repoPath(),
				wipRowInfoByRowSha: this.deps.wipRowInfoByRowSha(),
			});
		}

		const indexBySha = this.deps.indexBySha();
		const selection = buildSelectionScrollMarkers(this.deps.selectedShas(), indexBySha, enabled);
		const mergeTarget = buildMergeTargetScrollMarkers(
			this.deps.mergeTargetShas(),
			indexBySha,
			enabled,
			this.deps.mergeTargetName(),
		);
		const pinned = buildPinnedScrollMarkers(this.deps.pinnedSha(), indexBySha, enabled, this.deps.pinnedName());
		this.scrollMarkers =
			selection.length > 0 || mergeTarget.length > 0 || pinned.length > 0
				? [...this.baseScrollMarkers, ...selection, ...mergeTarget, ...pinned]
				: this.baseScrollMarkers;
		this.scrollMarkerRows = groupScrollMarkersByRow(this.scrollMarkers);
	}

	private scale(rowPx: number): ScrollMarkerScale {
		const rowHeight = this.deps.rowHeight();
		return {
			markerRowPx: rowHeight > 0 ? Math.min(rowHeight, rowPx) : rowPx,
			realRowPositions: rowHeight > 0 && rowHeight < rowPx,
		};
	}

	private bandTop(index: number, scale: ScrollMarkerScale): number {
		if (!scale.realRowPositions) return index * scale.markerRowPx;

		return (this.deps.unitPositionOf(index) + this.deps.dataUnitOf(index)) * scale.markerRowPx;
	}

	render(): TemplateResult | null {
		if (!this.deps.markerTypes()?.length) return null;

		const rows = this.scrollMarkerRows;
		const displayRows = this.deps.displayRows();
		const viewportPx = this.deps.viewportHeight() || (this.deps.scroller()?.clientHeight ?? 0);
		const total = this.deps.totalRows() || rows.length;
		const rowPx = total > 0 ? viewportPx / total : 0;
		const scale = this.scale(rowPx);

		return html`<div
				class="gl-graph__scroll-markers"
				style=${cspStyleMap({ top: '2.4rem' })}
				data-vscode-context=${this.deps.context() ?? nothing}
				@pointerdown=${this.onPointerDown}
				@pointerup=${this.onPointerUp}
				@pointercancel=${this.onPointerCancel}
				@pointermove=${this.onPointerMove}
				@pointerleave=${this.onPointerLeave}
				@pointerover=${this.stopPointerOver}
				@contextmenu=${this.onContextMenu}
				@click=${this.stopClick}
			>
				${repeat(
					rows,
					row => displayRows[row.index]?.sha ?? row.index,
					row => html`<div
						class="gl-graph__scroll-marker-band${row.index === this.hoveredMarkerIndex ? ' is-hovered' : ''}"
						data-marker-index=${row.index}
						aria-hidden="true"
						style=${cspStyleMap({ top: `${this.bandTop(row.index, scale)}px` })}
					>
						${row.entries.map((entry, index) => {
							const isLine = entry.shape === 'fullLine' || entry.shape === 'thinLine';
							const heightPx =
								entry.shape === 'fullLine'
									? clamp(0.5 * rowPx, 2, 4)
									: entry.shape === 'thinLine'
										? clamp(0.25 * rowPx, 1, 2)
										: clamp(rowPx - scrollMarkerGapPx, 2, scrollMarkerMaxBlockPx);
							return html`<span
								class="gl-graph__scroll-marker-box${index === 0 ? ' is-primary' : ''}"
								style=${cspStyleMap({
									'--marker-left': isLine ? '0' : `${entry.leftPct}%`,
									'--marker-width': isLine ? '100%' : `${entry.widthPct}%`,
									'--marker-height': `${heightPx}px`,
									backgroundColor: entry.color,
									zIndex: String(entry.priority),
								})}
							></span>`;
						})}
					</div>`,
				)}
			</div>
			${this.renderTooltip()}`;
	}

	private renderTooltip(): TemplateResult {
		return html`<gl-popover
			class="gl-graph__scroll-marker-tooltip"
			trigger="manual"
			placement="left"
			?arrow=${false}
			.distance=${4}
			.anchor=${this.tooltipAnchor}
			.open=${this.tooltipOpen}
		>
			<span slot="anchor"></span>
			<span slot="content" class="gl-graph__scroll-marker-tooltip-content"
				>${this.tooltipEntries.map(
					entry => html`<span class="gl-graph__scroll-marker-tooltip-row"
						>${
							entry.icon.length > 0
								? html`<code-icon class="gl-graph__tooltip-icon" icon=${entry.icon}></code-icon>`
								: nothing
						}<span>${entry.label}</span></span
					>`,
				)}</span
			>
		</gl-popover>`;
	}

	private nearest(container: HTMLElement, clientY: number): RowMarkers | undefined {
		const rect = container.getBoundingClientRect();
		if (rect.height <= 0) return undefined;

		const total = this.deps.totalRows() || this.scrollMarkerRows.length;
		const rowPx = total > 0 ? (this.deps.viewportHeight() || rect.height) / total : 0;
		const scale = this.scale(rowPx);
		const clickPx = clientY - rect.top;
		let nearest: RowMarkers | undefined;
		let bestPx = Infinity;
		for (const row of this.scrollMarkerRows) {
			const px = Math.abs(this.bandTop(row.index, scale) - clickPx);
			if (px < bestPx) {
				bestPx = px;
				nearest = row;
			}
		}

		return nearest != null && bestPx <= scrollMarkerMagnetPx ? nearest : undefined;
	}

	private setHoveredMarkerIndex(index: number | undefined): void {
		if (index === this.hoveredMarkerIndex) return;

		this.hoveredMarkerIndex = index;
		this.controllerHost.requestUpdate();
	}

	private showTooltip(anchor: HTMLElement, entries: readonly { icon: string; label: string }[]): void {
		// Two popovers, one pointer: the surface's delegated tooltip must not stay up behind ours.
		this.deps.hideDelegatedTooltip();

		if (this.tooltipHideTimer != null) {
			clearTimeout(this.tooltipHideTimer);
			this.tooltipHideTimer = undefined;
		}
		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
		}

		this.tooltipOpen = false;
		this.controllerHost.requestUpdate();
		this.tooltipShowTimer = setTimeout(() => {
			this.tooltipShowTimer = undefined;
			this.tooltipAnchor = anchor;
			this.tooltipEntries = entries;
			this.tooltipOpen = true;
			this.controllerHost.requestUpdate();
		}, 60);
	}

	hideTooltip(): void {
		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
			this.tooltipShowTimer = undefined;
		}
		if (!this.tooltipOpen || this.tooltipHideTimer != null) return;

		this.tooltipOpen = false;
		this.controllerHost.requestUpdate();
		this.tooltipHideTimer = setTimeout(() => {
			this.tooltipHideTimer = undefined;
			this.tooltipAnchor = undefined;
			this.tooltipEntries = [];
			this.controllerHost.requestUpdate();
		}, 120);
	}

	private clearTooltipTimers(): void {
		if (this.tooltipShowTimer != null) {
			clearTimeout(this.tooltipShowTimer);
			this.tooltipShowTimer = undefined;
		}
		if (this.tooltipHideTimer != null) {
			clearTimeout(this.tooltipHideTimer);
			this.tooltipHideTimer = undefined;
		}
	}

	private readonly onPointerDown = (event: PointerEvent): void => {
		if (this.deps.isDraggingColumn() || event.button !== 0) return;

		const scroller = this.deps.scroller();
		if (scroller == null) return;

		this.drag = {
			startY: event.clientY,
			startScrollTop: scroller.scrollTop,
			moved: false,
			pointerId: event.pointerId,
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		const drag = this.drag;
		if (drag == null) return;

		const container = event.currentTarget as HTMLElement;
		if (container.hasPointerCapture(drag.pointerId)) {
			container.releasePointerCapture(drag.pointerId);
		}
		this.drag = undefined;
		if (!drag.moved) {
			this.jump(container, event.clientY);
		}
	};

	private readonly onPointerCancel = (event: PointerEvent): void => {
		const drag = this.drag;
		if (drag == null) return;

		const container = event.currentTarget as HTMLElement;
		if (container.hasPointerCapture(drag.pointerId)) {
			container.releasePointerCapture(drag.pointerId);
		}
		this.drag = undefined;
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		if (this.deps.isDraggingColumn()) return;

		const container = event.currentTarget as HTMLElement;
		this.deps.endRowHover(container);
		const drag = this.drag;
		if (drag != null) {
			if (!drag.moved && Math.abs(event.clientY - drag.startY) > scrollMarkerDragThresholdPx) {
				drag.moved = true;
			}
			if (drag.moved) {
				this.setHoveredMarkerIndex(undefined);
				this.hideTooltip();

				const scroller = this.deps.scroller();
				if (scroller == null) return;

				const rect = container.getBoundingClientRect();
				const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				const deltaFrac = rect.height > 0 ? (event.clientY - drag.startY) / rect.height : 0;
				scroller.scrollTop = Math.max(0, Math.min(maxScroll, drag.startScrollTop + deltaFrac * maxScroll));
			}
			return;
		}

		const nearest = this.nearest(container, event.clientY);
		if (nearest == null) {
			this.setHoveredMarkerIndex(undefined);
			this.hideTooltip();
			return;
		}
		// Same band as last time is a no-op only while its tooltip is up or pending: a scroll (or the
		// surface showing its own tooltip) hides ours without the pointer moving, and the next move over
		// the same band must be able to bring it back.
		if (nearest.index === this.hoveredMarkerIndex && (this.tooltipOpen || this.tooltipShowTimer != null)) {
			return;
		}

		this.setHoveredMarkerIndex(nearest.index);
		const band = container.querySelector<HTMLElement>(`[data-marker-index="${nearest.index}"]`);
		const entries = nearest.entries
			.filter(entry => entry.label.length > 0)
			.map(entry => ({ icon: entry.icon, label: entry.label }));
		if (band != null && entries.length > 0) {
			this.showTooltip(band, entries);
		} else {
			this.hideTooltip();
		}
	};

	private readonly onPointerLeave = (): void => {
		this.setHoveredMarkerIndex(undefined);
		this.hideTooltip();
	};

	private readonly onContextMenu = (): void => {
		this.setHoveredMarkerIndex(undefined);
		this.hideTooltip();
	};

	private readonly stopPointerOver = (event: Event): void => event.stopPropagation();
	private readonly stopClick = (event: Event): void => event.stopPropagation();

	private jump(container: HTMLElement, clientY: number): void {
		if (this.deps.scroller() == null) return;

		const nearest = this.nearest(container, clientY);
		if (nearest == null) {
			const rect = container.getBoundingClientRect();
			const total = this.deps.totalRows() || this.scrollMarkerRows.length;
			if (rect.height <= 0 || total <= 0) return;

			this.deps.revealPosition(Math.round(((clientY - rect.top) / rect.height) * total));
			return;
		}

		const sha = this.deps.displayRows()[nearest.index]?.sha;
		if (sha != null) {
			this.deps.jumpToRow(sha);
		}
	}
}
