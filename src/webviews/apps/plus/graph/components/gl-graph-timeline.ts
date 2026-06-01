import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { RepositoryShape } from '../../../../../git/models/repositoryShape.js';
import { GetMoreRowsCommand } from '../../../../plus/graph/protocol.js';
import type {
	TimelineDatum,
	TimelinePeriod,
	TimelineScopeSerialized,
	TimelineScopeType,
	TimelineSliceBy,
} from '../../../../plus/timeline/protocol.js';
import { periodToMs } from '../../../../plus/timeline/utils/period.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import { isPseudoCommitDatum } from '../../timeline/components/chart/timelineData.js';
import type { CommitEventDetail, LoadMoreEventDetail } from '../../timeline/components/chart.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import '../../timeline/components/chart.js';
import '../../timeline/components/header.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import './gl-graph-visualizations-switcher.js';

export interface GlGraphTimelineCommitSelectDetail {
	sha: string;
	repoPath: string;
	shift: boolean;
	datum?: TimelineDatum;
}

export interface GlGraphTimelineConfigChangeDetail {
	period?: TimelinePeriod;
	sliceBy?: TimelineSliceBy;
	showAllBranches?: boolean;
}

@customElement('gl-graph-timeline')
export class GlGraphTimeline extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			position: relative;
			overflow: hidden;
		}

		.header-row {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			flex: none;
			/* 0.6rem horizontal so the switcher (left) and close button (right) sit at matching
			 * tight insets — same chrome as the Treemap visualization toolbar. */
			padding: 0.4rem 0.6rem;
			min-height: 3.2rem;
			min-width: 0;
			border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
		}

		.header-row gl-graph-visualizations-switcher {
			flex: none;
		}

		/* Matches the treemap toolbar's title — uppercase, dim, fixed-width — so the visualization
		 * label anchors both header rows identically. Sits between the icon switcher and the
		 * shared timeline header so the standalone Visual History webview (which doesn't use this
		 * file) keeps its existing chrome. */
		.header-row__title {
			flex: none;
			font-size: 1.1rem;
			font-weight: 600;
			text-transform: uppercase;
			white-space: nowrap;
		}

		.header-row gl-timeline-header {
			flex: 1 1 auto;
			min-width: 0;
		}

		.empty {
			flex: 1 1 auto;
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--color-foreground--65);
			padding: 1rem;
			text-align: center;
		}

		gl-timeline-chart {
			flex: 1 1 auto;
			min-height: 0;
		}
	`;

	@property({ type: String, reflect: true })
	placement: 'editor' | 'view' = 'editor';

	/** External file/folder scope pushed in by a graph context-menu action. When set (new object
	 *  identity), `willUpdate` adopts it as the local scope; `updated` then signals it was applied
	 *  so the host can clear it (one-shot). */
	@property({ attribute: false })
	scope?: { type: 'file' | 'folder'; relativePath: string };

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	@consume({ context: ipcContext })
	private _ipc?: typeof ipcContext.__context__;

	@state()
	private _resolvedScope?: TimelineScopeSerialized;

	/** User-picked file/folder scope (overrides repo scope when set). Reset to repo when the
	 *  active repo or graph scope changes. */
	@state()
	private _localScope?: { type: TimelineScopeType; relativePath: string };

	/** Last array of `TimelineDatum`s the chart has seen — used by the sha→datum cache and the
	 *  hasMore detection. NOT `@state`: render() reads `_windowedDataPromise` /
	 *  `_resolvedScope` / `_hasShownData`. Avoids the implicit state-mutation-from-render that
	 *  the older `@state _data` field caused. */
	private _lastResolvedData: readonly TimelineDatum[] = [];

	private _datumByShaCache?: Map<string, TimelineDatum>;

	private _lastRepoPath?: string;
	/** Last-seen local-scope key (`type::relativePath` or `'repo'` for repo scope). Drives the
	 *  scope-change reset in `willUpdate` so per-file state (auto-page counter, visible-span)
	 *  resets when the user picks a different file/folder, without nuking the wider data caches. */
	private _lastLocalScopeKey?: string;

	/** `scopeKey` discriminates repo vs. file/folder cache hits — without it, transitioning
	 *  from a scoped build back to repo scope would falsely hit a stale entry. */
	private _windowedDatasetCacheKey?: {
		rows: unknown;
		rowsStats: unknown;
		period: TimelinePeriod;
		scopeKey?: string;
	};

	/** Survives WIP-driven graph-row re-emits (file save → same length, new reference) so we
	 *  don't run the `git log --all -- <path>` RPC on every keystroke. */
	private _scopedShasCache?: { key: string; shas: Set<string> };
	@state()
	private _windowedDataPromise?: Promise<TimelineDatum[]>;
	/** Cached newest-pseudo timestamp for windowed mode so chart sees same-newest extension when
	 *  graph rows extend (we generate the pseudo-newest entry locally). Cleared in lockstep with
	 *  `_windowedDatasetCacheKey` — repo / period / scope changes — so a new repo's newest WIP
	 *  isn't anchored to the prior repo's stale timestamp. */
	private _windowedPseudoNewestTimestamp?: number;

	/** Reactive flag — true once we've derived a dataset for the current scope at least once.
	 *  Used to gate the first-paint stats-loading wait WITHOUT depending on `_windowedDataPromise`
	 *  (which is a non-`@state` field and wouldn't trigger Lit re-renders). After the first
	 *  paint, we accept stale stats while updates trickle in instead of returning undefined and
	 *  letting the chart spin. */
	@state()
	private _hasShownData = false;

	/** Reactive flag — true while a `GetMoreRowsCommand` request is in flight (we've sent it, the
	 *  graph hasn't responded yet). The graph webview doesn't toggle `state.loading` during paging
	 *  so this is the ONLY signal we have for "load-more is happening" — drives both the chart's
	 *  edge indicator and our debounce so we don't queue duplicate requests. Cleared when
	 *  `graphState.rows` reference changes (new data arrived). */
	@state()
	private _loadMoreInFlight = false;
	/** Last-seen `graphState.rows` reference; used to detect when the graph has merged in new
	 *  rows so we can clear `_loadMoreInFlight`. */
	private _lastSeenRowsRef?: unknown;

	/** Live visible-time-range span (ms) reported by the chart. Drives the header pill so it
	 *  shows the actual span (zoomed, panned) instead of the static period setting. */
	@state()
	private _visibleSpanMs?: number;

	/** Cap on consecutive auto-page attempts for a single scope. Auto-paging fires when a
	 *  file/folder scope yields no commits in the currently-loaded graph rows — we ask for more
	 *  rows to surface deeper history. Without a cap, files with NO matches anywhere in the repo
	 *  would page until `paging.hasMore` flips false (the entire history loaded), producing a
	 *  prolonged "loading loop". 5 attempts at ~50-100 rows each covers files with commits in
	 *  the last ~250-500 graph rows; beyond that the user must scroll manually. Reset on
	 *  scope/repo change in `_resetWindowedCaches`. */
	private static readonly maxAutoPageAttempts = 5;
	private _autoPageAttempts = 0;

	/** Safety cap for the `period === 'all'` auto-pager. The user explicitly asked for all
	 *  history, so we drive the graph's paging until `paging.hasMore` flips false — but a
	 *  badly-paginated host could in theory page indefinitely, so cap at 200 chunks (~10–20k
	 *  commits at typical graph page sizes) as a guardrail. Reset on scope/repo change. */
	private static readonly maxAllTimePageAttempts = 200;
	private _allTimePageAttempts = 0;

	override willUpdate(changedProperties: PropertyValues): void {
		// Adopt an externally-pushed scope (graph context-menu action) as the local scope. Done
		// first so the repo-change reset below doesn't wipe it on a fresh mount (where
		// `_lastRepoPath` is still undefined).
		const injectedScope = changedProperties.has('scope') && this.scope != null;
		if (injectedScope) {
			this._localScope = { type: this.scope!.type, relativePath: this.scope!.relativePath };
		}

		// Reset the local file/folder scope if the active repo changed underneath us — paths
		// don't carry across repos. Also wipe windowed-mode caches so the new repo's WIP doesn't
		// inherit the prior repo's anchor timestamp.
		const repoPath = this.effectiveRepo?.path;
		if (repoPath !== this._lastRepoPath) {
			this._lastRepoPath = repoPath;
			this._resetWindowedCaches();
			if (this._localScope != null && !injectedScope) {
				this._localScope = undefined;
				// Don't bail — rebuild below for the new (still-windowed) state in this same cycle.
			}
		}

		// Reset per-scope state when the user picks a different file/folder. Lighter than
		// `_resetWindowedCaches` (we keep the dataset caches; the next derivation handles
		// rebuild), but the auto-page counter and visible-span are tied to the displayed scope
		// — leaking them across file picks blocks auto-paging on a new sparse file and shows a
		// stale span on the header pill.
		const localScopeKey = this._localScope ? `${this._localScope.type}::${this._localScope.relativePath}` : 'repo';
		if (localScopeKey !== this._lastLocalScopeKey) {
			this._lastLocalScopeKey = localScopeKey;
			this._resetLocalScopeState();
		}

		// Clear the load-more in-flight flag when the graph's rows reference changes (response to
		// our `GetMoreRowsCommand` has landed). This is the only signal we get since the host
		// doesn't toggle `state.loading` during paging.
		const rows = this.graphState.rows;
		if (this._loadMoreInFlight && rows != null && rows !== this._lastSeenRowsRef) {
			this._loadMoreInFlight = false;
			this._lastSeenRowsRef = rows;
		}

		// Dispatch dataset derivation by scope. Repo scope builds synchronously from
		// `graphState.rows` so the chart's `dataPromise` is populated on the FIRST render. File/
		// folder scope kicks off an async build — one `getShasForPath` RPC plus a row filter —
		// and writes to the same `_windowedDataPromise` when ready, so the chart sees a single
		// mode-stable dataset stream.
		if (this._localScope == null) {
			this._buildWindowedDatasetIfNeeded();
		} else {
			void this._buildScopedDatasetIfNeeded();
		}

		// `All time` period in the embedded timeline = drive the graph's paging until
		// `paging.hasMore` flips false, since the dataset comes from `graphState.rows` (not a
		// fresh host fetch). Without this loop the chart only shows whatever the graph happened
		// to have loaded when the user picked `'all'`. Each load-more response updates `rows`,
		// re-triggers `willUpdate`, and we fire again until there's nothing more to fetch (or
		// the safety cap is hit).
		if (this.period === 'all') {
			this._maybeAutoPageForAllTime();
		} else if (this._allTimePageAttempts > 0) {
			// Reset the counter when the user navigates away from `'all'` so a future `'all'`
			// switch gets a fresh budget.
			this._allTimePageAttempts = 0;
		}
	}

	override updated(changedProperties: PropertyValues): void {
		// Signal that an externally-pushed scope has been adopted so the host can clear it — keeps
		// the push one-shot (a later manual graph↔timeline toggle won't re-apply a stale scope).
		if (changedProperties.has('scope') && this.scope != null) {
			this.dispatchEvent(new CustomEvent('gl-graph-timeline-scope-applied', { bubbles: true, composed: true }));
		}
	}

	/** Compute an adaptive page size based on how many rows are already loaded — small repos
	 *  finish snappily at the host's default while large repos accelerate as the loaded count
	 *  grows. The growth curve assumes "if you've already paged through N rows, paging N more
	 *  in one shot is proportionate". Capped because past a certain page size the bottleneck
	 *  shifts from per-RPC overhead to per-row work (stats, ref resolution, IPC serialization),
	 *  and chunks bigger than ~5000 stop helping wall time.
	 *
	 *  Tuning rationale:
	 *  - First page (rows = 0): 200 — same as host default, keeps the first paint fast.
	 *  - Mid-size (~2k rows loaded): ~500 — still small enough not to noticeably stall.
	 *  - Large (~10k rows loaded): ~2000 — significantly fewer RPCs for the long tail.
	 *  - Cap at 5000 — past this, larger pages don't speed up wall time appreciably and start
	 *    pushing the host's render budget into noticeable chunks.
	 *
	 *  `mode` discriminates "burn through everything" (all-time) from "load some more" (the
	 *  chart's user-driven pan). All-time is more aggressive — the user explicitly asked for
	 *  everything so longer per-chunk waits are acceptable. Pan should stay responsive. */
	private static adaptivePageSize(rowsLoaded: number, mode: 'all' | 'pan'): number {
		const min = 200;
		const max = mode === 'all' ? 5000 : 2000;
		const target = Math.round(rowsLoaded * 0.25);
		return Math.max(min, Math.min(max, target));
	}

	private _maybeAutoPageForAllTime(): void {
		if (this._loadMoreInFlight) return;
		if (this.graphState.paging?.hasMore !== true) return;
		if (this._allTimePageAttempts >= GlGraphTimeline.maxAllTimePageAttempts) return;

		const rows = this.graphState.rows;
		if (rows == null || rows.length === 0) return;

		const oldestSha = rows.at(-1)?.sha;
		if (!oldestSha) return;

		this._allTimePageAttempts++;
		this._loadMoreInFlight = true;
		this._lastSeenRowsRef = rows;
		this.graphState.loading = true;
		this._ipc?.sendCommand(GetMoreRowsCommand, {
			id: oldestSha,
			limit: GlGraphTimeline.adaptivePageSize(rows.length, 'all'),
		});
	}

	private get effectiveRepo() {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		return repoId != null ? (repos?.find(r => r.id === repoId) ?? repos?.[0]) : repos?.[0];
	}

	private get period(): TimelinePeriod {
		return this.graphState.timeline?.period ?? '1|M';
	}

	private get sliceBy(): TimelineSliceBy {
		return this.graphState.timeline?.sliceBy ?? 'author';
	}

	/** Slice-by is meaningful only for file/folder scopes — slicing the entire repo across
	 *  authors/branches doesn't add insight. Mirrors standalone `isSliceBySupported`. */
	private get sliceBySupportedEffective(): boolean {
		const scopeType = this._localScope?.type ?? 'repo';
		if (scopeType === 'repo') return false;
		return this.effectiveRepo?.virtual !== true;
	}

	/** Honor the user's slice preference only when slicing is supported AND multiple branches
	 *  are actually being viewed. Otherwise force 'author' so the chart never renders a
	 *  single-branch slice-by-branch view. Mirrors standalone `effectiveSliceBy`. */
	private get effectiveSliceBy(): TimelineSliceBy {
		return this.sliceBySupportedEffective && this.showAllBranchesEffective ? this.sliceBy : 'author';
	}

	/** When the Graph is in "All Branches" visibility AND no specific branch is scoped, the timeline
	 *  uses the host's `--all` shortcut. For every other visibility mode (smart/favorited/current),
	 *  we walk specific refs via `additionalBranchesEffective` instead — keeps timeline data in sync
	 *  with what the Graph is showing. */
	private get showAllBranchesEffective(): boolean {
		if (this.graphState.scope != null) return false;
		return this.graphState.branchesVisibility === 'all';
	}

	/** Branch names from the Graph's `includeOnlyRefs` filter — these are the actual refs the Graph
	 *  is showing for non-`'all'` visibility modes. Returns `undefined` when in `'all'` mode (the
	 *  `--all` walk covers it) or when there are no refs to add (caller falls back to HEAD). */
	private get additionalBranchesEffective(): string[] | undefined {
		if (this.graphState.scope != null) return undefined; // scoped to one branch — single ref via head
		if (this.showAllBranchesEffective) return undefined; // --all covers everything

		const includeOnlyRefs = this.graphState.includeOnlyRefs;
		if (includeOnlyRefs == null) return undefined;

		const names: string[] = [];
		for (const ref of Object.values(includeOnlyRefs)) {
			// Skip the empty-set marker ('gk.empty-set-marker') and any malformed entries — only
			// pull genuine refs with names.
			if (ref == null || typeof ref !== 'object' || !('name' in ref) || typeof ref.name !== 'string') continue;
			if (!ref.name) continue;

			names.push(ref.name);
		}
		return names.length ? names : undefined;
	}

	/** Convert a `TimelinePeriod` (`'1|Y'`, `'30|D'`, `'all'`) to a millisecond span for the
	 *  windowed viewport. `'all'` collapses to undefined (the chart will fall back to the loaded
	 *  dataset's full bounds). Delegates to the shared `periodToMs` so the viewport math stays in
	 *  lockstep with the host's `getPeriodDate` fetch span — calendar-accurate (leap years,
	 *  variable month lengths) instead of the previous 30-day-month / 365-day-year approximation. */
	private get windowSpanMs(): number | undefined {
		return periodToMs(this.period);
	}

	/** Derive the timeline dataset from the graph's loaded rows + stats — used in windowed (repo-
	 *  scope) mode. Mutates `_windowedDataPromise`, `_resolvedScope`, `_lastResolvedData`,
	 *  `_hasShownData`, and the windowed-cache fields. Called from `updated()`, NOT from `render()`,
	 *  so render is a pure projection of state instead of a state-mutating side-effect site.
	 *
	 *  Cache check on `(rows, rowsStats)` references means repeated calls with no input change
	 *  exit early (one map lookup). When rows or stats change, rebuilds the dataset; when stats
	 *  are still loading, holds the previous promise so the chart sees a stable view until length
	 *  + stats land in a single step (preserves the same-newest extension detection). */
	private _buildWindowedDatasetIfNeeded(): void {
		const rows = this.graphState.rows;
		if (rows == null) return;

		// Stats gate — applied to ALL rebuilds, not just first paint. If stats are still loading,
		// hold the previous promise; the next willUpdate will rebuild once stats settle.
		if (this.graphState.rowsStatsLoading === true) return;

		const rowsStats = this.graphState.rowsStats;
		const period = this.period;
		const cache = this._windowedDatasetCacheKey;
		// Repo-scope cache key has no `scopeKey`; check it explicitly so a transition from
		// file/folder scope back to repo invalidates correctly (scoped builder writes a non-null
		// scopeKey we'd otherwise false-hit on).
		if (
			cache?.rows === rows &&
			cache?.rowsStats === rowsStats &&
			cache?.period === period &&
			cache?.scopeKey == null
		) {
			return;
		}

		// Period changed → discard the stale pseudo-anchor so the rebuild seeds a fresh one from
		// the current data (the prior anchor was set under a different timeframe context).
		if (cache != null && cache.period !== period) {
			this._windowedPseudoNewestTimestamp = undefined;
		}

		const avatars = this.graphState.avatars;
		// Per-row hot path on graphs with many commits — compute the timestamp once and derive the
		// ISO string from it (was: two `new Date(row.date)` calls per row, one for `date` via
		// `toISOString()` and one for `sort` via `getTime()`). Cuts row-build Date allocations
		// roughly in half. The chart only reads `commit.sort` for positioning; `date` is consumed
		// by the slider for display and lookup, so we still produce the ISO string here.
		const data: TimelineDatum[] = rows.map(row => {
			const stats = rowsStats?.[row.sha];
			const avatarUrl = avatars != null && row.email ? avatars[row.email] : undefined;
			const sortMs = typeof row.date === 'number' ? row.date : new Date(row.date).getTime();
			return {
				sha: row.sha,
				author: row.author,
				email: row.email,
				avatarUrl: avatarUrl,
				date: new Date(sortMs).toISOString(),
				message: row.message,
				additions: stats?.additions,
				deletions: stats?.deletions,
				files: stats?.files,
				sort: sortMs,
			};
		});
		// Match the chart's expectation that data is sorted newest-first.
		data.sort((a, b) => b.sort - a.sort);

		// Stabilize the newest pseudo-commit timestamp across rebuilds. Without this, every fresh
		// derivation produces a slightly different "now"-anchored sort/date for any synthetic-newest
		// row (e.g. WIP), and the chart's same-newest extension detection would treat each rebuild
		// as a fresh dataset and reset zoom + scroll on every load-more.
		if (data.length > 0 && isPseudoCommitDatum(data[0])) {
			if (this._windowedPseudoNewestTimestamp != null) {
				const stable = this._windowedPseudoNewestTimestamp;
				data[0] = { ...data[0], date: new Date(stable).toISOString(), sort: stable };
			} else {
				this._windowedPseudoNewestTimestamp = data[0].sort;
			}
		}

		this._windowedDatasetCacheKey = { rows: rows, rowsStats: rowsStats, period: period };
		this._windowedDataPromise = Promise.resolve(data);
		this._resolvedScope = {
			type: 'repo',
			uri: this.effectiveRepo?.uri ?? '',
			head: undefined,
			base: undefined,
			relativePath: '',
		};
		this._lastResolvedData = data;
		this._datumByShaCache = undefined;
		// Reactive flag — Lit re-renders so `graphIsInitialLoading` flips off and the overlay clears.
		this._hasShownData = true;
	}

	/** Reset all windowed-mode caches (dataset, pseudo-anchor, promise, scoped-SHAs) — called
	 *  whenever the active repo or local scope changes so the next derivation uses the new
	 *  context's newest WIP timestamp and SHA filter instead of the prior context's stale ones. */
	private _resetWindowedCaches(): void {
		this._windowedDatasetCacheKey = undefined;
		this._windowedDataPromise = undefined;
		this._windowedPseudoNewestTimestamp = undefined;
		this._datumByShaCache = undefined;
		this._scopedShasCache = undefined;
		this._autoPageAttempts = 0;
		this._allTimePageAttempts = 0;
		// `_visibleSpanMs` is tied to the chart's current viewport — on a repo change the chart
		// will emit a fresh `gl-visible-range-changed` once the new dataset lands, but until
		// then the header pill would display the stale span from the previous repo. Clear here
		// so the pill falls back to the static period label until the chart catches up.
		this._visibleSpanMs = undefined;
	}

	/** Reset scope-tied state when the user changes the local file/folder selection (separate
	 *  from repo change, which goes through `_resetWindowedCaches`). The auto-page counter and
	 *  the visible-span are tied to the displayed scope — leaking them across file picks would
	 *  block auto-paging on the new file and show a stale span on the pill. */
	private _resetLocalScopeState(): void {
		this._autoPageAttempts = 0;
		this._allTimePageAttempts = 0;
		this._visibleSpanMs = undefined;
	}

	/** Chart asks for more older history when the user pans into the left edge. In windowed mode we
	 *  ask the graph host to load more rows — its existing paging path merges new rows into state,
	 *  which bubbles back via SignalWatcher and triggers a fresh dataset derivation. We track the
	 *  in-flight state ourselves because `state.loading` is NOT toggled by the graph webview during
	 *  paging (verified in `graphWebview.ts:onGetMoreRows` — it just calls `notifyDidChangeRows`). */
	private onChartLoadMoreFromGraph = (_e: CustomEvent<LoadMoreEventDetail>): void => {
		if (this._loadMoreInFlight) return; // already requested; wait for response
		if (this.graphState.paging?.hasMore !== true) return;

		const rows = this.graphState.rows;
		if (rows == null || rows.length === 0) return;

		const oldestSha = rows.at(-1)?.sha;
		if (!oldestSha) return;

		this._loadMoreInFlight = true;
		this._lastSeenRowsRef = rows;
		// Also flip the graph's global loading flag so the header's progress-indicator activates
		// alongside the chart's edge scanner — matches the `onScopeAnchorsUnreachable` paging path
		// in graph-wrapper.ts. The notification handler in stateProvider resets it to false on
		// `DidChangeRowsNotification` arrival.
		this.graphState.loading = true;
		this._ipc?.sendCommand(GetMoreRowsCommand, {
			id: oldestSha,
			limit: GlGraphTimeline.adaptivePageSize(rows.length, 'pan'),
		});
	};

	private onChartVisibleRangeChanged = (e: CustomEvent<{ oldest: number; newest: number }>): void => {
		this._visibleSpanMs = e.detail.newest - e.detail.oldest;
	};

	/** True until first dataset has been derived for the current scope. Drives the full-canvas
	 *  loading overlay in windowed mode. Uses observable state (`_hasShownData` is `@state` and
	 *  re-renders trigger re-evaluation), unlike a check on `_windowedDataPromise` which is a
	 *  non-reactive private field. */
	private get graphIsInitialLoading(): boolean {
		if (this._hasShownData) return false;

		const hasRows = (this.graphState.rows?.length ?? 0) > 0;
		if (!hasRows) return this.graphState.loading === true;
		// Rows landed; we're holding for stats. Keep the overlay so bubbles render correctly when
		// the stats-ready gate clears and the dataset finally derives.
		return this.graphState.rowsStatsLoading === true;
	}

	/** True while a `GetMoreRowsCommand` is in flight OR stats are catching up for already-loaded
	 *  rows. Drives the chart's edge-indicator affordance — the chart stays fully interactive
	 *  while paging is in flight. */
	private get graphIsLoadingMore(): boolean {
		if (!this._hasShownData) return false; // initial load is handled by `graphIsInitialLoading`
		if (this._loadMoreInFlight) return true;
		return this.graphState.rowsStatsLoading === true;
	}

	/** Scoped-derive path for file/folder scope. Builds the timeline dataset entirely from
	 *  `graphState.rows` (the graph already has per-commit reachability + stats) plus a single
	 *  `getShasForPath` RPC for the path filter. Avoids the per-commit `git branch --contains`
	 *  loop that `computeTimelineDataset` runs on the host for branch slicing.
	 *
	 *  Writes to the same `_windowedDataPromise` as `_buildWindowedDatasetIfNeeded` so the chart
	 *  consumes a single, mode-stable dataset stream — repo and file/folder scope share the
	 *  windowed UX (timeframe = initial viewport, zoom-out → load-more) instead of mode-flipping.
	 *
	 *  Re-entrant safe: the cache key (matching `_buildWindowedDatasetIfNeeded`'s pattern with an
	 *  added `scopeKey` discriminator) early-exits when nothing relevant has changed. The async
	 *  await re-checks input identity before committing results so a stale build doesn't clobber
	 *  a newer one. */
	private async _buildScopedDatasetIfNeeded(): Promise<void> {
		const services = this.services;
		const repo = this.effectiveRepo;
		const localScope = this._localScope;
		if (services == null || repo == null || localScope == null) return;

		const rows = this.graphState.rows;
		if (rows == null || rows.length === 0) return;
		// Stats gate — same rationale as the windowed builder: while stats are streaming in,
		// hold the previous dataset so we don't repaint with partial additions/deletions.
		if (this.graphState.rowsStatsLoading === true) return;

		const rowsStats = this.graphState.rowsStats;
		const period = this.period;
		const scopeKey = `${localScope.type}::${localScope.relativePath}`;
		const cache = this._windowedDatasetCacheKey;
		if (
			cache?.rows === rows &&
			cache?.rowsStats === rowsStats &&
			cache?.period === period &&
			cache?.scopeKey === scopeKey
		) {
			return;
		}

		const path = localScope.relativePath;
		// All-time SHAs touching the path — one cheap `git log --all --pretty=%H -- <path>`. The
		// visible dataset is bounded by `graphState.rows` (paginated via the chart's
		// `gl-load-more` → `GetMoreRowsCommand`), so a period-based filter here would prevent
		// older file history from surfacing as the user pans into the graph's older rows.
		// Cache key includes `rows[0].sha` so an amend/rebase that swaps the head commit
		// invalidates correctly; `rows.length` discriminates paging extensions; both are
		// unchanged by WIP-only churn so file saves don't re-fire the RPC.
		const shasCacheKey = `${repo.path}::${scopeKey}::${rows[0]?.sha ?? ''}::${rows.length}`;
		let shaSet: Set<string>;
		if (this._scopedShasCache?.key === shasCacheKey) {
			// SHAs cache hit — WIP-driven graph-row updates (file save → graph re-emits rows)
			// don't change which historical commits touched the path, so we skip the
			// `getShasForPath` RPC entirely. Sets are reused by reference; safe because we
			// invalidate on scope/repo change AND on row-count change.
			shaSet = this._scopedShasCache.shas;
		} else {
			let shas: readonly string[];
			try {
				const graphTimeline = await services.graphTimeline;
				shas = await graphTimeline.getShasForPath(repo.path, path);
			} catch {
				// Leave the previous dataset on screen — better than blanking on a transient failure.
				return;
			}

			// Race guard — if anything we keyed on changed during the await (user picked a
			// different scope, period, or graph rows extended), abandon this build. The next
			// willUpdate will trigger another with the new inputs.
			if (
				this.graphState.rows !== rows ||
				this.graphState.rowsStats !== rowsStats ||
				this._localScope !== localScope ||
				this.period !== period
			) {
				return;
			}

			shaSet = new Set(shas);
			this._scopedShasCache = { key: shasCacheKey, shas: shaSet };
		}
		const avatars = this.graphState.avatars;
		const data: TimelineDatum[] = [];
		for (const row of rows) {
			if (!shaSet.has(row.sha)) continue;

			const stats = rowsStats?.[row.sha];
			const avatarUrl = avatars != null && row.email ? avatars[row.email] : undefined;
			// Branch attribution comes from the graph's reachability data — no per-commit
			// `git branch --contains` calls needed. Decoded on demand from the shared table and cached
			// by set index, so distinct sets decode once across all rows. `refType === 'branch'`
			// filters out tag refs (the timeline groups by branch only).
			const reachability = this.graphState.getRowReachability(row);
			const branches = reachability?.refs
				.filter(
					(r): r is { refType: 'branch'; name: string; remote: boolean; current?: boolean } =>
						r.refType === 'branch',
				)
				.map(r => r.name);
			// Single Date construction per row — see `_buildWindowedDatasetIfNeeded` for rationale.
			const sortMs = typeof row.date === 'number' ? row.date : new Date(row.date).getTime();
			data.push({
				sha: row.sha,
				author: row.author,
				email: row.email,
				avatarUrl: avatarUrl,
				date: new Date(sortMs).toISOString(),
				message: row.message,
				additions: stats?.additions,
				deletions: stats?.deletions,
				files: stats?.files,
				branches: branches,
				sort: sortMs,
			});
		}
		data.sort((a, b) => b.sort - a.sort);

		this._windowedDatasetCacheKey = { rows: rows, rowsStats: rowsStats, period: period, scopeKey: scopeKey };
		this._windowedDataPromise = Promise.resolve(data);
		this._resolvedScope = {
			type: localScope.type,
			uri: path !== '' ? `${repo.uri.replace(/\/$/, '')}/${path}` : repo.uri,
			head: undefined,
			base: undefined,
			relativePath: path,
		};
		this._lastResolvedData = data;
		this._datumByShaCache = undefined;
		this._hasShownData = true;

		// Sparse-file auto-page: if the graph rows we have yielded NO file-touching commits and
		// the graph has more rows to load, kick off a `GetMoreRowsCommand` to surface deeper
		// history. Fixes the case where a file last modified hundreds of commits ago appears as
		// an empty chart until the user manually pans into the left edge.
		//
		// Gated by:
		//   - `data.length === 0` (was previously `< 20`, which kept firing for files with a
		//     handful of total matches across the repo — paging-in more rows ticked the count
		//     up by 1-2 per chunk, never hit 20, looped through the entire history). With `=== 0`
		//     we stop the moment ANY match appears; the user pans manually for more.
		//   - `_autoPageAttempts < maxAutoPageAttempts` so files with NO matches anywhere don't
		//     page through the entire repo. Cap is reset on scope/repo change.
		//   - Shared `_loadMoreInFlight` debounce with the chart's `gl-load-more` path.
		if (
			data.length === 0 &&
			this._autoPageAttempts < GlGraphTimeline.maxAutoPageAttempts &&
			this.graphState.paging?.hasMore === true &&
			!this._loadMoreInFlight
		) {
			const oldestSha = rows.at(-1)?.sha;
			if (oldestSha) {
				this._autoPageAttempts++;
				this._loadMoreInFlight = true;
				this._lastSeenRowsRef = rows;
				this.graphState.loading = true;
				this._ipc?.sendCommand(GetMoreRowsCommand, {
					id: oldestSha,
					limit: GlGraphTimeline.adaptivePageSize(rows.length, 'pan'),
				});
			}
		}
	}

	private datumBySha(sha: string): TimelineDatum | undefined {
		if (this._datumByShaCache == null) {
			const map = new Map<string, TimelineDatum>();
			for (const d of this._lastResolvedData) {
				if (d.sha) {
					map.set(d.sha, d);
				}
			}
			this._datumByShaCache = map;
		}
		return this._datumByShaCache.get(sha);
	}

	private onChartCommitSelected = (e: CustomEvent<CommitEventDetail>): void => {
		// Skip interim slider scrubs — only commit on release. Mirrors the standalone Visual History
		// debounce behavior so transient hovers don't churn the details panel.
		if (e.detail.interim) return;

		const sha = e.detail.id;
		if (sha == null) return;

		const repoPath = this.effectiveRepo?.path ?? '';
		const datum = this.datumBySha(sha);
		this.dispatchEvent(
			new CustomEvent<GlGraphTimelineCommitSelectDetail>('gl-graph-timeline-commit-select', {
				detail: { sha: sha, repoPath: repoPath, shift: e.detail.shift, datum: datum },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onCloseClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-timeline-close', { bubbles: true, composed: true }));
	};

	private dispatchConfigChange(detail: GlGraphTimelineConfigChangeDetail): void {
		this.dispatchEvent(
			new CustomEvent<GlGraphTimelineConfigChangeDetail>('gl-graph-timeline-config-change', {
				detail: detail,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onHeaderPeriodChange = (e: CustomEvent<{ period: TimelinePeriod }>): void => {
		this.dispatchConfigChange({ period: e.detail.period });
	};

	private onHeaderSliceByChange = (e: CustomEvent<{ sliceBy: TimelineSliceBy }>): void => {
		this.dispatchConfigChange({ sliceBy: e.detail.sliceBy });
	};

	// Note: `gl-timeline-header-show-all-branches-change` isn't wired here — in the Graph mode the
	// "View All Branches" axis is controlled by the Graph header's scope picker / branchesVisibility,
	// not a per-timeline checkbox. We pass `showAllBranchesSupported={false}` so the popover hides
	// that toggle entirely and the dataset derives from `showAllBranchesEffective`.

	private onHeaderChoosePath = async (): Promise<void> => {
		const services = this.services;
		const repo = this.effectiveRepo;
		if (services == null || repo == null) return;

		const graphTimeline = await services.graphTimeline;
		const result = await graphTimeline.choosePath({
			repoUri: repo.path,
			ref: this.graphState.branch,
			title: 'Choose File or Folder to Visualize',
			initialPath: this._localScope?.relativePath,
		});
		if (result?.picked == null) return;

		this._localScope = { type: result.picked.type, relativePath: result.picked.relativePath };
	};

	private onHeaderClearScope = (): void => {
		if (this._localScope == null) return;

		this._localScope = undefined;
	};

	/** Folder-crumb click in the path. Standalone Visual History routes this to `actions.changeScope`;
	 *  in Graph mode the equivalent is just updating our local scope state. The `detached` flag (alt
	 *  / shift-click for "open in new editor") doesn't apply since there's no editor-popout from
	 *  Graph mode — ignored. */
	private onHeaderChangeScope = (
		e: CustomEvent<{ type: TimelineScopeType; value: string | undefined; detached: boolean }>,
	): void => {
		const { type, value } = e.detail;
		if (type === 'repo' || !value) {
			if (this._localScope != null) {
				this._localScope = undefined;
			}
			return;
		}

		const next = { type: type, relativePath: value };
		if (this._localScope?.type === next.type && this._localScope.relativePath === next.relativePath) return;

		this._localScope = next;
	};

	override render(): unknown {
		const repo = this.effectiveRepo;
		if (repo == null) {
			return html`<div class="empty"><p>No repository selected</p></div>`;
		}

		const dateFormat = this.graphState.config?.dateFormat ?? 'MMMM Do, YYYY h:mma';
		const headRef = this.graphState.branch?.ref ?? 'HEAD';
		const branch = this.graphState.branch;
		const repoWithRef: RepositoryShape & { ref: GitReference | undefined } = { ...repo, ref: branch };
		const localScopeType: TimelineScopeType = this._localScope?.type ?? 'repo';
		const localRelativePath = this._localScope?.relativePath ?? '';

		const emptySlot = html`<div slot="empty">
			<p>No commits found for the specified time period</p>
		</div>`;

		return html`
			<div class="header-row">
				<gl-graph-visualizations-switcher></gl-graph-visualizations-switcher>
				${this._localScope == null ? html`<span class="header-row__title">Visual History</span>` : nothing}
				<gl-timeline-header
					placement=${this.placement}
					host="graph"
					.repository=${repoWithRef}
					.repositoryCount=${this.graphState.repositories?.length ?? 0}
					.headRef=${this.graphState.branch}
					.scopeType=${localScopeType}
					.relativePath=${localRelativePath}
					.period=${this.period}
					.visibleSpanMs=${this._visibleSpanMs}
					.sliceBy=${this.effectiveSliceBy}
					.showAllBranches=${this.showAllBranchesEffective}
					.showAllBranchesSupported=${false}
					.sliceBySupported=${this.sliceBySupportedEffective}
					@gl-timeline-header-period-change=${this.onHeaderPeriodChange}
					@gl-timeline-header-slice-by-change=${this.onHeaderSliceByChange}
					@gl-timeline-header-choose-path=${this.onHeaderChoosePath}
					@gl-timeline-header-clear-scope=${this.onHeaderClearScope}
					@gl-timeline-header-change-scope=${this.onHeaderChangeScope}
				>
					${this.placement === 'view'
						? html`<gl-button
								slot="toolbox"
								appearance="toolbar"
								href="command:gitlens.views.graph.openTimelineInTab"
								tooltip="Open in Editor"
								aria-label="Open in Editor"
							>
								<code-icon icon="link-external"></code-icon>
							</gl-button>`
						: nothing}
					<gl-button
						slot="toolbox"
						appearance="toolbar"
						tooltip="Close Visualizations"
						aria-label="Close Visualizations"
						@click=${this.onCloseClick}
					>
						<code-icon icon="close"></code-icon>
					</gl-button>
				</gl-timeline-header>
			</div>
			<gl-timeline-chart
				placement="${this.placement}"
				currentUserNameStyle="nameAndYou"
				dateFormat="${dateFormat}"
				.dataPromise=${this._windowedDataPromise}
				?loading=${this.graphIsInitialLoading}
				?loadingMore=${this.graphIsLoadingMore}
				?hasMore=${this.graphState.paging?.hasMore !== false}
				head="${headRef}"
				.scope=${this._resolvedScope}
				shortDateFormat="short"
				sliceBy="${this.effectiveSliceBy}"
				.windowSpanMs=${this.windowSpanMs}
				@gl-commit-select=${this.onChartCommitSelected}
				@gl-load-more=${this.onChartLoadMoreFromGraph}
				@gl-visible-range-changed=${this.onChartVisibleRangeChanged}
				@gl-loading=${(e: CustomEvent<Promise<void>>) => {
					void e.detail;
				}}
			>
				${emptySlot}
			</gl-timeline-chart>
		`;
	}
}
