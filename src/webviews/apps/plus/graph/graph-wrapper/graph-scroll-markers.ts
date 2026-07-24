import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type {
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphRefsMetadata,
	GraphScrollMarkerTypes,
} from '../../../../plus/graph/protocol.js';
import type { GraphCommitView } from './graph-commit.js';
import { isRefHidden, isTrackedUpstream } from './graph-commit.js';

/**
 * Marker box shape (matches the reference graph's per-type metadata). `block` fills its lane(s);
 * `fullLine`/`thinLine` span the full rail width as a thin horizontal rule (used for selection).
 */
export type ScrollMarkerShape = 'block' | 'fullLine' | 'thinLine';

/**
 * A single scroll-rail marker box. Position + size are FRACTIONS of the rail so the renderer maps
 * them to `left`/`width` percentages within its TYPE's dedicated lane column(s) (vertical position
 * comes from `index`); the rail is divided into `laneCount` columns — markers are constrained to
 * their lane(s), matching the reference graph. `color` is the per-type theme color; `index` drives
 * click-to-jump + vertical placement; `label` is the tooltip; `shape` drives the rendered box height
 * (see ScrollMarkerShape).
 */
export interface ScrollMarker {
	leftPct: number;
	widthPct: number;
	color: string;
	index: number;
	label: string;
	/** Codicon name for the tooltip (conveys the marker type at a glance, like the legacy graph). */
	icon: string;
	shape: ScrollMarkerShape;
	/** Type priority (higher = primary; drawn on top + expands on hover). Mirrors the reference `oz`. */
	priority: number;
}

// The marker rail is divided into laneCount fixed columns; each marker TYPE owns one or more of
// them (mirrors gitkraken-components' `GRAPH_SCROLL_MARKER_LANES` + per-type lane map). Color +
// lanes per type match the reference so both engines read identically.
const laneCount = 3;

interface MarkerLane {
	lanes: readonly number[];
	color: string;
	icon: string;
	shape: ScrollMarkerShape;
	priority: number;
}

// Per-type priority: higher = primary (drawn on top where lanes overlap + expands on hover + leads the
// tooltip). Order (highest→lowest): selection > highlights > wip > head > upstream > stashes >
// pullRequests > localBranches > remoteBranches > tags.
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
	wip: { lanes: [0, 1], color: 'var(--color-graph-scroll-marker-wip)', icon: 'pencil', shape: 'block', priority: 8 },
	head: {
		lanes: [0, 1],
		color: 'var(--color-graph-scroll-marker-head)',
		icon: 'git-branch',
		shape: 'block',
		priority: 7,
	},
	highlights: {
		lanes: [1],
		color: 'var(--color-graph-scroll-marker-highlights)',
		icon: 'search',
		shape: 'block',
		priority: 9,
	},
	upstream: {
		lanes: [1, 2],
		color: 'var(--color-graph-scroll-marker-upstream)',
		icon: 'cloud',
		shape: 'block',
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
		priority: 10,
	},
};

export interface ScrollMarkerInputs {
	/** The RENDERED rows (topology-only; index = position down the list). */
	rows: readonly ProcessedGraphRow[];
	/** Resolves a row's commit payload (refs/message) — rows are topology-only. */
	getCommit: (sha: Sha) => GraphCommitView | undefined;
	/** The marker types the user has enabled (`gitlens.graph.scrollMarker.enabled`). */
	enabled: ReadonlySet<GraphScrollMarkerTypes>;
	/** Shas matched by the active search (the `highlights` marker). */
	searchShas?: ReadonlySet<string>;
	/** Hide-by-type filter — drops the matching local/remote/tag ref markers (current HEAD kept). */
	excludeTypes?: GraphExcludeTypes;
	/** Hide-by-id filter — drops the matching ref's marker. */
	excludeRefs?: GraphExcludeRefs;
	/** Tracked-upstream lookup (packages/git-cli's `downstreamMap`) — drives the `upstream` marker and
	 *  the Hide-Remote-Branches exception `isRefHidden` applies. */
	downstreams?: GraphDownstreams;
	/** Lazily-fetched ref metadata — drives the `pullRequests` marker. */
	refsMetadata?: GraphRefsMetadata | null;
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
 * Selection markers are deliberately NOT built here — this full-row scan runs only when the
 * rendered rows / ref filters / search change; selection changes patch via
 * {@link buildSelectionScrollMarkers} (O(selection), not O(rows)) and merge on top.
 */
export function computeScrollMarkers(inputs: ScrollMarkerInputs): ScrollMarker[] {
	const { rows, getCommit, enabled, searchShas, excludeTypes, excludeRefs, downstreams, refsMetadata } = inputs;
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
				// Current-head branch: emit ONLY the head marker (matches the reference — a current head
				// is categorized as head, not also a local branch — so the rail shows a single mark).
				if (ref.current) {
					if (wantsHead) {
						push(i, 'head', ref.name.length > 0 ? `HEAD → ${ref.name}` : 'HEAD');
					}
				} else if (wantsLocal) {
					push(i, 'localBranches', ref.name);
				}
			} else if (ref.kind === 'remote') {
				if (wantsRemote) {
					push(i, 'remoteBranches', ref.owner ? `${ref.owner}/${ref.name}` : ref.name);
				}
				if (wantsUpstream && isTrackedUpstream(ref, downstreams)) {
					push(i, 'upstream', ref.owner ? `${ref.owner}/${ref.name}` : ref.name);
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
			// The workdir row's message is already "Working Changes (<worktree>)" for secondary
			// worktrees; the PRIMARY workdir is just "Working Changes" — append the current branch.
			const hasName = commit.message.includes('(');
			const label =
				!hasName && currentBranchName != null && currentBranchName.length > 0
					? `${commit.message} (${currentBranchName})`
					: commit.message;
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
export function buildSelectionScrollMarkers(
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

/** One lane-colored tick within a row's rail band (its lane position + per-type color/icon/label). */
export interface RowMarkerEntry {
	color: string;
	leftPct: number;
	widthPct: number;
	icon: string;
	label: string;
	shape: ScrollMarkerShape;
	priority: number;
}

/** All markers that fall on a single row, for one full-width interactive rail band. */
export interface RowMarkers {
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
export function groupScrollMarkersByRow(markers: readonly ScrollMarker[]): RowMarkers[] {
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
