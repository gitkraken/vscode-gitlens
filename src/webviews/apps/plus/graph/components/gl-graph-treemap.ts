import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { GraphActivityDecay } from '../../../../../config.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import type { TreemapFileActionParams } from '../../../../plus/graph/protocol.js';
import {
	DidInvalidateGraphTreemapNotification,
	TreemapFileActionCommand,
	UpdateGraphConfigurationCommand,
} from '../../../../plus/graph/protocol.js';
import type { TimelinePeriod } from '../../../../plus/timeline/protocol.js';
import { periodToMs } from '../../../../plus/timeline/utils/period.js';
import type {
	CommitFrequencyData,
	TreemapConfig,
	TreemapData,
	TreemapMode,
	TreemapNode,
} from '../../../../plus/treemap/protocol.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { Disposable } from '../../../shared/events.js';
import { periodLabels } from '../../timeline/components/header.js';
import type {
	GlTreemapChart,
	TreemapFileClickDetail,
	TreemapZoomChangeDetail,
} from '../../treemap/components/treemap-chart.js';
import type { AppState } from '../context.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import './gl-details-agent-status.js';
import './gl-graph-visualizations-switcher.js';
import '../../treemap/components/treemap-chart.js';
import '../../../shared/components/badges/badge.js';
import '../../../shared/components/breadcrumbs.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/hooks-banner.js';
import '../../../shared/components/menu/menu-popover.js';
import '../../../shared/components/overlays/tooltip.js';

// Re-exported so external imports (graph-app, gl-graph-visualizations) keep working — the canonical
// dispatch lives in `gl-graph-visualizations-switcher`.
export type { GraphTreemapModeChangeDetail } from './gl-graph-visualizations-switcher.js';

/** Shared empty `activity` map — passing the same reference when there's no agent activity keeps
 *  Lit's `changed.has('activity')` from firing on every wrapper re-render. */
/** Uppercase title labels shown in the toolbar to the right of the visualization switcher.
 *  Doubles as an anchor for the breadcrumbs / description that follow — "you are in <X> looking
 *  at <scope> · <counts>". */
const treemapTitles: Record<TreemapMode, string> = {
	files: 'FILES',
	commits: 'COMMITS',
	activity: 'AGENT ACTIVITY',
};

/** Decay-window picker labels for Activity mode. Parallel to the timeline's `periodLabels` but
 *  scoped to the minute-/second-range that makes sense for "how long does an edit linger on the
 *  heatmap after the agent finishes". Each label matches the contributions.json enum description
 *  so the picker reads consistently with the Settings UI. */
const decayLabels: Record<GraphActivityDecay, string> = {
	'30s': '30 seconds',
	'1m': '1 minute',
	'2m': '2 minutes',
	'5m': '5 minutes',
	'10m': '10 minutes',
	'30m': '30 minutes',
};

/** Per-file activity entry consumed by the chart renderer. `readAt`/`editedAt` are
 *  milliseconds since the host's last PreToolUse for that kind, computed at host serialization
 *  time. Omitted when the kind hasn't touched the path within the decay window. `reading` /
 *  `editing` are `true` while a tool of that kind is in flight on the path right now — drives the
 *  pulse + brightness boost on the renderer. The webview ages the timestamps locally against
 *  `ActivitySnapshot.snapshotAt` using `performance.now()` so the heatmap fades smoothly between
 *  IPC pushes (which only fire on structural changes). */
type ActivityEntry = { readAt?: number; editedAt?: number; reading?: boolean; editing?: boolean };

/** Snapshot wrapper that pairs the per-file activity map with a single webview-local timestamp.
 *  All entries in the map were built from the same IPC notification, so their `readAt`/`editedAt`
 *  deltas share a common reference time — the chart ages each entry by
 *  `(performance.now() - snapshotAt) + (readAt|editedAt)` to compute its effective age in ms. */
type ActivitySnapshot = { readonly entries: ReadonlyMap<string, ActivityEntry>; readonly snapshotAt: number };

const emptyActivityEntries: ReadonlyMap<string, ActivityEntry> = new Map();
const emptyActivity: ActivitySnapshot = Object.freeze({ entries: emptyActivityEntries, snapshotAt: 0 });
/** Shared empty sessions array — same rationale as `emptyActivity`. */
const emptySessions: AgentSessionState[] = [];

/** Convert an absolute or pre-resolved path to a forward-slash, repo-relative path matching the
 *  chart's `TreemapNode.path` convention. Returns `undefined` when the path is not inside
 *  `repoPath` — `fileActivity` may contain edits outside the active repo if the agent's cwd is
 *  elsewhere, and those shouldn't paint on this tree. */
function toRepoRelative(repoPath: string, filePath: string): string | undefined {
	const norm = filePath.replace(/\\/g, '/');
	const rootNorm = repoPath.replace(/\\/g, '/');
	if (norm === rootNorm) return '';
	if (norm.startsWith(`${rootNorm}/`)) return norm.slice(rootNorm.length + 1);
	return undefined;
}

/** Count files (leaves) at and below `node`. Walks the tree once — cheap enough for toolbar
 *  rendering, no caching needed. */
function countFiles(node: TreemapNode): number {
	if (node.type === 'file') return 1;

	const children = node.children;
	if (children == null || children.length === 0) return 0;

	let count = 0;
	for (const child of children) {
		count += countFiles(child);
	}
	return count;
}

/** Resolve the unique-commit count for a scope (root, folder, or file) using the host-aggregated
 *  `folderFrequencies` + `frequencies`. The root scope uses `totalCommits` (== folderFrequencies['']
 *  on the wire, cached separately). Folder scopes look up by their repo-relative path. File scopes
 *  fall back to `frequencies` (per-file counts). Returns 0 when no key matches — happens for
 *  empty folders or files outside the walked window. */
function lookupCommitCount(scope: TreemapNode, freq: CommitFrequencyData, root: TreemapNode): number {
	if (scope === root) return freq.totalCommits;

	let rel = scope.path;
	// Match the host's `rootPrefix` logic — only strip when the prefix is followed by a separator
	// (or is the full path), so sibling paths like `/repo-bak/x` don't get truncated against
	// `root.path = '/repo'`. The trailing-separator branch handles containerized roots like `/`
	// where `${root.path}/` would otherwise become `//` and fail to match child paths.
	if (rel === root.path) {
		rel = '';
	} else {
		const rootEndsSep = root.path.endsWith('/') || root.path.endsWith('\\');
		if (rootEndsSep) {
			if (rel.startsWith(root.path)) {
				rel = rel.slice(root.path.length);
			}
		} else if (rel.startsWith(`${root.path}/`) || rel.startsWith(`${root.path}\\`)) {
			rel = rel.slice(root.path.length + 1);
		}
	}
	rel = rel.replace(/\\/g, '/');

	const map = scope.type === 'file' ? freq.frequencies : freq.folderFrequencies;
	return map[rel] ?? 0;
}

/**
 * Embedded treemap visualization for the Graph webview's Visual History view. Wraps the canvas
 * `<gl-treemap-chart>` with a small mode-tabs header (Files | Commits) and the data fetcher that
 * pulls aggregates from the host's `graphTreemap` RPC service.
 *
 * Refetch fingerprint includes `repoPath` + `mode` so we don't re-walk the file system or re-run
 * `git log` when only the mode changes (the host caches per-repo and reuses the tree across modes).
 */
@customElement('gl-graph-treemap')
export class GlGraphTreemap extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			min-height: 0;
		}

		.toolbar {
			display: flex;
			align-items: center;
			/* 0.6rem horizontal so the switcher (left) and the close button (right) sit at matching
			 * inset from the toolbar edges. Vertical kept at 0.4rem for the 32px toolbar height. */
			padding: 0.4rem 0.6rem;
			gap: 0.8rem;
			min-height: 3.2rem;
			border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
			/* Clip rather than overflow when content exceeds the toolbar width — at very narrow
			 * widths even the shrunken description + pill may overflow the right edge. Clipping
			 * keeps the right-edge controls anchored visually instead of pushing them off-screen. */
			overflow: hidden;
		}

		.toolbar gl-graph-visualizations-switcher {
			flex: none;
		}

		/* Shrink priority when the toolbar is too narrow to fit everything: counts collapse first
		 * (description + agent-status, flex-shrink: 1000), then breadcrumbs (100), then the title
		 * (10). The switcher, EXP badge, and .toolbar__right never shrink, so the close button
		 * stays pinned to the right edge regardless of width. min-width: 0 lets each shrinkable
		 * item collapse below its intrinsic width; text-overflow / overflow:hidden ellipsizes
		 * gracefully on the way down. */
		.toolbar__title {
			/* Always rendered (FILES / COMMITS / AGENT ACTIVITY) so the user keeps the view label
			 * even after zooming into the tree. Shrinks last via the priority chain above. */
			flex: 0 10 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: 1.1rem;
			font-weight: 600;
			text-transform: uppercase;
			white-space: nowrap;
		}

		/* Breadcrumbs flex-grow to fill leftover toolbar space so the component's own ResizeObserver
		 * sees width changes when the toolbar widens/narrows — that's what drives its outer-in
		 * collapse algorithm to run and re-run. Shrinks faster than the title but slower than the
		 * counts so the path stays readable as the toolbar tightens. */
		.toolbar__crumbs {
			flex: 1 100 0;
			min-width: 0;
			overflow: hidden;
		}

		.toolbar__description {
			/* Counts (e.g. "2,173 files" / "N commits · M files") sit after the breadcrumbs when
			 * present, else right after the EXP badge. Shrinks fastest in the priority chain. */
			flex: 0 1000 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: 1.1rem;
			color: var(--color-foreground--65);
			white-space: nowrap;
		}

		/* Activity-mode counts (status pills + "N working · M idle"). Shares the shrink-first
		 * priority with .toolbar__description so both collapse together as the toolbar narrows. */
		.toolbar > gl-details-agent-status {
			flex: 0 1000 auto;
			min-width: 0;
			overflow: hidden;
		}

		/* Matches the Visual History header's period pill — transparent background, tight padding —
		 * so the same control reads consistently across both surfaces. Full-strength foreground (no
		 * dimming) to match the rest of the toolbar text. */
		.period-button {
			display: inline-flex;
			align-items: center;
			gap: 0.2rem;
			appearance: none;
			background: transparent;
			border: 1px solid transparent;
			border-radius: 0.3rem;
			padding: 0.1rem 0.4rem;
			font: inherit;
			font-size: 1.2rem;
			color: var(--vscode-foreground);
			cursor: pointer;
			white-space: nowrap;
			transition:
				background 120ms ease,
				border-color 120ms ease;
		}

		.period-button:hover,
		.period-button:focus-visible {
			background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
			outline: none;
		}

		.period-button:focus-visible {
			border-color: var(--vscode-focusBorder, transparent);
		}

		.period-button code-icon {
			font-size: 1rem;
			opacity: 0.75;
		}

		.toolbar__right {
			display: flex;
			align-items: center;
			gap: 0.8rem;
			flex: none;
			min-width: 0;
			/* Always pin to the toolbar's right edge regardless of what sits to our left.
			 * Files / Commits mode rely on the breadcrumbs (flex 1) to push us right; Activity
			 * mode renders no breadcrumbs AND no description, so without an explicit auto-margin
			 * the right group would sit flush against the title. Auto-margin collapses to zero
			 * when another flex-grow element is already absorbing the slack. */
			margin-left: auto;
		}

		.toolbar__experimental {
			flex: none;
		}

		.toolbar__experimental gl-badge {
			--gl-badge-font-size: 0.95rem;
		}

		.hooks-banner {
			display: block;
			margin: 1.2rem;
		}

		gl-treemap-chart {
			flex: 1 1 auto;
			min-height: 0;
		}

		/* Wraps the chart so the error overlay can absolute-position over it without unmounting the
		 * chart. Keeping the chart mounted preserves its internal zoom path across an error →
		 * retry-success window so the user lands back at their prior drill-down depth. */
		.chart-container {
			position: relative;
			flex: 1 1 auto;
			min-height: 0;
			display: flex;
		}

		.overlay {
			position: absolute;
			inset: 0;
			background: var(--vscode-editor-background, transparent);
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 1.2rem;
			padding: 1rem;
			text-align: center;
			color: var(--color-foreground--65, var(--vscode-descriptionForeground));
		}

		.empty {
			flex: 1 1 auto;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.8rem;
			color: var(--color-foreground--65, var(--vscode-descriptionForeground));
			padding: 1rem;
			text-align: center;
		}
	`;

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	@consume({ context: ipcContext })
	private _ipc?: typeof ipcContext.__context__;

	@state()
	private _data?: TreemapData;

	@state()
	private _loading = false;

	@state()
	private _error = false;

	/** Mirrors the chart's zoom path so the toolbar breadcrumbs (rendered outside the chart's
	 *  shadow DOM) stay in sync. Updated from the chart's `gl-treemap-zoom-change` event;
	 *  breadcrumb clicks dispatch via `_chart.zoomTo(node)` which round-trips the same event back
	 *  so this stays the single source of truth. */
	@state()
	private _zoomPath: TreemapNode[] = [];

	@query('gl-treemap-chart')
	private _chart?: GlTreemapChart;

	private readonly _subscriptions: Disposable[] = [];

	/** Repo path the currently-held `_data` was fetched for. Gates render against `effectiveRepo.path`
	 *  so a cross-repo remount (where `_data` survives but the active repo flipped) doesn't paint
	 *  repo A's tree under repo B's header. Stale data is treated as "no data" until the next
	 *  refreshIfNeeded resolves. */
	private _dataRepoPath?: string;
	private _lastFingerprint?: string;
	/** Fingerprint of the last config that produced an error. Lets `refreshIfNeeded` dedup-skip a
	 *  failing config WITHOUT permanently sticking on the same `_lastFingerprint` after success —
	 *  if the user changes anything (period, mode, scope) the fingerprint differs and we retry.
	 *  Cleared on disconnect (reconnect should always retry) and on every successful fetch. */
	private _lastErrorFingerprint?: string;
	/** Fingerprint of the request currently being awaited. Without this, every Lit update during
	 *  the loading window (signal ticks, hover state, agent-session updates) would re-enter
	 *  `refreshIfNeeded`, abort the in-flight controller, and restart the fetch — visible as a
	 *  janky loader because host work keeps cancelling itself before it finishes. Cleared in
	 *  `finally` once the controller resolves (or on disconnect). */
	private _inFlightFingerprint?: string;
	private _abortController?: AbortController;

	/** Repo id we've already emitted a virtual-repo `commits → files` fall-back for, so the
	 *  detection in `willUpdate()` only fires once per repo identity change (avoids re-entry while
	 *  the parent flips `treemapMode` back to `'files'`). Cleared in `willUpdate()` whenever the
	 *  effective repo id changes, and on `disconnectedCallback` so a remount re-arms. */
	private _virtualFallbackEmittedForRepo?: string;

	/** Memoization for `activeFiles` and `repoFamilySessions`. Both getters are called from
	 *  `render()` and from SignalWatcher-tracked update cycles; without memoization they allocate
	 *  fresh `Map`/`Array` instances on every signal tick — child components see new property
	 *  references each render and over-react (chart repaint, popover re-anchor). Identity on the
	 *  raw `agentSessions` array isn't stable (the host's session sort returns a fresh array each
	 *  tick) AND the per-session `fileActivity` reference is recreated on every push by the
	 *  postMessage structured clone, so the cache keys on a per-session structural signature
	 *  (id + per-path read/edit flags, excluding the editedAt/readAt timestamps) — see {@link activeFiles}. */
	private _activeFilesCache?: {
		activitySigs: Set<string>;
		// Second-level safeguard: total entry count across sessions, so a session-count change that
		// happens to preserve the signature-Set size still invalidates the cache.
		totalLength: number;
		// Session repo-family fingerprint. Without this, a peer-sync that flips a session's
		// `commonPath`/`worktreePath` (e.g., worktree reparenting) without touching its
		// `fileActivity` reference would yield a cache hit even though the session no longer
		// belongs to the active repo's family.
		familyPaths: Set<string | undefined>;
		repo: unknown;
		// Registry reference-identity guard: `worktreePaths` gets a fresh array only on a full-state
		// push (not per-tick session updates) and can arrive AFTER sessions, so without it a snapshot
		// computed before the registry loaded would stick and miss registry-only worktree roots.
		worktreePaths: unknown;
		value: ActivitySnapshot;
	};
	private _repoFamilySessionsCache?: {
		sessionRefs: Set<AgentSessionState>;
		// Same rationale as `_activeFilesCache.totalLength` — total session count + the Set guards
		// against ref-collapse without paying for an O(n) walk on every render.
		totalCount: number;
		repo: unknown;
		value: AgentSessionState[];
	};

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.subscribeToInvalidations();
		void this.refreshIfNeeded();
	}

	/** Subscribe to host treemap-invalidation pushes. The host fires this when its per-repo
	 *  aggregator cache is dropped (file watcher edits, branch switches, repo unload). We bust
	 *  BOTH fingerprint gates so the next refreshIfNeeded refetches fresh data rather than
	 *  short-circuiting on a stale success or stale error fingerprint match. */
	private subscribeToInvalidations(): void {
		const ipc = this._ipc;
		if (ipc == null) return;

		this._subscriptions.push(
			ipc.onReceiveMessage(msg => {
				if (!DidInvalidateGraphTreemapNotification.is(msg)) return;
				if (msg.params.repoPath !== this.effectiveRepo?.path) return;

				this._lastFingerprint = undefined;
				this._lastErrorFingerprint = undefined;
				// Also abort any in-flight refresh — its result is now stale relative to the new
				// host-side state, and the in-flight dedup would otherwise swallow this invalidation.
				this._abortController?.abort();
				this._abortController = undefined;
				this._inFlightFingerprint = undefined;
				void this.refreshIfNeeded();
			}),
		);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		while (this._subscriptions.length > 0) {
			this._subscriptions.pop()?.dispose();
		}
		this._abortController?.abort();
		this._abortController = undefined;
		// Forget the previous fingerprint so reconnect ALWAYS re-fetches — without this, a refresh
		// that was aborted before `_data` was assigned leaves the wrapper stuck on the watermark
		// loader on the next mount (fingerprint matches → refreshIfNeeded short-circuits).
		this._lastFingerprint = undefined;
		this._lastErrorFingerprint = undefined;
		this._inFlightFingerprint = undefined;
		// Lit reuses element instances across mount cycles — without resetting these, an unmount
		// mid-fetch leaves `_loading`/`_error` stuck (the controller-mismatch bail in the catch/
		// finally skips them) and the next mount paints stale state before refreshIfNeeded runs.
		this._loading = false;
		this._error = false;
		this._virtualFallbackEmittedForRepo = undefined;
		this._activeFilesCache = undefined;
		this._repoFamilySessionsCache = undefined;
	}

	override willUpdate(): void {
		const repoPath = this.effectiveRepo?.path;
		// Drop stale per-repo dedup gates when the effective repo changes — without this, returning
		// to a previously-errored repo would match the prior `_lastErrorFingerprint` and lock out
		// refresh. `_dataRepoPath` tracks the repo `_data` was fetched for, so it correctly detects
		// a repo flip even when the previous fetch never resolved.
		if (this._dataRepoPath != null && this._dataRepoPath !== repoPath) {
			this._lastFingerprint = undefined;
			this._lastErrorFingerprint = undefined;
		}
		// Reset the virtual-fallback gate when the effective repo changes — without this,
		// returning to a previously-fallen-back virtual repo doesn't re-emit the fallback.
		const repoId = this.effectiveRepo?.id;
		if (this._virtualFallbackEmittedForRepo != null && this._virtualFallbackEmittedForRepo !== repoId) {
			this._virtualFallbackEmittedForRepo = undefined;
		}
		// `renderBreadcrumbs` already gates on `root == null` so stale TreemapNode refs in
		// `_zoomPath` never render dead chips during error/loading windows. The chart stays mounted
		// across the error overlay (see render()) and rehydrates `_zoomPath` by name on retry-success
		// via its `resolvePathInTree`, re-emitting `gl-treemap-zoom-change` — so we deliberately
		// avoid clearing `_zoomPath` here to preserve the user's drill-down across error → retry.
	}

	override updated(): void {
		void this.refreshIfNeeded();
		// Dispatch lives in `updated()` (post-render) rather than `willUpdate()` — emitting an
		// event mid-update can re-trigger Lit's render cycle and cause double renders or stale
		// reads against pre-commit state.
		this.maybeFallBackFromVirtualRepoCommits();
	}

	/** Virtual repos (vscode.dev / GitHub remote) can't produce commit-frequency aggregates, so the
	 *  visualization switcher disables the Commits tile — but a persisted `treemapMode: 'commits'`
	 *  still lands here on cold mount with no usable affordance. Emit the same mode-change event
	 *  the switcher dispatches so the parent flips us to `'files'`. Gated per-repo so we don't
	 *  re-emit while the parent state propagates. */
	private maybeFallBackFromVirtualRepoCommits(): void {
		if (this.mode !== 'commits') return;

		const repo = this.effectiveRepo;
		if (repo?.virtual !== true) return;
		if (this._virtualFallbackEmittedForRepo === repo.id) return;

		this._virtualFallbackEmittedForRepo = repo.id;
		this.dispatchEvent(
			new CustomEvent('gl-graph-treemap-mode-change', {
				detail: { mode: 'files' },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private readonly handleRetry = (): void => {
		// Flip out of the error state synchronously so the next render shows the loading
		// state — without this Lit can paint the error empty-state once more between the click
		// and refreshIfNeeded's `_loading = true` assignment, producing a visible flicker.
		this._error = false;
		this._loading = true;
		this._lastErrorFingerprint = undefined;
		// Also clear the in-flight gate: if a controller mismatch in the prior fetch's finally
		// left this set, refreshIfNeeded would silently bail at the in-flight dedup.
		this._inFlightFingerprint = undefined;
		this._abortController?.abort();
		this._abortController = undefined;
		void this.refreshIfNeeded();
	};

	private readonly onCloseClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-timeline-close', { bubbles: true, composed: true }));
	};

	private get effectiveRepo() {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		return repoId != null ? (repos?.find(r => r.id === repoId) ?? repos?.[0]) : repos?.[0];
	}

	/** `_data` filtered through a repo-identity gate: if we still hold data for a previous repo
	 *  (cross-repo remount before the next fetch resolves), surface `undefined` so the chart paints
	 *  its loading/empty state instead of repo A's tree under repo B's header. */
	private get effectiveData(): TreemapData | undefined {
		if (this._dataRepoPath !== this.effectiveRepo?.path) return undefined;
		return this._data;
	}

	private get mode(): TreemapMode {
		return this.graphState.treemapMode ?? 'files';
	}

	/** Mirrors `gl-graph-timeline.showAllBranchesEffective`: only "All Branches" with no specific
	 *  scope picks the `--all` walk. Every other visibility mode walks specific refs. */
	private get showAllBranchesEffective(): boolean {
		if (this.graphState.scope != null) return false;
		return this.graphState.branchesVisibility === 'all';
	}

	/** Mirrors `gl-graph-timeline.additionalBranchesEffective`: pulls ref names from the Graph's
	 *  `includeOnlyRefs` filter (smart / favorited / current visibility). Returns `undefined` for
	 *  "all" visibility (the `--all` walk covers everything). */
	private get additionalBranchesEffective(): string[] | undefined {
		if (this.graphState.scope != null) return undefined;
		if (this.showAllBranchesEffective) return undefined;

		const includeOnlyRefs = this.graphState.includeOnlyRefs;
		if (includeOnlyRefs == null) return undefined;

		const names: string[] = [];
		for (const ref of Object.values(includeOnlyRefs)) {
			if (ref == null || typeof ref !== 'object' || !('name' in ref) || typeof ref.name !== 'string') continue;
			if (!ref.name) continue;

			names.push(ref.name);
		}
		return names.length ? names : undefined;
	}

	/** When the Graph's scope picker has focused a branch, the treemap walks that branch as head;
	 *  otherwise the host falls back to HEAD. */
	private get scopedBranchName(): string | undefined {
		return this.graphState.scope?.branchName;
	}

	/** Maps the embedded timeline's period selector to a millisecond span — keeps the treemap's
	 *  commit-frequency window in lockstep with the visualization next to it. `undefined` (period
	 *  'all') falls back to the aggregator's 1-year default. */
	private get windowSpanMs(): number | undefined {
		const period = this.graphState.timeline?.period ?? '1|Y';
		return periodToMs(period);
	}

	private buildConfig(): TreemapConfig {
		return {
			showAllBranches: this.showAllBranchesEffective,
			additionalBranches: this.additionalBranchesEffective,
			head: this.scopedBranchName,
			loadedSpanMs: this.windowSpanMs,
		};
	}

	private async refreshIfNeeded(): Promise<void> {
		const repo = this.effectiveRepo;
		const services = this.services;
		if (services == null || repo == null) return;

		const config = this.buildConfig();
		const additionalKey = config.additionalBranches?.toSorted().join(',') ?? '';
		// Use the period TOKEN (`'1|Y'`, `'all'`, …) in the fingerprint rather than
		// `config.loadedSpanMs`. The ms value is computed live via `Date.now() - periodStart` so it
		// drifts every millisecond — embedding it would make the fingerprint mismatch on every Lit
		// update cycle (and SignalWatcher fires those on every `graphState` change), causing a
		// refetch storm that re-renders the canvas continuously (visible as flicker). The ms value
		// is still passed to the host in `config.loadedSpanMs` for the `since:` filter — only the
		// dedup key is discretized.
		const periodKey = this.graphState.timeline?.period ?? '1|Y';
		// Include scope presence as a discrete signal so toggling between "no scope set" and
		// "scope applied to the same branch" doesn't produce identical fingerprints — those are
		// semantically different filters even when head/additionalBranches happen to match.
		const scopePresence = this.graphState.scope != null ? 's' : 'r';
		const fingerprint = `${repo.path}::${this.mode}::${config.showAllBranches ? 1 : 0}::${
			config.head ?? ''
		}::${additionalKey}::${periodKey}::${scopePresence}`;
		// Two-key dedup: skip if this exact config has already succeeded AND we still have its
		// real data (root tree) in hand, OR if it has already failed (don't hammer the host with
		// the same failing call). Either condition unblocks when the user changes anything
		// (period, mode, scope, repo) — the fingerprint differs and the call goes through. The
		// "still have data" guard checks `_data?.root != null` rather than just `_data != null`
		// because the host returns a non-null wrapper `{ root: undefined, frequencies: undefined }`
		// when the repo isn't (yet) resolvable — caching that as "succeeded" would stick us on
		// the empty wrapper forever even if the repo becomes resolvable later. Reconnect also
		// unblocks because `disconnectedCallback` clears both fingerprints.
		if (fingerprint === this._lastFingerprint && this._data?.root != null && !this._error) return;
		if (fingerprint === this._lastErrorFingerprint) return;
		// Already fetching THIS exact config — don't abort+restart on every `updated()` tick
		// (SignalWatcher fires `updated()` on every observed signal change, which during a slow
		// load would otherwise cancel the in-flight host call and start a fresh one every render,
		// producing a visibly janky loader).
		if (fingerprint === this._inFlightFingerprint) return;

		this._abortController?.abort();
		const controller = new AbortController();
		this._abortController = controller;
		this._inFlightFingerprint = fingerprint;

		this._loading = true;
		this._error = false;

		try {
			const graphTreemap = await services.graphTreemap;
			const result = await graphTreemap.getData(repo.path, this.mode, config, controller.signal);
			if (this._abortController !== controller) return;

			this._data = result;
			this._dataRepoPath = repo.path;
			this._lastFingerprint = fingerprint;
			this._lastErrorFingerprint = undefined;
		} catch {
			if (this._abortController !== controller) return;

			this._error = true;
			this._data = undefined;
			this._dataRepoPath = undefined;
			// Stamp the failing fingerprint separately so subsequent renders with the same config
			// short-circuit (no retry storm) — but config changes still flow through because the
			// fingerprint differs. `_lastFingerprint` stays undefined so recovery (after a host
			// change or a `disconnectedCallback`) is unconditional.
			this._lastErrorFingerprint = fingerprint;
		} finally {
			if (this._abortController === controller) {
				this._inFlightFingerprint = undefined;
				this._loading = false;
			}
		}
	}

	/** Per-file activity snapshot for files in the active repo family, surfaced from
	 *  `AgentSession.fileActivity`. The host stamps every entry on `PreToolUse` (Read /
	 *  NotebookRead → `readAt`, Edit / Write / MultiEdit / NotebookEdit → `editedAt`), rolls
	 *  sub-agent activity into the parent before publishing, and evicts entries after the
	 *  configured decay window (`graph.experimental.visualizations.activityDecay`). The chart ages
	 *  these timestamps locally against `snapshotAt` so the heatmap fades smoothly between IPC
	 *  pushes. Reactive via `SignalWatcher` — any structural change to `agentSessions` re-runs
	 *  this and the chart picks up a fresh snapshot.
	 *
	 *  Matches by **repo family**, not exact worktree path: a session working in any worktree of
	 *  the same family (or the main checkout) still paints on the active worktree's tree. Each
	 *  per-file absolute path is resolved to a repo-relative key by stripping whichever repo-family
	 *  root contains it — the active repo, the host worktree registry (`worktreePaths`), or a
	 *  session's own roots (see `collectFamilyRoots`). Because all worktrees share the same relative
	 *  structure, `src/x.ts` from `/foo/wt-B` maps onto the active `/foo/wt-A` tree's `src/x.ts` node.
	 *
	 *  Multi-agent activity on the same path is merged here: per-kind `readAt` / `editedAt` take
	 *  the smallest (= most recent) age across all contributing sessions, and `reading` / `editing`
	 *  OR-reduce. Read and edit kinds coexist independently on the same entry — the renderer
	 *  blends the two RGB chromes by relative heat rather than letting one win. */
	private get activeFiles(): ActivitySnapshot {
		const repo = this.effectiveRepo;
		const sessions = this.graphState.agentSessions;
		const worktreePaths = this.graphState.worktreePaths;

		// Structural memo: `sessions` identity flips every tick (fresh array from the host's sort)
		// AND every per-session `fileActivity` reference is recreated on each push by the postMessage
		// structured clone, so reference identity can't be the key. Key instead on a structural
		// signature per session — its id + each path's read/edit FLAGS, but NOT the editedAt/readAt
		// timestamps. The host refreshes those timestamps in lockstep with structural changes, so a
		// purely non-structural push (e.g. a status tick while the agent runs a non-file tool) reuses
		// the cached snapshot, preserving `snapshotAt` so local heat aging keeps advancing instead of
		// freezing. Order-independent: gather signatures into a Set and compare sizes + membership so a
		// host re-sort (Working↔Idle reorders slots) doesn't invalidate the cache.
		const activitySigs = new Set<string>();
		const familyPaths = new Set<string | undefined>();
		let totalLength = 0;
		if (sessions != null) {
			for (const s of sessions) {
				let sig = s.id;
				const fa = s.fileActivity;
				if (fa != null) {
					for (const e of fa) {
						sig += `\u0001${e.path}:${e.reading ? 'r' : ''}${e.editing ? 'e' : ''}`;
					}
				}
				activitySigs.add(sig);
				familyPaths.add(s.commonPath ?? s.worktreePath);
				totalLength += s.fileActivity?.length ?? 0;
			}
		}
		const cache = this._activeFilesCache;
		if (
			cache != null &&
			cache.repo === repo &&
			cache.worktreePaths === worktreePaths &&
			cache.totalLength === totalLength &&
			cache.activitySigs.size === activitySigs.size &&
			cache.familyPaths.size === familyPaths.size
		) {
			let identical = true;
			for (const f of activitySigs) {
				if (!cache.activitySigs.has(f)) {
					identical = false;
					break;
				}
			}
			if (identical) {
				for (const p of familyPaths) {
					if (!cache.familyPaths.has(p)) {
						identical = false;
						break;
					}
				}
			}
			if (identical) return cache.value;
		}

		const value = this.computeActiveFiles(repo, sessions);
		this._activeFilesCache = {
			activitySigs: activitySigs,
			totalLength: totalLength,
			familyPaths: familyPaths,
			repo: repo,
			worktreePaths: worktreePaths,
			value: value,
		};
		return value;
	}

	/** Collects every repo-family root a `fileActivity` path might be anchored under: the displayed
	 *  repo (`repoPath` + `commonPath`), the host-provided worktree registry (`worktreePaths` — the
	 *  authoritative list of every worktree in the family), and each session's worktreePath/
	 *  commonPath as a fallback for the window before the registry loads. All worktrees of a repo
	 *  share their relative file structure, so stripping whichever root contains an absolute path
	 *  yields its repo-relative key — which matches this tree's nodes no matter which worktree (or
	 *  the main checkout) the activity occurred in. Returned sorted longest-first so first-match
	 *  resolution picks the most-specific root when one nests under another (e.g. a worktree
	 *  created inside the main checkout) — matching the shorter ancestor first would yield a
	 *  wrong-depth key. */
	private collectFamilyRoots(
		repoPath: string,
		commonPath: string | undefined,
		worktreePaths: readonly string[] | undefined,
		sessions: AppState['agentSessions'] | undefined,
	): string[] {
		const roots: string[] = [];
		const add = (path: string | undefined): void => {
			if (path != null && path !== '' && !roots.includes(path)) {
				roots.push(path);
			}
		};
		add(repoPath);
		add(commonPath);
		for (const wt of worktreePaths ?? []) {
			add(wt);
		}
		for (const s of sessions ?? []) {
			add(s.worktreePath);
			add(s.commonPath);
		}
		// Longest-first so first-match resolution picks the deepest (most-specific) root: a worktree
		// can nest under the main checkout (`git worktree add ./wt`), where the shorter ancestor root
		// would otherwise match first and strip to a wrong-depth key.
		roots.sort((a, b) => b.length - a.length);
		return roots;
	}

	private computeActiveFiles(
		repo: NonNullable<AppState['repositories']>[number] | undefined,
		sessions: AppState['agentSessions'] | undefined,
	): ActivitySnapshot {
		if (repo == null) return emptyActivity;
		if (sessions == null || sessions.length === 0) return emptyActivity;

		const repoFamilyPath = repo.commonPath ?? repo.path;
		// Scope to same-family sessions once, up front — both the root set and the activity merge
		// below run off this list, so "which sessions count" is decided here and only here.
		const familySessions = (sessions ?? []).filter(s => (s.commonPath ?? s.worktreePath) === repoFamilyPath);
		const familyRoots = this.collectFamilyRoots(
			repo.path,
			repo.commonPath,
			this.graphState.worktreePaths,
			familySessions,
		);
		let entries: Map<string, ActivityEntry> | undefined;

		// Single pass: merge each session's fileActivity into the per-path entry. Read and edit
		// kinds are tracked independently (no write-wins) so the chart can blend the two
		// chromes by relative heat. When multiple sessions touch the same path, the smaller
		// `readAt`/`editedAt` (= more recent) wins and `reading`/`editing` OR-reduce.
		for (const session of familySessions) {
			const activity = session.fileActivity;
			if (!activity?.length) continue;

			// Map each absolute path to its repo-relative key by stripping whichever repo-family root
			// contains it (the displayed worktree, the main checkout, or any sibling worktree a
			// same-family session reports). All worktrees share the same relative structure, so the
			// key maps onto this tree's nodes regardless of which worktree the activity happened in —
			// surfacing every same-repo session's activity, not just the displayed worktree's. A
			// session's own root can't be the sole base: sessions frequently sit in the main repo (or
			// another worktree) while editing this one.
			for (const a of activity) {
				let rel: string | undefined;
				for (const root of familyRoots) {
					rel = toRepoRelative(root, a.path);
					if (rel != null) break;
				}
				if (rel == null) continue;

				entries ??= new Map();
				const existing = entries.get(rel);
				if (existing == null) {
					entries.set(rel, {
						readAt: a.readAt,
						editedAt: a.editedAt,
						reading: a.reading === true,
						editing: a.editing === true,
					});
				} else {
					if (a.readAt != null && (existing.readAt == null || a.readAt < existing.readAt)) {
						existing.readAt = a.readAt;
					}
					if (a.editedAt != null && (existing.editedAt == null || a.editedAt < existing.editedAt)) {
						existing.editedAt = a.editedAt;
					}
					if (a.reading === true) {
						existing.reading = true;
					}
					if (a.editing === true) {
						existing.editing = true;
					}
				}
			}
		}

		if (entries == null) return emptyActivity;
		return { entries: entries, snapshotAt: performance.now() };
	}

	/** Sessions attributed to the active repo family (parent + all worktrees). Reused by
	 *  `activeFiles` (file-edit attribution) and by the header agent-status display. Same
	 *  `commonPath ?? worktreePath` collapse as the rest of GitLens uses for session grouping. */
	private get repoFamilySessions(): AgentSessionState[] {
		const repo = this.effectiveRepo;
		const sessions = this.graphState.agentSessions;

		// Same structural-memo rationale as `activeFiles` — render() is signal-tracked, so the
		// getter runs on every tick, and the upstream `agentSessions` array identity churns (host
		// sort returns a fresh array each tick). Order-independent set comparison so a re-sort
		// (Working↔Idle transitions) doesn't invalidate the cache on every state transition —
		// keeps `<gl-details-agent-status .sessions>` from invalidating on identity-only churn.
		const sessionRefs = new Set<AgentSessionState>();
		const totalCount = sessions?.length ?? 0;
		if (sessions != null) {
			for (const s of sessions) {
				sessionRefs.add(s);
			}
		}
		const cache = this._repoFamilySessionsCache;
		if (
			cache != null &&
			cache.repo === repo &&
			cache.totalCount === totalCount &&
			cache.sessionRefs.size === sessionRefs.size
		) {
			let identical = true;
			for (const s of sessionRefs) {
				if (!cache.sessionRefs.has(s)) {
					identical = false;
					break;
				}
			}
			if (identical) return cache.value;
		}

		const value = this.computeRepoFamilySessions(repo, sessions);
		this._repoFamilySessionsCache = {
			sessionRefs: sessionRefs,
			totalCount: totalCount,
			repo: repo,
			value: value,
		};
		return value;
	}

	private computeRepoFamilySessions(
		repo: NonNullable<AppState['repositories']>[number] | undefined,
		sessions: AppState['agentSessions'] | undefined,
	): AgentSessionState[] {
		if (repo == null) return emptySessions;
		if (sessions == null || sessions.length === 0) return emptySessions;

		const repoFamilyPath = repo.commonPath ?? repo.path;
		const result = sessions.filter(s => (s.commonPath ?? s.worktreePath) === repoFamilyPath);
		return result.length > 0 ? result : emptySessions;
	}

	/** Mirrors the timeline's period change event so graph-app's existing
	 *  `handleTimelineConfigChange` handler captures the new period and persists it. Treemap and
	 *  timeline share `graphState.timelinePeriod` so changing it in either viz keeps both in sync. */
	private readonly onPeriodMenuSelect = (e: CustomEvent<{ value: string }>): void => {
		const period = e.detail.value as TimelinePeriod;
		if ((this.graphState.timeline?.period ?? '1|Y') === period) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-timeline-config-change', {
				detail: { period: period },
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Dispatches the activity-decay setting change as an IPC `UpdateGraphConfigurationCommand`
	 *  so the host persists it to `gitlens.graph.experimental.visualizations.activityDecay`. The
	 *  resolved `activityDecayMs` flows back via the normal config push, so the chart sees the
	 *  new window on its next render. No optimistic local state — we lean on the config-changed
	 *  round-trip rather than maintaining a parallel signal. */
	private readonly onDecayMenuSelect = (e: CustomEvent<{ value: string }>): void => {
		const decay = e.detail.value as GraphActivityDecay;
		if (this.graphState.config?.activityDecay === decay) return;

		this._ipc?.sendCommand(UpdateGraphConfigurationCommand, { changes: { activityDecay: decay } });
	};

	override render(): unknown {
		const repo = this.effectiveRepo;
		if (repo == null) {
			return html`<div class="empty"><p>No repository selected</p></div>`;
		}

		const mode = this.mode;
		const period = this.graphState.timeline?.period ?? '1|Y';
		// Period picker is only meaningful in Commits mode — Files reads from the working tree and
		// Activity mirrors live agent state. Build the items lazily to keep the Files/Activity
		// renders cheap (we'd allocate 9 objects per render otherwise).
		const showPeriodPicker = mode === 'commits';
		const periodItems = showPeriodPicker
			? (Object.entries(periodLabels) as [TimelinePeriod, string][]).map(([value, label]) => ({
					value: value,
					label: label,
					selected: period === value,
				}))
			: undefined;
		const decay = this.graphState.config?.activityDecay ?? '5m';
		// Decay picker is the Activity-mode analogue of the Commits period picker — same UX
		// (popover + click target) but a tighter range matching the heatmap's purpose.
		const showDecayPicker = mode === 'activity';
		const decayItems = showDecayPicker
			? (Object.entries(decayLabels) as [GraphActivityDecay, string][]).map(([value, label]) => ({
					value: value,
					label: label,
					selected: decay === value,
				}))
			: undefined;
		const sessions = this.repoFamilySessions;

		// Mode selection (Files / Commits / Agent Activity) is owned by the embedded
		// `<gl-graph-visualizations-switcher>`. The treemap reads its active mode from `graphState.treemapMode`
		// and only surfaces per-mode controls in the toolbar's right side — the period picker for
		// Commits, plus a compact agent-status cluster in Activity mode.
		const showAgentCluster = mode === 'activity' && sessions.length > 0;
		const hasCrumbs = this._zoomPath.length > 0 && this.effectiveData?.root != null;
		return html`
			<div class="toolbar">
				<gl-graph-visualizations-switcher></gl-graph-visualizations-switcher>
				<span class="toolbar__title">${treemapTitles[mode]}</span>
				<gl-tooltip
					class="toolbar__experimental"
					placement="bottom"
					content="This is an experimental feature"
					distance="6"
				>
					<gl-badge appearance="experimental" aria-label="Experimental feature">EXP</gl-badge>
				</gl-tooltip>
				${hasCrumbs ? this.renderBreadcrumbs() : nothing} ${this.renderDescription()}
				${showAgentCluster
					? html`<gl-details-agent-status compact .sessions=${sessions}></gl-details-agent-status>`
					: nothing}
				<div class="toolbar__right">
					${showPeriodPicker
						? html`<gl-menu-popover
								placement="bottom-end"
								keep-open-on-select
								.items=${periodItems}
								@gl-menu-select=${this.onPeriodMenuSelect}
							>
								<button
									slot="anchor"
									class="period-button"
									type="button"
									aria-label="Change time range"
								>
									${periodLabels[period]}<code-icon icon="chevron-down"></code-icon>
								</button>
							</gl-menu-popover>`
						: nothing}
					${showDecayPicker
						? html`<gl-menu-popover
								placement="bottom-end"
								keep-open-on-select
								.items=${decayItems}
								@gl-menu-select=${this.onDecayMenuSelect}
							>
								<gl-tooltip
									slot="anchor"
									placement="bottom"
									distance="6"
									content="How long files stay highlighted after the agent reads or edits them"
								>
									<button
										class="period-button"
										type="button"
										aria-label="How long files stay highlighted after the agent reads or edits them"
									>
										${decayLabels[decay]}<code-icon icon="chevron-down"></code-icon>
									</button>
								</gl-tooltip>
							</gl-menu-popover>`
						: nothing}
					<gl-button
						appearance="toolbar"
						tooltip="Close Visualizations"
						aria-label="Close Visualizations"
						@click=${this.onCloseClick}
					>
						<code-icon icon="close"></code-icon>
					</gl-button>
				</div>
			</div>
			${mode === 'activity' &&
			(this.graphState.canInstallClaudeHook ?? false) &&
			!(this.graphState.hooksBannerCollapsed ?? true)
				? html`<gl-hooks-banner
						class="hooks-banner"
						source="graph-treemap"
						layout="responsive"
					></gl-hooks-banner>`
				: nothing}
			<div class="chart-container">
				<gl-treemap-chart
					.data=${this.effectiveData}
					.mode=${mode}
					.activity=${this.activeFiles}
					.activityDecayMs=${this.graphState.config?.activityDecayMs ?? 300000}
					?loading=${this._loading}
					@gl-treemap-zoom-change=${this.onChartZoomChange}
					@gl-treemap-file-click=${this.onChartFileClick}
				></gl-treemap-chart>
				${this._error
					? html`<div class="overlay" role="alert">
							<p>Failed to load treemap data</p>
							<gl-button appearance="secondary" @click=${this.handleRetry}>Retry</gl-button>
						</div>`
					: nothing}
			</div>
		`;
	}

	private readonly onChartZoomChange = (e: CustomEvent<TreemapZoomChangeDetail>): void => {
		this._zoomPath = e.detail.path;
	};

	/** Per-mode primary action for a file-leaf click. Folder clicks zoom (handled in the chart);
	 *  this handler only fires for leaves. Files mode opens the working file; Commits mode opens
	 *  the File History sidebar view; Activity mode always opens the file AND additionally focuses
	 *  the agent session reading/writing it when one can be identified (sidebar reveal + editor
	 *  focus land in different surfaces, so the user gets both pieces of context at once). */
	private readonly onChartFileClick = (e: CustomEvent<TreemapFileClickDetail>): void => {
		const absPath = e.detail.node.path;

		switch (this.mode) {
			case 'files':
				this.sendFileAction('open', absPath);
				return;

			case 'commits':
				this.sendFileAction('history', absPath);
				return;

			case 'activity': {
				// Dispatch the session-focus FIRST so the editor open (which steals focus) is the
				// last surface change the user sees — landing on the file matches the click intent
				// while the kanban session detail quietly slides in beside it.
				const session = this.findSessionForFile(absPath);
				if (session != null) {
					this.dispatchEvent(
						new CustomEvent('gl-graph-kanban-open-session', {
							detail: {
								sessionId: session.id,
								worktreePath: session.worktreePath,
								commonPath: session.commonPath,
							},
							bubbles: true,
							composed: true,
						}),
					);
				}

				this.sendFileAction('open', absPath);
				return;
			}

			default: {
				// Exhaustiveness assertion — turns "added a new TreemapMode without updating this
				// switch" into a compile error instead of a silently-dead click.
				const _exhaustive: never = this.mode;
				return _exhaustive;
			}
		}
	};

	private sendFileAction(action: TreemapFileActionParams['action'], absPath: string): void {
		// Send the repo-relative path + the repo it belongs to, so the host can scheme-preserve
		// the URI rehydration (Uri.file() on the host would coerce virtual-workspace paths to
		// non-resolving file:// URIs). Skip if we can't resolve a repo — shouldn't happen for a
		// node already painted in the tree, but defensive against transient state.
		const data = this.effectiveData;
		const rootPath = data?.root?.path;
		if (rootPath == null) return;

		const relPath = toRepoRelative(rootPath, absPath);
		if (relPath == null) return;

		this._ipc?.sendCommand(TreemapFileActionCommand, {
			action: action,
			repoPath: rootPath,
			path: relPath,
		});
	}

	/** Locate the agent session currently reading or writing the clicked file. Both sides are
	 *  normalized to repo-relative paths first — sessions in sibling worktrees of the same repo
	 *  family carry absolute paths anchored at their own `worktreePath`, so a raw `===` against the
	 *  active worktree's `node.path` would miss every cross-worktree match. Returns the first
	 *  match; if multiple sessions touch the same file we just pick whoever sorts first (rare and
	 *  not worth a UI for now). */
	private findSessionForFile(absPath: string): AgentSessionState | undefined {
		const data = this.effectiveData;
		const rootPath = data?.root?.path;
		if (rootPath == null) return undefined;

		const nodeRel = toRepoRelative(rootPath, absPath);
		if (nodeRel == null) return undefined;

		// Same repo-family roots as computeActiveFiles, so a session that touched this file from any
		// worktree (or the main checkout) is matched, not just one rooted at the displayed worktree.
		const familyRoots = this.collectFamilyRoots(
			rootPath,
			this.effectiveRepo?.commonPath,
			this.graphState.worktreePaths,
			this.repoFamilySessions,
		);
		for (const session of this.repoFamilySessions) {
			const activity = session.fileActivity;
			if (activity == null) continue;

			for (const a of activity) {
				for (const root of familyRoots) {
					if (toRepoRelative(root, a.path) === nodeRel) return session;
				}
			}
		}
		return undefined;
	}

	/** Description that trails the breadcrumbs in the toolbar — file count for Files / Activity
	 *  and a "X files · Y commits" pair for Commits. Scoped to whatever the current zoom path is
	 *  so it answers "what am I looking at right now?" rather than "what's in the whole repo".
	 *
	 *  Commit count is the sum of per-file commit-touches across files in the scope. NOT unique
	 *  commits — the per-file frequency map doesn't carry SHA sets, so this slightly overcounts
	 *  when a single commit touches multiple files. Accurate unique-commit counts would need the
	 *  host to send a per-folder SHA-set aggregation; flagged for a follow-up. */
	private renderDescription() {
		const mode = this.mode;
		if (mode === 'activity') return nothing;

		const data = this.effectiveData;
		if (data?.root == null) return nothing;

		const root = data.root;

		const scope = this._zoomPath.at(-1) ?? root;
		const fileCount = countFiles(scope);
		if (fileCount === 0) return nothing;

		const filesText = `${fileCount.toLocaleString()} file${fileCount === 1 ? '' : 's'}`;
		if (mode === 'files') {
			return html`<span class="toolbar__description">${filesText}</span>`;
		}

		// Commits mode: pull the unique-commit count for the scope from the host's pre-computed
		// per-folder aggregation. Direct lookup — no recursive sum (which would inflate counts by
		// the average files-per-commit factor since each commit touches many leaves in a folder).
		const freq = data.frequencies;
		if (freq == null) {
			return html`<span class="toolbar__description">${filesText}</span>`;
		}

		const commitCount = lookupCommitCount(scope, freq, root);
		const commitsText = `${commitCount.toLocaleString()} commit${commitCount === 1 ? '' : 's'}`;
		return html`<span class="toolbar__description">${commitsText} · ${filesText}</span>`;
	}

	/** Breadcrumb chain shown in the toolbar between the visualization switcher and the
	 *  description/right-group. Hidden entirely when the tree is unscoped — the "FILES" /
	 *  "COMMITS" title already telegraphs "you're looking at the whole repo", so a lone
	 *  "Repository" crumb would just add noise.
	 *
	 *  When scoped, the leading root crumb is an icon-only "back to repo" affordance (tooltip
	 *  "Back to Repository"); each subsequent zoom-path segment renders its folder name. Clicking
	 *  any crumb asks the chart to zoom there; clicking the last (current) crumb is a no-op. */
	private renderBreadcrumbs() {
		const root = this.effectiveData?.root;
		if (root == null) return nothing;
		if (this._zoomPath.length === 0) return nothing;

		const crumbs = [root, ...this._zoomPath];
		return html`<gl-breadcrumbs class="toolbar__crumbs" density="compact" label="Treemap zoom path">
			${crumbs.map((node, i) => {
				const isRoot = i === 0;
				const isCurrent = i === crumbs.length - 1;
				const label = isRoot ? 'Back to Repository' : node.name;
				const icon = isRoot ? 'gl-repository' : 'folder';
				return html`<gl-breadcrumb-item
					interactive
					icon=${icon}
					label=${label}
					aria-current=${isCurrent ? 'page' : nothing}
					@click=${() => (isCurrent ? undefined : this._chart?.zoomTo(node))}
				>
					${isRoot ? html`<span slot="tooltip">${label}</span>` : label}
				</gl-breadcrumb-item>`;
			})}
		</gl-breadcrumbs>`;
	}
}

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-graph-timeline-close': CustomEvent<void>;
	}
}
