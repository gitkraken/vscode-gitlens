import type { GraphRow, SelectCommitsOptions } from '@gitkraken/gitkraken-components';
import { refZone } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import type { GitGraphRowType } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { GraphMinimapMarkerTypes, GraphSidebarPanel } from '../../../plus/graph/protocol.js';
import {
	GetRowHoverRequest,
	GetWipStatsRequest,
	isSecondaryWipSha,
	UpdateGraphConfigurationCommand,
} from '../../../plus/graph/protocol.js';
import type { CustomEventType } from '../../shared/components/element.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../shared/contexts/telemetry.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import type { AppState } from './context.js';
import { graphServicesContext, graphStateContext } from './context.js';
import type { GlGraphHeader } from './graph-header.js';
import type { GlGraphWrapper } from './graph-wrapper/graph-wrapper.js';
import type { GlGraphHover } from './hover/graphHover.js';
import type { GlGraphMinimapContainer, GraphMinimapConfigChangeEventDetail } from './minimap/minimap-container.js';
import type { GraphMinimapDaySelectedEventDetail, GraphMinimapWheelEvent } from './minimap/minimap.js';
import type { GlGraphSidebarPanel, GraphSidebarPanelSelectEventDetail } from './sidebar/sidebar-panel.js';
import type { GraphSidebarToggleEventDetail } from './sidebar/sidebar.js';
import './gate.js';
import './graph-header.js';
import './graph-wrapper/graph-wrapper.js';
import './hover/graphHover.js';
import './minimap/minimap-container.js';
import '../../shared/components/split-panel/split-panel.js';
import './sidebar/sidebar.js';
import './sidebar/sidebar-panel.js';
import '../../shared/components/mcp-banner.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import './components/gl-graph-details-panel.js';

const sidebarDefaultPct = 18;
const sidebarMinPct = 12;
const sidebarMaxPct = 37.5;

const detailsDefaultPct = 30;
const detailsMinPct = 20;
const detailsMaxPct = 50;

const minimapDefaultPx = 40;
const minimapMaxPct = 40;

@customElement('gl-graph-app')
export class GraphApp extends SignalWatcher(LitElement) {
	private _hoverTrackingCounter = getScopedCounter();
	private _selectionTrackingCounter = getScopedCounter();
	private _lastSearchRequest: SearchQuery | undefined;
	private _wasDetailsVisible = false;
	private _wasSidebarVisible = false;
	private _wasSidebarActivePanel: string | null | undefined;

	private _sidebarSnap = ({ pos }: { pos: number }) => {
		if (pos < sidebarMinPct / 2) return 0;
		if (pos < sidebarMinPct) return sidebarMinPct;
		if (pos > sidebarMaxPct) return sidebarMaxPct;
		if (Math.abs(pos - sidebarDefaultPct) <= 1.5) return sidebarDefaultPct;
		return pos;
	};

	private _detailsSnap = ({ pos }: { pos: number }) => {
		const endPct = 100 - pos;
		if (endPct < detailsMinPct / 2) return 100;
		if (endPct < detailsMinPct) return 100 - detailsMinPct;
		if (endPct > detailsMaxPct) return 100 - detailsMaxPct;
		if (Math.abs(endPct - detailsDefaultPct) <= 1.5) return 100 - detailsDefaultPct;
		return pos;
	};

	private _minimapSnap = ({ pos, size }: { pos: number; size: number }) => {
		if (size <= 0) return pos;
		const defaultPct = (minimapDefaultPx / size) * 100;
		// First render without a stored position: snap to the exact pixel default
		// regardless of the container's current size.
		if (this.graphState.minimapPosition == null) {
			return defaultPct;
		}
		const px = (pos / 100) * size;
		if (px < minimapDefaultPx / 2) return 0;
		if (px < minimapDefaultPx) return defaultPct;
		if (pos > minimapMaxPct) return minimapMaxPct;
		if (Math.abs(px - minimapDefaultPx) <= 2) return defaultPct;
		return pos;
	};

	@state()
	private _selectedCommit?: { sha: string; repoPath: string; reachability?: GitCommitReachability };

	@state()
	private _selectedCommits?: { shas: string[]; repoPath: string };

	private get fallbackRepoPath(): string | undefined {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		if (repoId != null) {
			const found = repos?.find(r => r.id === repoId)?.path;
			if (found != null) return found;
		}
		return repos?.[0]?.path;
	}

	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	@query('gl-graph-wrapper')
	graph!: GlGraphWrapper;

	@query('gl-graph-header')
	private readonly graphHeader!: GlGraphHeader;

	@query('gl-graph-hover#commit-hover')
	private readonly graphHover!: GlGraphHover;

	@query('gl-graph-minimap-container')
	minimapEl: GlGraphMinimapContainer | undefined;

	@query('gl-graph-sidebar-panel')
	private readonly sidebarPanelEl: GlGraphSidebarPanel | undefined;

	onWebviewVisibilityChanged(visible: boolean): void {
		if (!visible) return;

		this._hoverTrackingCounter.reset();
		this._selectionTrackingCounter.reset();

		// Auto-focus the graph rows for keyboard navigation
		this.graph?.focus();
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		const detailsVisible = this.graphState.detailsVisible ?? false;
		if (detailsVisible !== this._wasDetailsVisible) {
			this._wasDetailsVisible = detailsVisible;
			if (detailsVisible) {
				const pane = this.querySelector<HTMLElement>('.graph__details-pane');
				if (pane) {
					pane.classList.remove('details-opening');
					void pane.offsetWidth;
					pane.classList.add('details-opening');
					pane.addEventListener('animationend', () => pane.classList.remove('details-opening'), {
						once: true,
					});
				}
			}
		}

		// Re-trigger the sidebar-panel's enter animation on transitions to visible AND on
		// active-panel changes while visible, but with DIFFERENT animations: `opening` for
		// the show/hide reveal (slide in from -8px X), `switching` for swapping the active
		// panel content (slide in from 4px Y — matches the sub-panel-enter used by
		// review/compose/compare). The panel element is always mounted (always in the split-
		// panel's `start` slot) so an unconditional `:host` animation would fire at 0 width.
		const sidebarVisible = this.graphState.sidebarVisible ?? false;
		const sidebarActivePanel = this.graphState.activeSidebarPanel ?? null;
		const becameVisible = sidebarVisible && !this._wasSidebarVisible;
		const activePanelChanged =
			sidebarVisible &&
			!becameVisible &&
			this._wasSidebarActivePanel !== undefined &&
			sidebarActivePanel !== this._wasSidebarActivePanel;
		this._wasSidebarVisible = sidebarVisible;
		this._wasSidebarActivePanel = sidebarActivePanel;
		if (becameVisible || activePanelChanged) {
			const sidebarPanel = this.sidebarPanelEl;
			if (sidebarPanel != null) {
				const attr = becameVisible ? 'opening' : 'switching';
				sidebarPanel.removeAttribute('opening');
				sidebarPanel.removeAttribute('switching');
				// Force a reflow so the animation restarts even if an attribute was
				// re-added within the same microtask.
				void (sidebarPanel as HTMLElement).offsetWidth;
				sidebarPanel.setAttribute(attr, '');
				sidebarPanel.addEventListener('animationend', () => sidebarPanel.removeAttribute(attr), {
					once: true,
				});
			}
		}

		// Check for external search request (from file history command, etc.)
		const searchRequest = this.graphState.searchRequest;
		if (searchRequest && searchRequest !== this._lastSearchRequest) {
			this._lastSearchRequest = searchRequest;
			// Wait for next render cycle to ensure graphHeader is ready
			void this.updateComplete.then(() => {
				this.graphHeader?.setExternalSearchQuery(searchRequest);
			});
		}
	}

	resetHover() {
		this.graphHover.reset();
	}

	override render() {
		const detailsVisible = this.graphState.detailsVisible ?? false;
		const minimapVisible = this.graphState.minimapVisible ?? true;
		return html`
			<div class="graph">
				<gl-graph-header
					class="graph__header"
					.selectCommits=${this.selectCommits}
					.getCommits=${this.getCommits}
					.detailsVisible=${detailsVisible}
					.minimapVisible=${minimapVisible}
					.hasSelectedCommit=${this._selectedCommit != null || this._selectedCommits != null}
					@toggle-sidebar=${this.handleToggleSidebar}
					@toggle-details=${this.handleToggleDetails}
					@toggle-minimap=${this.handleToggleMinimap}
					@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
				></gl-graph-header>
				<div class="graph__workspace" @gl-graph-request-inspect=${this.handleRequestInspect}>
					${when(!this.graphState.allowed, () => html`<gl-graph-gate class="graph__gate"></gl-graph-gate>`)}
					<gl-graph-hover id="commit-hover" distance=${0} skidding=${15}></gl-graph-hover>
					<main id="main" class="graph__panes">${this.renderDetailsPanel()}</main>
				</div>
			</div>
		`;
	}

	private renderDetailsPanel() {
		// Always render the split panel to avoid DOM re-parenting (which causes layout jumps).
		// graphState.detailsVisible controls the split position; effective content controls divider state.
		// When no commit/compare is selected, default to the current branch's WIP.
		const hasSelection = this._selectedCommit != null || this._selectedCommits != null;
		const fallbackPath = !hasSelection ? this.fallbackRepoPath : undefined;
		const effectiveSha = this._selectedCommit?.sha ?? (fallbackPath != null ? uncommitted : undefined);
		const effectiveRepoPath = (this._selectedCommit ?? this._selectedCommits)?.repoPath ?? fallbackPath;
		const hasContent = effectiveSha != null || this._selectedCommits != null;
		const detailsVisible = this.graphState.detailsVisible ?? false;
		const position = detailsVisible ? (this.graphState.detailsPosition ?? 100 - detailsDefaultPct) : 100;
		return html`<gl-split-panel
			class="graph__details-split"
			primary="end"
			.position=${position}
			.snap=${hasContent ? this._detailsSnap : undefined}
			.disabled=${!hasContent}
			@gl-split-panel-change=${this.handleDetailsSplitChange}
			@gl-split-panel-drag-end=${this.handleSplitDragEnd}
			@gl-split-panel-closed-change=${this.handleDetailsClosedChange}
		>
			<div slot="start" class="graph__graph-pane">${this.renderGraphPaneContent()}</div>
			<div slot="end" class="graph__details-pane">
				<gl-graph-details-panel
					sha=${effectiveSha ?? nothing}
					repo-path=${effectiveRepoPath ?? nothing}
					.shas=${this._selectedCommits?.shas}
					.graphReachability=${this._selectedCommit?.reachability}
					@close-details=${this.handleCloseDetails}
					@select-commit=${this.handleSelectCommit}
				></gl-graph-details-panel>
			</div>
		</gl-split-panel>`;
	}

	private handleSelectCommit(e: CustomEvent<{ sha: string }>) {
		this.graph?.selectCommits([e.detail.sha], { ensureVisible: true });
	}

	private renderGraphPaneContent() {
		return html`
			<div class="graph__graph-pane-body">
				${when(
					this.graphState.config?.sidebar,
					() =>
						html`<gl-graph-sidebar
							active-panel=${this.graphState.activeSidebarPanel ?? nothing}
							.sidebarVisible=${this.graphState.sidebarVisible ?? false}
							@gl-graph-sidebar-toggle=${this.handleSidebarToggle}
						></gl-graph-sidebar>`,
				)}
				${this.graphState.config?.sidebar
					? this.renderSidebarSplit()
					: html`<div class="graph__graph-content">${this.renderGraphMain()}</div>`}
			</div>
		`;
	}

	private renderSidebarSplit() {
		const isOpen = (this.graphState.sidebarVisible ?? false) && this.graphState.activeSidebarPanel != null;
		const sidebarPosition = this.graphState.sidebarPosition ?? sidebarDefaultPct;
		return html`<gl-split-panel
			class="graph__sidebar-split"
			primary="start"
			.position=${isOpen ? sidebarPosition : 0}
			.snap=${this._sidebarSnap}
			@gl-split-panel-change=${this.handleSidebarSplitChange}
			@gl-split-panel-drag-end=${this.handleSplitDragEnd}
			@gl-split-panel-closed-change=${this.handleSidebarClosedChange}
		>
			<gl-graph-sidebar-panel
				slot="start"
				active-panel=${this.graphState.activeSidebarPanel ?? nothing}
				date-format=${this.graphState.config?.dateFormat ?? nothing}
				@gl-graph-sidebar-panel-select=${this.handleSidebarPanelSelect}
				@gl-graph-overview-branch-selected=${this.handleOverviewBranchSelected}
			></gl-graph-sidebar-panel>
			<div slot="end" class="graph__graph-content">${this.renderGraphMain()}</div>
		</gl-split-panel>`;
	}

	private renderGraphMain() {
		if (this.graphState.config?.minimap === false) {
			return this.renderGraphContent();
		}

		const minimapVisible = this.graphState.minimapVisible ?? true;
		const minimapPosition = this.graphState.minimapPosition ?? 6;
		const position = minimapVisible ? minimapPosition : 0;
		return html`
			<gl-split-panel
				class="graph__minimap-split"
				orientation="vertical"
				primary="start"
				.position=${position}
				.snap=${this._minimapSnap}
				@gl-split-panel-change=${this.handleMinimapSplitChange}
				@gl-split-panel-drag-end=${this.handleSplitDragEnd}
				@gl-split-panel-closed-change=${this.handleMinimapClosedChange}
			>
				<gl-graph-minimap-container
					slot="start"
					.activeDay=${this.graphState.activeDay}
					.disabled=${!this.graphState.config?.minimap}
					?collapsed=${!minimapVisible}
					.rows=${this.graphState.rows ?? []}
					.rowsStats=${this.graphState.rowsStats}
					.rowsStatsLoading=${this.graphState.rowsStatsLoading}
					.dataType=${this.graphState.config?.minimapDataType ?? 'commits'}
					.markerTypes=${this.graphState.config?.minimapMarkerTypes ?? []}
					.reversed=${this.graphState.config?.minimapReversed ?? false}
					.refMetadata=${this.graphState.refsMetadata}
					.searchResults=${this.graphState.searchResults}
					.scopeWindow=${this.deriveScopeWindow()}
					.visibleDays=${this.graphState.visibleDays
						? { ...this.graphState.visibleDays } // Need to clone the object since it is a signal proxy
						: undefined}
					.wipMetadataBySha=${this.graphState.wipMetadataBySha}
					@gl-graph-minimap-selected=${this.handleMinimapDaySelected}
					@gl-graph-minimap-config-change=${this.handleMinimapConfigChange}
					@gl-graph-minimap-wheel=${this.handleMinimapWheel}
				></gl-graph-minimap-container>
				${this.renderGraphContent('end')}
			</gl-split-panel>
		`;
	}

	private renderGraphContent(slot?: 'end') {
		return html`
			<div class="graph__graph-column" slot=${ifDefined(slot)}>
				<gl-graph-wrapper
					@gl-graph-change-selection=${this.handleGraphSelectionChanged}
					@gl-graph-change-visible-days=${this.handleGraphVisibleDaysChanged}
					@gl-graph-mouse-leave=${this.handleGraphMouseLeave}
					@gl-graph-row-context-menu=${this.handleGraphRowContextMenu}
					@gl-graph-row-double-click=${this.handleGraphRowDoubleClick}
					@gl-graph-row-hover=${this.handleGraphRowHover}
					@gl-graph-row-unhover=${this.handleGraphRowUnhover}
					@row-action-hover=${this.handleGraphRowActionHover}
					@rowhoverstart=${this.handleGraphRowHoverStart}
					@rowhovertrack=${this.handleGraphRowHoverTrack}
				></gl-graph-wrapper>
			</div>
		`;
	}

	private readonly _persistStateDebounced: Deferrable<() => void> = debounce(() => this.persistStateNow(), 200);

	private persistState(): void {
		this._persistStateDebounced();
	}

	private persistStateNow(): void {
		if (this.services == null) return;
		const gs = this.graphState;
		const state = {
			panels: {
				details: { visible: gs.detailsVisible, position: gs.detailsPosition },
				sidebar: {
					visible: gs.sidebarVisible,
					position: gs.sidebarPosition,
					activePanel: gs.activeSidebarPanel,
				},
				minimap: { visible: gs.minimapVisible, position: gs.minimapPosition },
			},
		};
		void (async () => {
			const storage = await this.services!.storage;
			await storage.updateWorkspace('graph:state', state);
		})();
	}

	private handleMinimapSplitChange(e: CustomEvent<{ position: number }>) {
		// Track position only while open — `handleMinimapClosedChange` owns the visibility flip.
		if (e.detail.position <= 0) return;
		const gs = this.graphState;
		if (gs.minimapPosition !== e.detail.position) {
			gs.minimapPosition = e.detail.position;
		}
	}

	private handleMinimapClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		const gs = this.graphState;
		if (e.detail.closed) {
			if (gs.minimapVisible !== false) {
				gs.minimapVisible = false;
			}
		} else if (gs.minimapVisible !== true) {
			gs.minimapVisible = true;
			gs.minimapPosition = e.detail.position;
		}
	};

	private handleSidebarSplitChange(e: CustomEvent<{ position: number }>) {
		if (e.detail.position <= 0) return;
		const gs = this.graphState;
		if (gs.sidebarPosition !== e.detail.position) {
			gs.sidebarPosition = e.detail.position;
		}
	}

	private handleSidebarClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		const gs = this.graphState;
		if (e.detail.closed) {
			if (gs.sidebarVisible !== false) {
				gs.sidebarVisible = false;
			}
			return;
		}
		let opened = false;
		if (!gs.sidebarVisible) {
			gs.sidebarVisible = true;
			opened = true;
		}
		if (gs.activeSidebarPanel == null) {
			gs.activeSidebarPanel = 'worktrees';
			opened = true;
		}
		gs.sidebarPosition = e.detail.position;
		if (opened) {
			this.focusSidebarFilterAfterRender();
		}
	};

	private handleSplitDragEnd = (): void => {
		this.persistState();
	};

	private setSidebarPanel(panel: GraphSidebarPanel): void {
		const gs = this.graphState;
		if (gs.activeSidebarPanel === panel && gs.sidebarVisible === true) return;
		gs.activeSidebarPanel = panel;
		gs.sidebarVisible = true;
		this.persistState();
		this.focusSidebarFilterAfterRender();
	}

	private focusSidebarFilterAfterRender(): void {
		void this.updateComplete.then(() => this.sidebarPanelEl?.focusFilter());
	}

	private hideSidebar(): void {
		const gs = this.graphState;
		if (!gs.sidebarVisible) return;
		gs.sidebarVisible = false;
		this.persistState();
	}

	private ensureDetailsPosition(): void {
		const gs = this.graphState;
		// Reset to the default when the stored position is missing or snapped to closed — so
		// reopening after a drag-to-close shows a usable width instead of a zero-width pane.
		// Snap lands at exact 100 when the pane is closed; anything less is a usable open width.
		if (gs.detailsPosition != null && gs.detailsPosition < 100) return;
		gs.detailsPosition = 100 - detailsDefaultPct;
		this.persistState();
	}

	private setDetailsVisible(visible: boolean): void {
		const gs = this.graphState;
		if (gs.detailsVisible === visible) return;
		gs.detailsVisible = visible;
		this.persistState();
	}

	private handleDetailsSplitChange(e: CustomEvent<{ position: number }>) {
		// Skip the closed-edge position (snap lands at exact 100). `handleDetailsClosedChange`
		// owns visibility; recording position=100 here would clobber the last open width.
		if (e.detail.position >= 100) return;
		this.graphState.detailsPosition = e.detail.position;
	}

	private handleDetailsClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		const gs = this.graphState;
		if (e.detail.closed) {
			if (gs.detailsVisible !== false) {
				gs.detailsVisible = false;
				this.persistState();
			}
		} else if (gs.detailsVisible !== true) {
			gs.detailsVisible = true;
			gs.detailsPosition = e.detail.position;
			this.persistState();
		}
	};

	private handleRequestInspect(e: CustomEvent<{ sha: string; repoPath: string }>) {
		const { sha, repoPath } = e.detail;

		this._selectedCommit = { sha: sha, repoPath: repoPath };
		this._selectedCommits = undefined;
		this.setDetailsVisible(true);
		this.ensureDetailsPosition();

		// Let the graph component handle row highlighting natively
		this.graph?.selectCommits([sha], { ensureVisible: true });
	}

	private handleCloseDetails() {
		this.setDetailsVisible(false);
		this._selectedCommit = undefined;
		this._selectedCommits = undefined;
		this.graph?.selectCommits([], { ensureVisible: false });
		this.graph?.focus();
	}

	private handleToggleDetails() {
		const gs = this.graphState;
		if (gs.detailsVisible) {
			this.setDetailsVisible(false);
		} else {
			this.setDetailsVisible(true);
			this.ensureDetailsPosition();
		}
	}

	private handleToggleMinimap() {
		if (this.graphState.config?.minimap === false) {
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: { minimap: true } });
			return;
		}
		const gs = this.graphState;
		gs.minimapVisible = !(gs.minimapVisible ?? true);
		this.persistState();
	}

	private handleToggleSidebar() {
		const gs = this.graphState;
		if (gs.sidebarVisible) {
			this.hideSidebar();
		} else {
			this.setSidebarPanel(gs.activeSidebarPanel ?? 'branches');
		}
	}

	private handleSidebarToggle(e: CustomEvent<GraphSidebarToggleEventDetail>) {
		const gs = this.graphState;
		const panel = e.detail.panel;
		if (gs.sidebarVisible && gs.activeSidebarPanel === panel) {
			this.hideSidebar();
		} else {
			this.setSidebarPanel(panel);
		}
	}

	private handleSidebarPanelSelect(e: CustomEvent<GraphSidebarPanelSelectEventDetail>) {
		this.graph?.ensureAndSelectCommit(e.detail.sha);
	}

	private handleOverviewBranchSelected(
		e: CustomEvent<{ branchId: string; branchName: string; mergeTargetTipSha?: string }>,
	) {
		this.scopeToBranchById(e.detail.branchId, e.detail.mergeTargetTipSha);
	}

	private handleScopeToBranchFromHeader(e: CustomEvent<{ branchName: string; upstreamName?: string }>) {
		const repoPath = this.fallbackRepoPath;
		if (repoPath == null) return;

		const { branchName, upstreamName } = e.detail;

		// Prefer the overview path so the merge target is resolved consistently with the overview card.
		const overview = this.graphState.overview;
		const branch =
			overview?.active.find(b => b.name === branchName) ?? overview?.recent.find(b => b.name === branchName);
		if (branch != null) {
			const mergeTargetTipSha = this.graphState.overviewEnrichment?.[branch.id]?.mergeTarget?.sha;
			this.scopeToBranchById(branch.id, mergeTargetTipSha);
			return;
		}

		// Fallback: branch isn't in the overview's active/recent list. Set the scope now with
		// whatever we know and fire an ad-hoc enrichment fetch — `syncScopeMergeTarget` will
		// backfill `mergeTargetTipSha` once the enrichment arrives.
		const branchRef = getBranchId(repoPath, false, branchName);
		this.setScope({
			branchRef: branchRef,
			branchName: branchName,
			upstreamRef: upstreamName != null ? getBranchId(repoPath, true, upstreamName) : undefined,
		});
		void this.graphState.ensureEnrichmentForBranch(branchRef);
	}

	private scopeToBranchById(branchId: string, mergeTargetTipSha?: string): void {
		const overview = this.graphState.overview;
		if (overview == null) return;

		const branch = overview.active.find(b => b.id === branchId) ?? overview.recent.find(b => b.id === branchId);
		if (branch == null) return;

		const upstreamRef =
			branch.upstream != null && !branch.upstream.missing
				? getBranchId(branch.repoPath, true, branch.upstream.name)
				: undefined;

		// Prefer a passed-in SHA (from a fresh event) over the one on enrichment, but fall back to
		// enrichment so repeated calls pick up data that's arrived since the previous call.
		const sha = mergeTargetTipSha ?? this.graphState.overviewEnrichment?.[branchId]?.mergeTarget?.sha;

		this.setScope({
			// The graph component indexes rows by head id (e.g. `{repoPath}|heads/{name}`), not bare branch name
			branchRef: branch.id,
			branchName: branch.name,
			upstreamRef: upstreamRef,
			mergeTargetTipSha: sha,
		});
	}

	private setScope(scope: NonNullable<typeof this.graphState.scope>): void {
		// Skip re-assignment when structurally equal so GraphContainer doesn't re-evaluate
		// scope highlighting on unrelated graph updates.
		const current = this.graphState.scope;
		if (
			current?.branchRef === scope.branchRef &&
			current?.branchName === scope.branchName &&
			current?.upstreamRef === scope.upstreamRef &&
			current?.mergeTargetTipSha === scope.mergeTargetTipSha
		) {
			return;
		}
		// Fill in a provisional mergeBase from already-loaded rows so the minimap zooms and the dim
		// bands appear instantly. `resolveScopeMergeBase` backfills the authoritative value (cached
		// on both sides of the IPC) — it's a no-op on re-picks of the same branch.
		const provisionalMergeBase = this.resolveProvisionalMergeBase(scope);
		this.graphState.scope = provisionalMergeBase != null ? { ...scope, mergeBase: provisionalMergeBase } : scope;
		void this.graphState.resolveScopeMergeBase(scope);
	}

	private resolveProvisionalMergeBase(
		scope: NonNullable<typeof this.graphState.scope>,
	): { sha: string; date: number } | undefined {
		const rows = this.graphState.rows;
		if (rows == null || rows.length === 0) return undefined;

		// Require the branch's own tip row so we can guard against base-branch candidates that moved
		// PAST the branch tip (which would produce an inverted {start > end} window).
		const tipRow = rows.find(
			r => r.heads?.some(h => h.id === scope.branchRef) || r.remotes?.some(re => re.id === scope.branchRef),
		);
		if (tipRow == null) return undefined;
		const tipDate = tipRow.date;

		// Preferred: upstream tip row — merge-base(branch, upstream) is the upstream tip when the branch
		// is ahead or synced, which is the common case.
		if (scope.upstreamRef != null) {
			const upstreamRow = rows.find(
				r =>
					r.remotes?.some(re => re.id === scope.upstreamRef) ||
					r.heads?.some(h => h.id === scope.upstreamRef),
			);
			if (upstreamRow != null && upstreamRow.date <= tipDate) {
				return { sha: upstreamRow.sha, date: upstreamRow.date };
			}
		}

		// Fallback: a common base branch that's loaded in the graph AND is older than the branch tip.
		// If main has moved past the branch tip, it's not a valid provisional — skip it and let the IPC
		// backfill the authoritative merge-base.
		for (const name of ['main', 'master', 'develop']) {
			if (name === scope.branchName) continue;
			const row = rows.find(r => r.heads?.some(h => h.name === name));
			if (row != null && row.date <= tipDate) {
				return { sha: row.sha, date: row.date };
			}
		}
		return undefined;
	}

	private _cachedScopeWindow:
		| {
				scope: AppState['scope'];
				rows: GraphRow[] | undefined;
				result: { start: number; end: number } | undefined;
		  }
		| undefined;

	private deriveScopeWindow(): { start: number; end: number } | undefined {
		const scope = this.graphState.scope;
		const rows = this.graphState.rows;
		if (scope?.mergeBase == null) return undefined;

		const cache = this._cachedScopeWindow;
		if (cache?.scope === scope && cache.rows === rows) {
			return cache.result;
		}

		let result: { start: number; end: number } | undefined;
		const tipRow = rows?.find(
			r => r.heads?.some(h => h.id === scope.branchRef) || r.remotes?.some(re => re.id === scope.branchRef),
		);
		if (tipRow != null) {
			let end = tipRow.date;
			if (scope.upstreamRef != null) {
				const upstreamRow = rows?.find(
					r =>
						r.remotes?.some(re => re.id === scope.upstreamRef) ||
						r.heads?.some(h => h.id === scope.upstreamRef),
				);
				if (upstreamRow != null && upstreamRow.date > end) {
					end = upstreamRow.date;
				}
			}
			result = { start: scope.mergeBase.date, end: end };
		}

		this._cachedScopeWindow = { scope: scope, rows: rows, result: result };
		return result;
	}

	private selectCommits = (shas: string[], options?: SelectCommitsOptions) => {
		return this.graph.selectCommits(shas, options);
	};

	private getCommits = (shas: string[]) => {
		return this.graph.getCommits(shas);
	};

	private handleMinimapWheel(e: GraphMinimapWheelEvent) {
		this.graph?.scrollGraphBy(e.detail.deltaY);
	}

	private handleMinimapDaySelected(e: CustomEvent<GraphMinimapDaySelectedEventDetail>) {
		if (!this.graphState.rows) return;

		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find closest row to the date
			const closest = this.graphState.rows.reduce((prev, curr) => {
				return Math.abs(curr.date - date) < Math.abs(prev.date - date) ? curr : prev;
			});
			sha = closest.sha;
		}

		this.graph.selectCommits([sha], { ensureVisible: true });

		if (e.target != null) {
			const { target } = e;
			queueMicrotask(() =>
				emitTelemetrySentEvent<'graph/minimap/day/selected'>(target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
			);
		}
	}

	private handleMinimapConfigChange(e: CustomEvent<GraphMinimapConfigChangeEventDetail>) {
		const { minimapDataType, minimapReversed, markerType, checked } = e.detail;

		if (minimapDataType != null) {
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, {
				changes: { minimapDataType: minimapDataType },
			});
			return;
		}

		if (minimapReversed != null) {
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, {
				changes: { minimapReversed: minimapReversed },
			});
			return;
		}

		if (markerType != null && checked != null) {
			const currentTypes = this.graphState.config?.minimapMarkerTypes ?? [];
			let minimapMarkerTypes: GraphMinimapMarkerTypes[];
			if (checked) {
				if (currentTypes.includes(markerType)) return;
				minimapMarkerTypes = [...currentTypes, markerType];
			} else {
				const index = currentTypes.indexOf(markerType);
				if (index === -1) return;
				minimapMarkerTypes = [...currentTypes];
				minimapMarkerTypes.splice(index, 1);
			}
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, {
				changes: { minimapMarkerTypes: minimapMarkerTypes },
			});
		}
	}

	private handleGraphSelectionChanged(e: CustomEventType<'gl-graph-change-selection'>) {
		this.graphHover.hide();

		const showDetailsView = this.graphState.config?.showDetailsView;

		const { selection, reachability } = e.detail;
		const fallbackRepoPath = this.fallbackRepoPath ?? '';

		if (selection.length >= 2) {
			const shas = selection
				.filter(s => s.type !== ('work-dir-changes' satisfies GitGraphRowType))
				.map(s => s.id);

			if (shas.length >= 2) {
				this._selectedCommit = undefined;
				this._selectedCommits = { shas: shas, repoPath: fallbackRepoPath };

				if (showDetailsView !== false) {
					this.setDetailsVisible(true);
					this.ensureDetailsPosition();
				}
			} else if (shas.length === 1) {
				// Multi-select included WIP + 1 commit — treat as single-select on the commit
				const sha = shas[0];
				this._selectedCommit = { sha: sha, repoPath: fallbackRepoPath };
				this._selectedCommits = undefined;

				if (showDetailsView !== false) {
					this.setDetailsVisible(true);
					this.ensureDetailsPosition();
				}
			} else {
				this._selectedCommit = undefined;
				this._selectedCommits = undefined;
			}
		} else if (selection.length === 1) {
			const active = selection[0];
			const sha = active.type === ('work-dir-changes' satisfies GitGraphRowType) ? uncommitted : active.id;
			// Prefer per-row repoPath (for multi-worktree WIP); fall back to selected repo
			const repoPath = active.repoPath ?? fallbackRepoPath;

			this._selectedCommit = { sha: sha, repoPath: repoPath, reachability: reachability };
			this._selectedCommits = undefined;

			// When `graph.showWorktreeWipStats` is disabled, secondary worktree WIP rows start
			// stats-less. Force-fetch stats for the selected row so it populates its pill.
			if (isSecondaryWipSha(active.id) && this.graphState.config?.showWorktreeWipStats === false) {
				void this.fetchSelectedWorktreeWipStats(active.id);
			}

			// Only auto-open the details panel if the setting allows it
			if (showDetailsView !== false) {
				this.setDetailsVisible(true);
				this.ensureDetailsPosition();
			}
		} else {
			this._selectedCommit = undefined;
			this._selectedCommits = undefined;
		}

		const count = this._selectionTrackingCounter.next();
		if (count === 1 || count % 100 === 0) {
			queueMicrotask(() =>
				this._telemetry.sendEvent({
					name: 'graph/row/selected',
					data: { rows: selection.length, count: count },
				}),
			);
		}
	}

	private handleGraphVisibleDaysChanged({ detail }: CustomEventType<'gl-graph-change-visible-days'>) {
		this.graphState.visibleDays = detail;
	}

	/**
	 * Fetches working-tree stats for a single secondary-worktree WIP row and writes them into
	 * `wipMetadataBySha` so the GK component's pill renders. Used when `graph.showWorktreeWipStats`
	 * is disabled — the server's `onGetWipStats` ignores non-`force` calls in that mode, and the GK
	 * component's `requestedMissingWipStats` dedup is persistent, so this is the only way to show
	 * stats for a row once the user opts in by selecting it.
	 */
	private async fetchSelectedWorktreeWipStats(sha: string): Promise<void> {
		const existing = this.graphState.wipMetadataBySha;
		if (existing == null) return;

		const current = existing[sha];
		if (current == null) return;

		// Already have stats for this row (user re-selected it) — nothing to do.
		if (current.workDirStats != null && !current.workDirStatsStale) return;

		const response = await this._ipc.sendRequest(GetWipStatsRequest, { shas: [sha], force: true });
		if (response == null) return;

		const map = this.graphState.wipMetadataBySha;
		if (map == null) return;
		const prev = map[sha];
		if (prev == null) return;

		const stats = response[sha];
		const next = { ...map, [sha]: { ...prev, workDirStats: stats, workDirStatsStale: false } };
		this.graphState.wipMetadataBySha = next;
	}

	private handleGraphRowContextMenu(_e: CustomEventType<'gl-graph-row-context-menu'>) {
		this.graphHover.hide();
	}

	private handleGraphRowDoubleClick(_e: CustomEventType<'gl-graph-row-double-click'>) {
		if (this.graphState.detailsVisible) return;
		this.setDetailsVisible(true);
		this.ensureDetailsPosition();
	}

	private handleGraphRowHover({
		detail: { graphZoneType, graphRow, clientX, currentTarget },
	}: CustomEventType<'gl-graph-row-hover'>) {
		if (graphZoneType === refZone) return;

		const hover = this.graphHover;
		if (hover == null) return;

		const rect = currentTarget.getBoundingClientRect();
		const x = clientX;
		const y = rect.top;
		const height = rect.height;
		const width = 60; // Add some width, so `skidding` will be able to apply
		const anchor = {
			getBoundingClientRect: function () {
				return {
					width: width,
					height: height,
					x: x,
					y: y,
					top: y,
					left: x,
					right: x + width,
					bottom: y + height,
				};
			},
		};

		hover.requestMarkdown ??= this.getRowHoverPromise.bind(this);
		hover.onRowHovered(graphRow, anchor);
	}

	private handleGraphRowHoverTrack({ detail: { graphZoneType, graphRow } }: CustomEventType<'rowhovertrack'>) {
		if (graphZoneType === refZone) return;
		this.minimapEl?.select(graphRow.date, true);
	}

	private handleGraphRowUnhover({
		detail: { graphRow, relatedTarget },
	}: CustomEventType<'gl-graph-row-unhover'>): void {
		this.graphHover.onRowUnhovered(graphRow, relatedTarget);
	}

	private handleGraphRowHoverStart() {
		this.graphHover.resetUnhoverTimer();
	}

	private handleGraphRowActionHover() {
		this.graphHover.hide();
	}

	private async getRowHoverPromise(row: GraphRow) {
		try {
			const request = await this._ipc.sendRequest(GetRowHoverRequest, {
				type: row.type as GitGraphRowType,
				id: row.sha,
			});

			const count = this._hoverTrackingCounter.next();
			if (count === 1 || count % 100 === 0) {
				queueMicrotask(() => this._telemetry.sendEvent({ name: 'graph/row/hovered', data: { count: count } }));
			}

			return request;
		} catch (ex) {
			return { id: row.sha, markdown: { status: 'rejected' as const, reason: ex } };
		}
	}

	private handleGraphMouseLeave() {
		this.minimapEl?.unselect(undefined, true);
	}
}
