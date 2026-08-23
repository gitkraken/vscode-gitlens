import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewParams,
	GetOverviewWipResponse,
	GraphOverviewData,
	OverviewRecentThreshold,
} from '../../../../plus/graph/protocol.js';
import { isConnectionClosedError, notifyService } from '../../../shared/actions/rpc.js';
import { indexAgentSessionsByRepoAndWorktree, matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import { linkBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { RovingTabindexController } from '../../../shared/controllers/roving-tabindex.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { AppState } from '../context.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import './graph-overview-card.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/menu/menu-popover.js';

/** Labels for the Overview "Recent" timeframe filter, in display order. */
const recentThresholdLabels: Record<OverviewRecentThreshold, string> = {
	OneDay: '1 day',
	OneWeek: '1 week',
	OneMonth: '1 month',
};

/** Page size for the Overview panel's "Load More" older-branches paging — how many additional older
 *  branches one click reveals. */
const olderBranchesPageSize = 25;

@customElement('gl-graph-overview')
export class GlGraphOverview extends SignalWatcher(LitElement) {
	static override styles = [
		// Inherits the shared graph-webview scrollbar convention (transparent thumb that fades
		// in via the .scrollable border-color trick on hover/focus). Replaces the bespoke
		// hover-to-show webkit-scrollbar rules that diverged from the rest of the graph.
		scrollableBase,
		linkBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				width: 100%;
				height: 100%;
				overflow: hidden;
				font-size: var(--gl-font-md);
				color: var(--vscode-foreground);
				background-color: var(--color-graph-background);
			}

			.content {
				flex: 1;
				min-height: 0;
				padding: var(--gl-space-4);
				overflow: hidden auto;
			}

			.group {
				margin-bottom: var(--gl-space-16);
			}

			.group + .group {
				padding-top: var(--gl-space-8);
				border-top: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border, transparent);
			}

			.group__label {
				padding-inline: var(--gl-space-4);
				margin-block: 0 var(--gl-space-4);
				font-size: var(--gl-font-sm);
				font-weight: normal;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
			}

			.group__header {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				justify-content: space-between;
			}

			.group__header .group__label {
				min-width: 0;
				margin-block: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.group__header .threshold-filter {
				flex: none;
			}

			.group__count {
				opacity: 0.7;
			}

			.threshold-filter {
				display: inline-flex;
				gap: var(--gl-space-2);
				align-items: center;
				padding: 0 var(--gl-space-4);
				font-family: inherit;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
				white-space: nowrap;
				cursor: pointer;
				background: none;
				border: none;
			}

			.threshold-filter:hover {
				color: var(--vscode-foreground);
			}

			.threshold-filter:focus-visible {
				outline: var(--gl-border-width) solid var(--color-focus-border);
			}

			.threshold-filter code-icon {
				font-size: var(--gl-font-micro);
			}

			.show-more {
				display: block;
				width: 100%;
				padding: var(--gl-space-6) var(--gl-space-8);
				margin-top: var(--gl-space-2);
				font-family: inherit;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
				text-align: center;
				cursor: pointer;
				background: none;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.show-more:hover {
				color: var(--vscode-foreground);
				background: var(--vscode-list-hoverBackground);
			}

			.show-more:focus-visible {
				outline: var(--gl-border-width) solid var(--color-focus-border);
			}

			.section {
				margin-bottom: var(--gl-space-6);
			}

			.section-label {
				padding-inline: var(--gl-space-4);
				margin-block: 0 var(--gl-space-2);
				font-size: var(--gl-font-micro);
				font-weight: normal;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				opacity: 0.8;
			}

			.section-label__count {
				opacity: 0.7;
			}

			.cards {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
			}

			.empty {
				padding: var(--gl-space-6) var(--gl-space-8);
				font-size: var(--gl-font-sm);
				font-style: italic;
				color: var(--vscode-descriptionForeground);
			}

			.skeleton-cards {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				padding: var(--gl-space-2) 0 var(--gl-space-16);
			}

			.skeleton-card {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: var(--gl-space-8) var(--gl-space-6);
				background: color-mix(in lab, var(--color-graph-background, var(--color-background)) 100%, #fff 8%);
				border-radius: var(--gl-radius-sm);
			}

			:host-context(.vscode-light) .skeleton-card,
			:host-context(.vscode-high-contrast-light) .skeleton-card {
				background: color-mix(in lab, var(--color-graph-background, var(--color-background)) 100%, #000 6%);
			}

			.skeleton-card__icon {
				flex: none;
				width: 1.6rem;
				height: 1.6rem;
				background: var(--vscode-foreground);
				border-radius: var(--gl-radius-sm);
				opacity: 0.07;
			}

			.skeleton-card__lines {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				gap: var(--gl-space-4);
				min-width: 0;
			}

			.skeleton-card__line {
				height: 1rem;
				background: var(--vscode-foreground);
				border-radius: var(--gl-radius-sm);
				opacity: 0.07;
			}

			.skeleton-card__line--title {
				width: 55%;
			}

			.skeleton-card__line--subtitle {
				width: 35%;
			}

			.skeleton-card:nth-child(2) .skeleton-card__line--title {
				width: 40%;
			}

			.skeleton-card:nth-child(3) .skeleton-card__line--title {
				width: 65%;
			}

			.actions {
				display: flex;
				gap: var(--gl-space-8);
				margin-bottom: var(--gl-space-16);
			}

			.actions gl-button {
				flex: 1 1 0;
				min-width: 0;
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	private readonly _state!: AppState;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	@state()
	private _wipData: GetOverviewWipResponse = {};

	@state()
	private _enrichmentData: GetOverviewEnrichmentResponse = {};

	/**
	 * Map<repoPath, Set<branchName>> for branches whose history contains any selected/focused
	 * graph row. Recomputed on selection changes (debounced) by `getCommitReachability` against
	 * the host's existing per-(repoPath, sha) cache. Read by `renderCards` to derive each card's
	 * `containsSelection` flag.
	 */
	@state()
	private _selectionContainsByRepo: ReadonlyMap<string, ReadonlySet<string>> = new Map();

	private _lastOverview: GraphOverviewData | undefined;
	private _lastOverviewFingerprint: string | undefined;
	private _lastPushedWip: { branchIds: string[]; wip: GetOverviewWipResponse } | undefined;
	private _lastSelectionFingerprint: string | undefined;
	private _lastContainsRows: AppState['rows'];
	private readonly _recomputeSelectionDebounced: Deferrable<() => void> = debounce(
		() => this.recomputeSelectionContains(),
		100,
		{ edges: 'both' },
	);
	// Branch ids with an in-flight detailed-wip fetch — guards against duplicate requests when
	// the user re-hovers before the prior fetch resolves.
	private readonly _pendingWipDetails = new Set<string>();

	/** Whether `graph/overview/shown` has been fired this mount. Reset on disconnect so a remount
	 *  (e.g. switching away from the overview panel and back) emits a fresh shown event. */
	private _shownEmitted = false;

	/** Whether the initial `getOverview` call has been issued this mount (once the panel is
	 *  visible). Guards `updated()` from re-firing it every render while `overview` is still null. */
	private _overviewRequested = false;
	/** Last-seen sidebar visibility, for detecting the hidden→visible transition in `updated()`. */
	private _wasVisible = false;

	/** Count of in-flight `getOverview` calls, tracked as a counter rather than a boolean — the
	 *  mount fetch and a visibility-restore refetch (`connectedCallback`/`updated`) can overlap, and the
	 *  header's progress bar should stay lit until every one of them settles, not just the first. */
	private _overviewLoadingCount = 0;

	/** How many older-than-threshold branches are currently requested via "Load More" paging — sent as
	 *  `olderLimit` on every `getOverview` call. Reset to 0 on threshold change and on `refresh()`
	 *  (both start the Recent list over), and never restored from persisted state — paging is
	 *  session-local. */
	private _olderLimit = 0;

	// Each card list (Current work / Recent) is its own vertical roving toolbar: one Tab stop per
	// list, ArrowUp/Down (+ Home/End) rove between cards, keyed by branch id so the active stop
	// survives the overview's frequent re-renders (selection/wip/enrichment ticks). The
	// `<gl-graph-overview-card>` host is the focus target (it delegatesFocus to the inner gl-card).
	private readonly _rovingActive = new RovingTabindexController(this, {
		getItems: () => this.getCardItems('active'),
		orientation: 'vertical',
	});
	private readonly _rovingRecent = new RovingTabindexController(this, {
		getItems: () => this.getCardItems('recent'),
		orientation: 'vertical',
	});

	private getCardItems(group: 'active' | 'recent'): { key: string; element: HTMLElement }[] {
		const container = this.renderRoot.querySelector(`.cards[data-group="${group}"]`);
		if (container == null) return [];
		return [...container.querySelectorAll<HTMLElement>('[data-roving-key]')]
			.filter(el => el.offsetParent != null)
			.map(el => ({ key: el.dataset.rovingKey!, element: el }));
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.addEventListener('gl-graph-overview-card-request-wip-details', this.onWipDetailsRequested);

		// Defer host-side fetching until the sidebar is actually visible — the overview stays mounted
		// (just `inert`) while the sidebar is collapsed, so fetching on mount would do `git`-backed
		// work the user never sees. `updated()` fires the deferred fetch on the hidden→visible
		// transition (connectedCallback won't refire when the sidebar reopens).
		this._wasVisible = this._state.sidebar?.visible === true;
		if (this._wasVisible) {
			// Also gated on `services` — if RPC hasn't connected yet, leave `_overviewRequested`
			// unlatched so the `updated()` pass that fires when the services context arrives issues
			// the fetch instead of dropping it.
			if (this._state.overview == null) {
				if (this.services != null) {
					this._overviewRequested = true;
					// Apply the reply directly — a failed first load must land `error` in state, or the
					// skeleton renders forever (the host push only follows successful graph reloads).
					void this.requestOverview({
						recentThreshold: this._state.overviewRecentThreshold,
						olderLimit: this._olderLimit,
					}).then(overview => {
						this._state.overview = overview;
					});
				}
			} else {
				// Force a re-fetch on remount/visibility-restore — the bulk push path is gone, so any
				// drift accumulated while the overview panel was hidden (e.g. file edits in opened
				// worktrees whose graph WIP rows are off-screen) is caught here. Reset the fingerprint
				// dedup so `maybeRefetchOverviewData` actually fires. The host's `getWip` handler is
				// cache-backed (`_wipStatusCache`), so entries kept warm by per-event pushes
				// resolve without any extra `git status` — only genuinely stale entries cost a fetch.
				this._lastOverviewFingerprint = undefined;
				this.maybeRefetchOverviewData(this._state.overview);
			}
		}
	}

	override disconnectedCallback(): void {
		this.removeEventListener('gl-graph-overview-card-request-wip-details', this.onWipDetailsRequested);
		this._recomputeSelectionDebounced.cancel();
		this._shownEmitted = false;
		this._overviewRequested = false;
		this._wasVisible = false;
		super.disconnectedCallback?.();
	}

	refresh(): void {
		this._lastOverview = undefined;
		this._lastOverviewFingerprint = undefined;
		this._lastPushedWip = undefined;
		this._wipData = {};
		this._enrichmentData = {};
		this._pendingWipDetails.clear();
		this._olderLimit = 0;
		this._state.resetOverviewEnrichment();
		void this.requestOverview({
			recentThreshold: this._state.overviewRecentThreshold,
			olderLimit: this._olderLimit,
		}).then(overview => {
			this._state.overview = overview;
		});
	}

	/** Adjusts the in-flight `getOverview` counter and, on a 0↔1 crossing, bubbles the loading
	 *  edge up to the sidebar panel so it can mirror it into the header's `progress-indicator` — this
	 *  panel fetches its own data outside the sidebar's resource fetch loop, so nothing else surfaces
	 *  the in-flight state for it. */
	private adjustOverviewLoading(delta: 1 | -1): void {
		const wasLoading = this._overviewLoadingCount > 0;
		this._overviewLoadingCount = Math.max(0, this._overviewLoadingCount + delta);
		const isLoading = this._overviewLoadingCount > 0;
		if (wasLoading === isLoading) return;

		this.dispatchEvent(
			new CustomEvent<{ loading: boolean }>('gl-graph-overview-loading-change', {
				detail: { loading: isLoading },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Every caller gates on `this.services` (mount/visibility fetches skip until RPC connects;
	 *  the rest are user-triggered post-render), so the non-null assertion here is safe. */
	private async requestOverview(params: GetOverviewParams): Promise<GraphOverviewData> {
		this.adjustOverviewLoading(1);
		try {
			const overviewService = await this.services!.overview;
			return await overviewService.getOverview(params);
		} finally {
			this.adjustOverviewLoading(-1);
		}
	}

	private readonly onWipDetailsRequested = (e: Event) => {
		const branchId = (e as CustomEvent<{ branchId: string }>).detail?.branchId;
		if (!branchId) return;
		if (this._pendingWipDetails.has(branchId)) return;

		void this.fetchWipDetailsForBranch(branchId);
	};

	private async fetchWipDetailsForBranch(branchId: string): Promise<void> {
		this._pendingWipDetails.add(branchId);
		try {
			const services = this.services;
			if (services == null) return;

			const overviewService = await services.overview;
			const result = await overviewService.getWipDetailed([branchId]);
			const detailed = result?.[branchId];
			if (detailed == null) return;

			// Drop the result if the branch is no longer in the overview (e.g. checked out away
			// while the fetch was in flight).
			const overview = this._state.overview;
			const stillPresent =
				overview != null &&
				(overview.active.some(b => b.id === branchId) ||
					overview.recent.some(b => b.id === branchId) ||
					(overview.older ?? []).some(b => b.id === branchId));
			if (!stillPresent) return;

			// Merge into the existing entry (preserving any fields the basic load set, e.g.
			// `pausedOpStatus`) rather than replacing wholesale.
			this._wipData = {
				...this._wipData,
				[branchId]: { ...this._wipData[branchId], ...detailed },
			};
		} catch {
			// Swallow — the rich hover falls back to the basic dirty indicator if detailed never
			// arrives, and the next popover-show will retry once the request slot clears.
		} finally {
			this._pendingWipDetails.delete(branchId);
		}
	}

	override updated(_changedProperties: Map<string, unknown>): void {
		const overview = this._state.overview;
		const visible = this._state.sidebar?.visible === true;
		const becameVisible = visible && !this._wasVisible;
		this._wasVisible = visible;

		// Gate host-side fetching on visibility — the overview stays mounted (just `inert`) while the
		// sidebar is collapsed, so no `git`-backed work should run until it's actually shown.
		if (visible) {
			if (overview == null) {
				// Deferred initial fetch: the panel became visible before any data arrived. Fire once
				// (guarded) so repeated `updated()` passes don't spam the request while `overview` is null.
				if (!this._overviewRequested && this.services != null) {
					this._overviewRequested = true;
					// Apply directly for the same reason as `connectedCallback` — a failed load must
					// surface `error` rather than leaving the skeleton up.
					void this.requestOverview({
						recentThreshold: this._state.overviewRecentThreshold,
						olderLimit: this._olderLimit,
					}).then(overview => {
						this._state.overview = overview;
					});
				}
			} else {
				// On the hidden→visible transition, reset the fingerprint dedup to force a re-fetch that
				// catches drift accumulated while hidden (mirrors the remount path in connectedCallback).
				if (becameVisible) {
					this._lastOverviewFingerprint = undefined;
				}
				this.maybeRefetchOverviewData(overview);
			}
		}

		const pushedWip = this._state.overviewWip;
		if (pushedWip != null && pushedWip !== this._lastPushedWip) {
			this._lastPushedWip = pushedWip;
			const nextWipData = { ...this._wipData };
			for (const branchId of pushedWip.branchIds) {
				const wip = pushedWip.wip[branchId];
				if (wip != null) {
					nextWipData[branchId] = { ...nextWipData[branchId], ...wip };
				} else {
					nextWipData[branchId] = { hasChanges: false };
				}
			}
			this._wipData = nextWipData;
		}

		// Fire the shown event once overview data is available AND the sidebar is visible so the
		// walkthrough step only completes when the user actually sees the overview.
		// Also gated on `services` so a render before RPC connects doesn't latch the guard and drop
		// the walkthrough-step completion for the whole mount.
		if (!this._shownEmitted && overview != null && this._state.sidebar?.visible && this.services != null) {
			this._shownEmitted = true;
			notifyService(this.services.telemetry, 'track usage', svc =>
				svc.trackUsage('action:gitlens.graph.overview.shown:happened'),
			);
			emitTelemetrySentEvent<'graph/overview/shown'>(this, {
				name: 'graph/overview/shown',
				data: {
					'branches.active.count': overview.active.length,
					'branches.recent.count': overview.recent.length,
					recentThreshold: this._state.overviewRecentThreshold ?? 'OneWeek',
				},
			});
		}

		this.maybeRecomputeSelectionContains();
	}

	private maybeRecomputeSelectionContains(): void {
		// Only compute the contains-selection map when the overview PANEL is actually visible — the
		// sidebar must be open AND `overview` must be its active panel. `sidebar-panel` renders nothing
		// for `activePanel == null` and only mounts `gl-graph-overview` for `=== 'overview'`, so that's
		// the exact condition. No point resolving reachability for a hidden or non-overview sidebar.
		// Showing it re-renders (render subscribes to `sidebar`), which re-runs this against the selection.
		const sidebar = this._state.sidebar;
		if (sidebar?.visible !== true || sidebar.activePanel !== 'overview') {
			this._recomputeSelectionDebounced.cancel();
			return;
		}

		// Fingerprint of selection inputs + the repoPath set of currently rendered cards. If any
		// of these change, the contains-selection map needs to recompute. Combining all three into
		// one fingerprint avoids three independent change detectors.
		const overview = this._state.overview;
		const selectedShas = this._state.selectedRows != null ? Object.keys(this._state.selectedRows).sort() : [];
		const activeRow = this._state.activeRow;
		const repoPaths =
			overview != null
				? [
						...new Set([
							...overview.active.map(b => b.repoPath),
							...overview.recent.map(b => b.repoPath),
							...(overview.older ?? []).map(b => b.repoPath),
						]),
					].sort()
				: [];

		// Also recompute when `rows` changes (a deep target / reachability delta paging in) even if the
		// selection fingerprint is unchanged — contains-selection is resolved from the loaded rows.
		const rows = this._state.rows;
		const fingerprint = `${activeRow ?? ''}|${selectedShas.join(',')}|${repoPaths.join(',')}`;
		if (fingerprint === this._lastSelectionFingerprint && rows === this._lastContainsRows) return;

		this._lastSelectionFingerprint = fingerprint;
		this._lastContainsRows = rows;

		// Empty selection — clear immediately, no need to debounce or fetch.
		if (selectedShas.length === 0 && (activeRow == null || activeRow === '')) {
			this._recomputeSelectionDebounced.cancel();
			if (this._selectionContainsByRepo.size > 0) {
				this._selectionContainsByRepo = new Map();
			}
			return;
		}

		this._recomputeSelectionDebounced();
	}

	private recomputeSelectionContains(): void {
		const overview = this._state.overview;
		if (overview == null) return;

		// `activeRow` is encoded as `${sha}|${date}` by the wrapper — strip the date suffix.
		const activeRowSha = this._state.activeRow?.split('|', 1)[0];
		const selectedShas = new Set<string>(
			this._state.selectedRows != null ? Object.keys(this._state.selectedRows) : [],
		);
		if (activeRowSha) {
			selectedShas.add(activeRowSha);
		}
		if (selectedShas.size === 0) {
			if (this._selectionContainsByRepo.size > 0) {
				this._selectionContainsByRepo = new Map();
			}
			return;
		}

		// Resolve "which branches contain the selection" from the ALREADY-LOADED graph rows'
		// reachability (`getRowReachability`) rather than a per-sha RPC fan-out — the selected rows live
		// in the opened repo, so their reachable refs are already in hand. (Row reachability is
		// `partial`: it reflects the graph walk, which covers the branches shown here; a branch outside
		// the loaded window won't be listed — accepted, since the RPC was the only thing that caught those.)
		const rows = this._state.rows;
		const repoPath = this._state.selectedRepository;
		const next = new Map<string, Set<string>>();
		if (rows != null && repoPath != null) {
			let bucket: Set<string> | undefined;
			let remaining = selectedShas.size;
			for (const row of rows) {
				if (!selectedShas.has(row.sha)) continue;

				// Stop scanning once every selected row has been located — keeps this off the O(rows)
				// hot path on large graphs (the typical selection is 1-2 rows near the top).
				remaining--;

				const reachability = this._state.getRowReachability(row);
				if (reachability != null) {
					for (const ref of reachability.refs) {
						if (ref.refType === 'branch' && !ref.remote) {
							(bucket ??= new Set<string>()).add(ref.name);
						}
					}
				}

				if (remaining === 0) break;
			}
			if (bucket != null) {
				next.set(repoPath, bucket);
			}
		}
		this._selectionContainsByRepo = next;
	}

	private maybeRefetchOverviewData(overview: GraphOverviewData): void {
		if (overview === this._lastOverview) return;

		const fingerprint = this.getOverviewFingerprint(overview);
		if (fingerprint !== this._lastOverviewFingerprint) {
			this._lastOverviewFingerprint = fingerprint;
			void this.fetchOverviewData(overview, fingerprint).catch((ex: unknown) => {
				if (isConnectionClosedError(ex)) {
					Logger.debug('GraphOverview: overview data fetch dropped by deliberate connection teardown');
					return;
				}

				Logger.error(ex, 'GraphOverview: Failed to fetch overview data');
			});
		}
		this._lastOverview = overview;
	}

	private getOverviewFingerprint(overview: GraphOverviewData): string {
		const ids = [
			...overview.active.map(b => b.id),
			...overview.recent.map(b => b.id),
			...(overview.older ?? []).map(b => b.id),
		];
		return ids.sort().join(',');
	}

	private async fetchOverviewData(overview: GraphOverviewData, fingerprint: string) {
		const older = overview.older ?? [];
		const allBranches = [...overview.active, ...overview.recent, ...older];
		if (allBranches.length === 0) return;

		const services = this.services;
		if (services == null) return;

		const overviewService = await services.overview;

		const allIds = allBranches.map(b => b.id);
		const wipIds = overview.active.map(b => b.id);
		// Recent (and paged-in older) worktree-backed branches get a cheap clean/dirty probe so their
		// cards can show the same pill as Current Work. Branches without a worktree have no working
		// tree of their own and are skipped — the empty default `{ hasChanges: false }` would lie there.
		const recentWipIds = [...overview.recent, ...older].filter(b => b.worktree != null).map(b => b.id);
		const keep = new Set(allIds);

		// Enrichment is fetched lazily — by this panel on mount, or by the scope popover on open.
		// Whichever happens first publishes to `overviewEnrichment` shared state; reuse it here
		// when it covers our branch set, otherwise fetch.
		const sharedEnrichment = this._state.overviewEnrichment;
		const sharedCoversAll = sharedEnrichment != null && allIds.every(id => id in sharedEnrichment);

		// allSettled so a single transient IPC failure doesn't tank the other two — wip-only,
		// cheap-only, or enrichment-only outages still update the rest of the overview.
		const [wipSettled, recentWipSettled, enrichmentSettled] = await Promise.allSettled([
			wipIds.length > 0 ? overviewService.getWip(wipIds) : Promise.resolve(undefined),
			recentWipIds.length > 0 ? overviewService.getWip(recentWipIds, true) : Promise.resolve(undefined),
			sharedCoversAll ? Promise.resolve(sharedEnrichment) : overviewService.getEnrichment(allIds),
		]);
		if (this._lastOverviewFingerprint !== fingerprint) return;

		const wipResult = getSettledValue(wipSettled);
		const recentWipResult = getSettledValue(recentWipSettled);
		const enrichmentResult = getSettledValue(enrichmentSettled);

		// Prune entries for branches no longer in the overview so stale data doesn't linger.
		const nextWipData = wipResult ? filterToKeys(wipResult, keep) : {};
		if (recentWipResult) {
			// `??=` so a cheap entry never silently downgrades a full entry. active/recent are
			// disjoint by contract today (getBranchOverviewType), but the merge guard here keeps
			// the active card's inline breakdown safe if that contract ever flexes.
			const cheap = filterToKeys(recentWipResult, keep);
			for (const id of Object.keys(cheap)) {
				nextWipData[id] ??= cheap[id];
			}
		}
		// Only the FULL probe gets the default-clean fallback. The cheap probe explicitly writes
		// `{ hasChanges: false }` on success, so an absent id there means the call rejected and we
		// don't know the state — leaving the entry undefined makes the card render no pill rather
		// than misleadingly green-checking a worktree we couldn't probe.
		if (wipResult) {
			for (const id of wipIds) {
				nextWipData[id] ??= { hasChanges: false };
			}
		}
		this._wipData = nextWipData;
		if (enrichmentResult != null) {
			this._enrichmentData = filterToKeys(enrichmentResult, keep);
			// Expose enrichment via shared state so other consumers (e.g. the scope popover path
			// in graph-app) can resolve merge-target refs for the selected branch. Published through
			// the state provider rather than assigned directly so entries fetched additively for
			// branches outside the overview (WIP-bar pills) survive this rebuild.
			this._state.publishOverviewEnrichment(this._enrichmentData);
		}
	}

	override render() {
		const overview = this._state.overview;
		// Touch the selection signals during render so SignalWatcher subscribes to them — without
		// these reads, selection-only state updates don't re-render this component, `updated()`
		// never re-fires, and `maybeRecomputeSelectionContains` never sees the new selection. Also
		// touch `sidebar` (visible + active panel) so showing/switching to the overview re-renders →
		// recomputes the (panel-visibility-gated) contains-selection map.
		void this._state.activeRow;
		void this._state.selectedRows;
		void this._state.sidebar?.visible;
		void this._state.sidebar?.activePanel;
		// Also touch `rows`: contains-selection is now resolved from loaded rows' reachability, so a deep
		// target (or its reachability delta) paging in later must re-render → recompute, or the cards stay
		// stale at the partial/empty reachability captured before the page arrived.
		void this._state.rows;
		if (overview == null) {
			return html` <div class="content scrollable">${this.renderSkeleton()}</div> `;
		}

		if (overview.error != null) {
			return html`
				<div class="content scrollable">
					${this.renderStartActions()}
					<div class="empty">
						Unable to load branch data.
						<a href="#" @click=${this.onRetryClick}>Retry</a>
					</div>
				</div>
			`;
		}

		const hasActive = overview.active.length > 0;
		const olderCount = overview.older?.length ?? 0;
		// True once older branches have been paged in even if the within-threshold `recent` bucket is
		// empty — otherwise the Recent group (and the older cards it now holds) would never render.
		const hasRecent = overview.recent.length > 0 || olderCount > 0;

		return html`
			<div class="content scrollable">
				${when(
					hasActive,
					() => html`
						<div class="group">
							<div class="group__label">Current work</div>
							${this.renderCards(overview.active, 'active')}
						</div>
					`,
				)}
				${this.renderStartActions()}
				${when(
					hasRecent,
					() => html`
						<div class="group">
							<div class="group__header">
								<div class="group__label">
									Recent <span class="group__count">(${overview.recent.length + olderCount})</span>
								</div>
								${this.renderRecentThresholdFilter()}
							</div>
							${this.renderCards([...overview.recent, ...(overview.older ?? [])], 'recent')}
							${when(
								(overview.olderTotal ?? 0) > olderCount,
								() => html`
									<button class="show-more" type="button" @click=${this.onShowMoreOlderClick}>
										Load More
									</button>
								`,
							)}
						</div>
					`,
				)}
				${when(!hasActive && !hasRecent, () => this.renderEmptyOverview(overview))}
			</div>
		`;
	}

	private renderEmptyOverview(overview: GraphOverviewData) {
		return html`
			<div class="empty">No recent branch activity</div>
			${when(
				(overview.olderTotal ?? 0) > 0,
				() =>
					html`<div class="empty">
						<a href="#" @click=${this.onShowMoreOlderClick}>Show older branches</a>
					</div>`,
			)}
		`;
	}

	private readonly onRetryClick = (e: Event): void => {
		e.preventDefault();
		void this.requestOverview({
			recentThreshold: this._state.overviewRecentThreshold,
			olderLimit: this._olderLimit,
		}).then(overview => {
			this._state.overview = overview;
		});
	};

	private readonly onShowMoreOlderClick = (e: Event): void => {
		e.preventDefault();
		this._olderLimit += olderBranchesPageSize;
		void this.requestOverview({
			recentThreshold: this._state.overviewRecentThreshold,
			olderLimit: this._olderLimit,
		}).then(overview => {
			this._state.overview = overview;
		});
	};

	/** 3 card-shaped shimmer placeholders, matching the sidebar's `renderSkeleton()` pattern (static
	 *  low-opacity blocks, no tree rows) but sized like `<gl-graph-overview-card>` rather than a tree
	 *  row — the overview renders cards, not a list. */
	private renderSkeleton() {
		return html`
			<div class="skeleton-cards" aria-hidden="true">
				${Array.from(
					{ length: 3 },
					() => html`
						<div class="skeleton-card">
							<div class="skeleton-card__icon"></div>
							<div class="skeleton-card__lines">
								<div class="skeleton-card__line skeleton-card__line--title"></div>
								<div class="skeleton-card__line skeleton-card__line--subtitle"></div>
							</div>
						</div>
					`,
				)}
			</div>
		`;
	}

	/** Start Work button between the Current work and Recent groups. `showOpenInAgent` makes the
	 *  wizard end with its manual-vs-agent hand-off step, so this one entry point covers both routes
	 *  — no separate Start Agent affordance. Sourced so it reads apart from the agents panel header's
	 *  action in telemetry. */
	private renderStartActions() {
		return html`
			<div class="actions">
				<gl-button
					full
					appearance="secondary"
					density="tight"
					href=${createCommandLink('gitlens.startWork', {
						source: { source: 'graph-sidebar' as const, detail: 'overview' },
						showOpenInAgent: 'agent',
					})}
				>
					Start Work...
				</gl-button>
			</div>
		`;
	}

	private renderRecentThresholdFilter() {
		const threshold = this._state.overviewRecentThreshold ?? 'OneWeek';
		const items = (Object.entries(recentThresholdLabels) as [OverviewRecentThreshold, string][]).map(
			([value, label]) => ({ value: value, label: label, selected: threshold === value }),
		);
		return html`
			<gl-menu-popover placement="bottom-end" .items=${items} @gl-menu-select=${this.onRecentThresholdSelect}>
				<button slot="anchor" class="threshold-filter" type="button" aria-label="Change Recent Timeframe">
					${recentThresholdLabels[threshold]}<code-icon icon="chevron-down"></code-icon>
				</button>
			</gl-menu-popover>
		`;
	}

	private readonly onRecentThresholdSelect = (e: CustomEvent<{ value: string }>): void => {
		this.onRecentThresholdSelected(e.detail.value as OverviewRecentThreshold);
	};

	private onRecentThresholdSelected(threshold: OverviewRecentThreshold): void {
		if ((this._state.overviewRecentThreshold ?? 'OneWeek') === threshold) return;

		emitTelemetrySentEvent<'graph/overview/recentThresholdChanged'>(this, {
			name: 'graph/overview/recentThresholdChanged',
			data: { threshold: threshold },
		});

		// Let graph-app own the persisted signal + memento write (mirrors the timeline period
		// flow); send the request here since this panel owns the overview fetch lifecycle.
		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-recent-threshold-change', {
				detail: { threshold: threshold },
				bubbles: true,
				composed: true,
			}),
		);
		// A new threshold restarts the Recent list — any older branches paged in under the old
		// threshold no longer apply.
		this._olderLimit = 0;
		// Apply the re-partitioned response — unlike the host-pushed `onOverviewChanged` RPC event
		// (graph load, branch changes), a `getOverview` reply isn't routed into state for us, so a
		// threshold change would otherwise never re-render the Recent list.
		void this.requestOverview({ recentThreshold: threshold, olderLimit: this._olderLimit }).then(overview => {
			this._state.overview = overview;
		});
	}

	private renderCards(branches: GraphOverviewData['active'], group: 'active' | 'recent') {
		if (!branches.length) return nothing;

		const sessionsByRepoAndWorktree = indexAgentSessionsByRepoAndWorktree(this._state.agentSessions);
		const containsByRepo = this._selectionContainsByRepo;
		const scopedBranchId = this._state.scope?.branchRef;
		const roving = group === 'active' ? this._rovingActive : this._rovingRecent;

		return html`
			<div
				class="cards"
				data-group=${group}
				role="toolbar"
				aria-orientation="vertical"
				aria-label=${group === 'active' ? 'Current work branches' : 'Recent branches'}
				@keydown=${roving.onKeydown}
				@focusin=${roving.onFocusin}
			>
				${repeat(
					branches,
					b => b.id,
					b => {
						// Graph strips the default worktree from `worktreesByBranch`, so an
						// `opened` (active) branch with no `worktree` is the default-worktree's
						// HEAD — match it via `repoPath`. A non-`opened` (recent) branch with no
						// `worktree` isn't checked out anywhere, so no agent can run on it (skip
						// the match so the matcher's `worktreePath ?? repoPath` fallback doesn't
						// false-match it to the default-worktree session).
						const matchWorktreePath = b.worktree?.path ?? (b.opened ? b.repoPath : undefined);
						// Ended sessions are history — the card surfaces live presence only,
						// matching the hover's filter (`gl-branch-hover`).
						const agentSessions =
							matchWorktreePath != null
								? matchAgentSessionsForWorktree(sessionsByRepoAndWorktree, {
										repoPath: b.repoPath,
										worktreePath: matchWorktreePath,
									})?.filter(s => s.phase !== 'ended')
								: undefined;
						return html`
							<gl-graph-overview-card
								data-roving-key=${b.id}
								.branch=${b}
								.wip=${this._wipData[b.id]}
								.enrichment=${this._state.overviewEnrichment?.[b.id]}
								.agentSessions=${agentSessions}
								.containsSelection=${containsByRepo.get(b.repoPath)?.has(b.name) ?? false}
								.scoped=${scopedBranchId != null && b.id === scopedBranchId}
							></gl-graph-overview-card>
						`;
					},
				)}
			</div>
		`;
	}
}

function filterToKeys<T>(record: Record<string, T>, keep: Set<string>): Record<string, T> {
	const result: Record<string, T> = {};
	for (const [id, value] of Object.entries(record)) {
		if (keep.has(id)) {
			result[id] = value;
		}
	}
	return result;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-overview': GlGraphOverview;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-overview-recent-threshold-change': CustomEvent<{ threshold: OverviewRecentThreshold }>;
		'gl-graph-overview-loading-change': CustomEvent<{ loading: boolean }>;
	}
}
