import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	GraphOverviewData,
	OverviewRecentThreshold,
} from '../../../../plus/graph/protocol.js';
import {
	GetOverviewEnrichmentRequest,
	GetOverviewRequest,
	GetOverviewWipDetailedRequest,
	GetOverviewWipRequest,
} from '../../../../plus/graph/protocol.js';
import { indexAgentSessionsByRepoAndWorktree, matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { HostIpc } from '../../../shared/ipc.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { AppState } from '../context.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import './graph-overview-card.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/menu/menu-popover.js';

/** Labels for the Overview "Recent" timeframe filter, in display order. */
const recentThresholdLabels: Record<OverviewRecentThreshold, string> = {
	OneDay: '1 day',
	OneWeek: '1 week',
	OneMonth: '1 month',
};

@customElement('gl-graph-overview')
export class GlGraphOverview extends SignalWatcher(LitElement) {
	static override styles = [
		// Inherits the shared graph-webview scrollbar convention (transparent thumb that fades
		// in via the .scrollable border-color trick on hover/focus). Replaces the bespoke
		// hover-to-show webkit-scrollbar rules that diverged from the rest of the graph.
		scrollableBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				width: 100%;
				height: 100%;
				overflow: hidden;
				background-color: var(--color-graph-background);
				color: var(--vscode-foreground);
				font-size: 1.2rem;
			}

			.content {
				flex: 1;
				overflow-y: auto;
				overflow-x: hidden;
				padding: 0.4rem;
				min-height: 0;
			}

			.group {
				margin-bottom: 1.6rem;
			}

			.group + .group {
				padding-top: 0.8rem;
				border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
			}

			.group__label {
				font-size: 1.1rem;
				font-weight: normal;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
				padding-inline: 0.4rem;
				margin-block: 0 0.4rem;
			}

			.group__header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.4rem;
			}

			.group__header .group__label {
				margin-block: 0;
			}

			.group__count {
				opacity: 0.7;
			}

			.threshold-filter {
				display: inline-flex;
				align-items: center;
				gap: 0.2rem;
				background: none;
				border: none;
				padding: 0 0.4rem;
				font-family: inherit;
				font-size: 1.1rem;
				color: var(--color-foreground--50);
				cursor: pointer;
				white-space: nowrap;
			}

			.threshold-filter:hover {
				color: var(--vscode-foreground);
			}

			.threshold-filter:focus-visible {
				outline: 1px solid var(--color-focus-border);
			}

			.threshold-filter code-icon {
				font-size: 1rem;
			}

			.section {
				margin-bottom: 0.6rem;
			}

			.section-label {
				font-size: 1rem;
				font-weight: normal;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
				padding-inline: 0.4rem;
				margin-block: 0 0.2rem;
				opacity: 0.8;
			}

			.section-label__count {
				opacity: 0.7;
			}

			.cards {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
			}

			.empty {
				padding: 0.6rem 0.8rem;
				font-size: 1.1rem;
				color: var(--vscode-descriptionForeground);
				font-style: italic;
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	private readonly _state!: AppState;

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;

	@consume({ context: graphServicesContext, subscribe: true })
	private _services?: typeof graphServicesContext.__context__;

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
	private _lastPushedWip: GetOverviewWipResponse | undefined;
	private _lastSelectionFingerprint: string | undefined;
	private _selectionRecomputeToken = 0;
	private readonly _recomputeSelectionDebounced: Deferrable<() => void> = debounce(
		() => void this.recomputeSelectionContains(),
		100,
		{ edges: 'both' },
	);
	// Branch ids with an in-flight detailed-wip fetch — guards against duplicate requests when
	// the user re-hovers before the prior fetch resolves.
	private readonly _pendingWipDetails = new Set<string>();

	/** Whether `graph/overview/shown` has been fired this mount. Reset on disconnect so a remount
	 *  (e.g. switching away from the overview panel and back) emits a fresh shown event. */
	private _shownEmitted = false;

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.addEventListener('gl-graph-overview-card-request-wip-details', this.onWipDetailsRequested);

		if (this._state.overview == null) {
			void this._ipc.sendRequest(GetOverviewRequest, {
				recentThreshold: this._state.overviewRecentThreshold,
			});
		} else {
			this.maybeRefetchOverviewData(this._state.overview);
		}
	}

	override disconnectedCallback(): void {
		this.removeEventListener('gl-graph-overview-card-request-wip-details', this.onWipDetailsRequested);
		this._recomputeSelectionDebounced.cancel();
		this._shownEmitted = false;
		super.disconnectedCallback?.();
	}

	refresh(): void {
		this._lastOverview = undefined;
		this._lastOverviewFingerprint = undefined;
		this._lastPushedWip = undefined;
		this._wipData = {};
		this._enrichmentData = {};
		this._pendingWipDetails.clear();
		this._state.overviewEnrichment = undefined;
		void this._ipc.sendRequest(GetOverviewRequest, { recentThreshold: this._state.overviewRecentThreshold });
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
			const result = await this._ipc.sendRequest(GetOverviewWipDetailedRequest, { branchIds: [branchId] });
			const detailed = result?.[branchId];
			if (detailed == null) return;

			// Drop the result if the branch is no longer in the overview (e.g. checked out away
			// while the fetch was in flight).
			const overview = this._state.overview;
			const stillPresent =
				overview != null &&
				(overview.active.some(b => b.id === branchId) || overview.recent.some(b => b.id === branchId));
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
		if (overview != null) {
			this.maybeRefetchOverviewData(overview);
		}

		const pushedWip = this._state.overviewWip;
		if (pushedWip != null && pushedWip !== this._lastPushedWip) {
			this._lastPushedWip = pushedWip;
			this._wipData = { ...this._wipData, ...pushedWip };
		}

		// Fire the shown event once overview data is available so the branch counts are accurate.
		// Mount-time emit would always report 0/0 since the initial GetOverviewRequest is still in flight.
		if (!this._shownEmitted && overview != null) {
			this._shownEmitted = true;
			emitTelemetrySentEvent<'graph/overview/shown'>(this, {
				name: 'graph/overview/shown',
				data: {
					'branches.active.count': overview.active.length,
					'branches.recent.count': overview.recent.length,
				},
			});
		}

		this.maybeRecomputeSelectionContains();
	}

	private maybeRecomputeSelectionContains(): void {
		// Fingerprint of selection inputs + the repoPath set of currently rendered cards. If any
		// of these change, the contains-selection map needs to recompute. Combining all three into
		// one fingerprint avoids three independent change detectors.
		const overview = this._state.overview;
		const selectedShas = this._state.selectedRows != null ? Object.keys(this._state.selectedRows).sort() : [];
		const activeRow = this._state.activeRow;
		const repoPaths =
			overview != null
				? [
						...new Set([...overview.active.map(b => b.repoPath), ...overview.recent.map(b => b.repoPath)]),
					].sort()
				: [];

		// Include services-readiness so a fingerprint recorded while services were null doesn't
		// short-circuit the retry once they arrive (the consumer re-renders via subscribe: true).
		const servicesReady = this._services != null ? '1' : '0';
		const fingerprint = `${servicesReady}|${activeRow ?? ''}|${selectedShas.join(',')}|${repoPaths.join(',')}`;
		if (fingerprint === this._lastSelectionFingerprint) return;

		this._lastSelectionFingerprint = fingerprint;

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

	private async recomputeSelectionContains(): Promise<void> {
		const services = this._services;
		if (services == null) return;

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

		const repoPaths = new Set<string>([
			...overview.active.map(b => b.repoPath),
			...overview.recent.map(b => b.repoPath),
		]);
		if (repoPaths.size === 0) return;

		// "Latest wins" — discard results if a newer recompute has been kicked off while we were
		// awaiting RPCs. Cheaper than AbortController plumbing for a small fan-out.
		const token = ++this._selectionRecomputeToken;

		const repository = await services.repository;
		if (token !== this._selectionRecomputeToken) return;

		const fetches: Array<Promise<{ repoPath: string; names: string[] }>> = [];
		for (const repoPath of repoPaths) {
			for (const sha of selectedShas) {
				fetches.push(
					repository.getCommitReachability(repoPath, sha).then(
						r => ({
							repoPath: repoPath,
							names:
								r?.refs.filter(ref => ref.refType === 'branch' && !ref.remote).map(ref => ref.name) ??
								[],
						}),
						() => ({ repoPath: repoPath, names: [] }),
					),
				);
			}
		}

		const results = await Promise.all(fetches);
		if (token !== this._selectionRecomputeToken) return;

		const next = new Map<string, Set<string>>();
		for (const { repoPath, names } of results) {
			if (names.length === 0) continue;

			let bucket = next.get(repoPath);
			if (bucket == null) {
				bucket = new Set();
				next.set(repoPath, bucket);
			}
			for (const name of names) {
				bucket.add(name);
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
				Logger.error(ex, 'GraphOverview: Failed to fetch overview data');
			});
		}
		this._lastOverview = overview;
	}

	private getOverviewFingerprint(overview: GraphOverviewData): string {
		const ids = [...overview.active.map(b => b.id), ...overview.recent.map(b => b.id)];
		return ids.sort().join(',');
	}

	private async fetchOverviewData(overview: GraphOverviewData, fingerprint: string) {
		const allBranches = [...overview.active, ...overview.recent];
		if (allBranches.length === 0) return;

		const allIds = allBranches.map(b => b.id);
		const wipIds = overview.active.map(b => b.id);
		const keep = new Set(allIds);

		// Enrichment is fetched lazily — by this panel on mount, or by the scope popover on open.
		// Whichever happens first publishes to `overviewEnrichment` shared state; reuse it here
		// when it covers our branch set, otherwise fetch.
		const sharedEnrichment = this._state.overviewEnrichment;
		const sharedCoversAll = sharedEnrichment != null && allIds.every(id => id in sharedEnrichment);

		const [wipResult, enrichmentResult] = await Promise.all([
			wipIds.length > 0 ? this._ipc.sendRequest(GetOverviewWipRequest, { branchIds: wipIds }) : undefined,
			sharedCoversAll
				? Promise.resolve(sharedEnrichment)
				: this._ipc.sendRequest(GetOverviewEnrichmentRequest, { branchIds: allIds }),
		]);
		if (this._lastOverviewFingerprint !== fingerprint) return;

		// Prune entries for branches no longer in the overview so stale data doesn't linger.
		this._wipData = wipResult ? filterToKeys(wipResult, keep) : {};
		this._enrichmentData = filterToKeys(enrichmentResult, keep);
		// Expose enrichment via shared state so other consumers (e.g. the scope popover path
		// in graph-app) can resolve merge-target refs for the selected branch.
		this._state.overviewEnrichment = this._enrichmentData;
	}

	override render() {
		const overview = this._state.overview;
		// Touch the selection signals during render so SignalWatcher subscribes to them — without
		// these reads, selection-only state updates don't re-render this component, `updated()`
		// never re-fires, and `maybeRecomputeSelectionContains` never sees the new selection.
		void this._state.activeRow;
		void this._state.selectedRows;
		if (overview == null) {
			return html`
				<div class="content scrollable">
					<div class="empty">Loading...</div>
				</div>
			`;
		}

		const hasActive = overview.active.length > 0;
		const hasRecent = overview.recent.length > 0;

		return html`
			<div class="content scrollable">
				${when(
					hasActive,
					() => html`
						<div class="group">
							<div class="group__label">Current work</div>
							${this.renderCards(overview.active)}
						</div>
					`,
				)}
				${when(
					hasRecent,
					() => html`
						<div class="group">
							<div class="group__header">
								<div class="group__label">
									Recent <span class="group__count">(${overview.recent.length})</span>
								</div>
								${this.renderRecentThresholdFilter()}
							</div>
							${this.renderCards(overview.recent)}
						</div>
					`,
				)}
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

		// Let graph-app own the persisted signal + memento write (mirrors the timeline period
		// flow); send the request here since this panel owns the overview fetch lifecycle.
		this.dispatchEvent(
			new CustomEvent('gl-graph-overview-recent-threshold-change', {
				detail: { threshold: threshold },
				bubbles: true,
				composed: true,
			}),
		);
		// Apply the re-partitioned response — unlike the host-pushed `DidChangeOverviewNotification`
		// path (graph load, branch changes), a `GetOverviewRequest` reply isn't routed into state
		// for us, so a threshold change would otherwise never re-render the Recent list.
		void this._ipc.sendRequest(GetOverviewRequest, { recentThreshold: threshold }).then(overview => {
			this._state.overview = overview;
		});
	}

	private renderCards(branches: GraphOverviewData['active']) {
		if (!branches.length) return nothing;

		const sessionsByRepoAndWorktree = indexAgentSessionsByRepoAndWorktree(this._state.agentSessions);
		const containsByRepo = this._selectionContainsByRepo;

		return html`
			<div class="cards">
				${repeat(
					branches,
					b => b.id,
					b => html`
						<gl-graph-overview-card
							.branch=${b}
							.wip=${this._wipData[b.id]}
							.enrichment=${this._enrichmentData[b.id]}
							.agentSessions=${matchAgentSessionsForWorktree(sessionsByRepoAndWorktree, {
								repoPath: b.repoPath,
								worktreePath: b.worktree?.path,
							})}
							.containsSelection=${containsByRepo.get(b.repoPath)?.has(b.name) ?? false}
						></gl-graph-overview-card>
					`,
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
	}
}
