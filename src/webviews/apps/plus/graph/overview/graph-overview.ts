import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	GraphOverviewData,
} from '../../../../plus/graph/protocol.js';
import {
	GetOverviewEnrichmentRequest,
	GetOverviewRequest,
	GetOverviewWipRequest,
} from '../../../../plus/graph/protocol.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { HostIpc } from '../../../shared/ipc.js';
import type { AppState } from '../context.js';
import { graphStateContext } from '../context.js';
import './graph-overview-card.js';
import '../../../shared/components/code-icon.js';

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

			.group__count {
				opacity: 0.7;
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

	@state()
	private _expandedCardId: string | undefined;

	@state()
	private _wipData: GetOverviewWipResponse = {};

	@state()
	private _enrichmentData: GetOverviewEnrichmentResponse = {};

	private _lastOverview: GraphOverviewData | undefined;
	private _lastOverviewFingerprint: string | undefined;
	private _lastPushedWip: GetOverviewWipResponse | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();

		if (this._state.overview == null) {
			void this._ipc.sendRequest(GetOverviewRequest, undefined);
		} else {
			this.maybeRefetchOverviewData(this._state.overview);
		}
	}

	refresh(): void {
		this._lastOverview = undefined;
		this._lastOverviewFingerprint = undefined;
		this._lastPushedWip = undefined;
		this._wipData = {};
		this._enrichmentData = {};
		this._state.overviewEnrichment = undefined;
		void this._ipc.sendRequest(GetOverviewRequest, undefined);
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
	}

	private maybeRefetchOverviewData(overview: GraphOverviewData): void {
		if (overview === this._lastOverview) return;

		const fingerprint = this.getOverviewFingerprint(overview);
		if (fingerprint !== this._lastOverviewFingerprint) {
			this._lastOverviewFingerprint = fingerprint;
			void this.fetchOverviewData(overview);
		}
		this._lastOverview = overview;
	}

	private getOverviewFingerprint(overview: GraphOverviewData): string {
		const ids = [...overview.active.map(b => b.id), ...overview.recent.map(b => b.id)];
		return ids.sort().join(',');
	}

	private async fetchOverviewData(overview: GraphOverviewData) {
		const allBranches = [...overview.active, ...overview.recent];
		if (allBranches.length === 0) return;

		const allIds = allBranches.map(b => b.id);
		const wipIds = overview.active.map(b => b.id);
		const keep = new Set(allIds);

		// graph-app fetches enrichment eagerly when overview arrives (so the scope popover
		// path can resolve merge-target refs even without this panel mounted). Prefer that
		// shared result when it matches our branch set — otherwise fall back to fetching here.
		const sharedEnrichment = this._state.overviewEnrichment;
		const sharedCoversAll = sharedEnrichment != null && allIds.every(id => id in sharedEnrichment);

		const [wipResult, enrichmentResult] = await Promise.all([
			wipIds.length > 0 ? this._ipc.sendRequest(GetOverviewWipRequest, { branchIds: wipIds }) : undefined,
			sharedCoversAll
				? Promise.resolve(sharedEnrichment)
				: this._ipc.sendRequest(GetOverviewEnrichmentRequest, { branchIds: allIds }),
		]);

		// Prune entries for branches no longer in the overview so stale data doesn't linger.
		this._wipData = wipResult ? filterToKeys(wipResult, keep) : {};
		this._enrichmentData = filterToKeys(enrichmentResult, keep);
		// Expose enrichment via shared state so other consumers (e.g. the scope popover path
		// in graph-app) can resolve merge-target refs for the selected branch.
		this._state.overviewEnrichment = this._enrichmentData;
	}

	override render() {
		const overview = this._state.overview;
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
							<div class="group__label">
								Recent <span class="group__count">(${overview.recent.length})</span>
							</div>
							${this.renderCards(overview.recent)}
						</div>
					`,
				)}
			</div>
		`;
	}

	private renderCards(branches: GraphOverviewData['active']) {
		if (!branches.length) return nothing;

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
							expandable
							.expanded=${this._expandedCardId === b.id}
							@gl-graph-overview-card-expand-toggled=${(e: CustomEvent<{ expanded: boolean }>) =>
								this.onCardExpandToggled(b.id, e.detail.expanded)}
						></gl-graph-overview-card>
					`,
				)}
			</div>
		`;
	}

	private onCardExpandToggled(branchId: string, expanded: boolean) {
		this._expandedCardId = expanded ? branchId : undefined;
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
