import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type {
	GetInactiveOverviewResponse,
	GetOverviewBranch,
	OverviewRecentThreshold,
} from '../../../../home/protocol.js';
import type { HomeState } from '../../../home/state.js';
import { homeStateContext } from '../../../home/state.js';
import { linkStyles } from '../../shared/components/vscode.css.js';
import { selectStyles } from './branch-threshold-filter.js';
import type { AgentOverviewState, InactiveOverviewState } from './overviewState.js';
import { agentOverviewStateContext, inactiveOverviewStateContext } from './overviewState.js';
import '../../../shared/components/skeleton-loader.js';
import './branch-section.js';

export const overviewTagName = 'gl-overview';

type OverviewTab = 'recent' | 'agents';

@customElement(overviewTagName)
export class GlOverview extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		selectStyles,
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
				color: var(--vscode-foreground);
			}
		`,
	];

	@consume({ context: homeStateContext })
	private _homeCtx!: HomeState;

	@consume({ context: inactiveOverviewStateContext })
	private _inactiveOverviewState!: InactiveOverviewState;

	@consume({ context: agentOverviewStateContext })
	private _agentOverviewState!: AgentOverviewState;

	@state()
	private _activeTab: OverviewTab = 'recent';

	override connectedCallback(): void {
		super.connectedCallback?.();

		if (this._homeCtx.repositories.get().openCount > 0) {
			this._inactiveOverviewState.fetch();
		}
	}

	override render(): unknown {
		if (this._homeCtx.discovering.get()) {
			return this.renderLoader();
		}

		if (this._homeCtx.repositories.get().openCount === 0) {
			return nothing;
		}

		const hasAgents = (this._homeCtx.agentSessions.get()?.length ?? 0) > 0;

		// When no agents, render original behavior with gl-branch-section
		if (!hasAgents) {
			return this.renderRecentOnly();
		}

		if (this._activeTab === 'agents') {
			return this.renderAgentsTab();
		}

		return this.renderRecentTab();
	}

	// ── Tab switching ──

	private renderTabDropdown() {
		return html`<select slot="heading" class="select" @change=${this.onTabChange} .value=${this._activeTab}>
			<option value="recent" ?selected=${this._activeTab === 'recent'}>Recent</option>
			<option value="agents" ?selected=${this._activeTab === 'agents'}>Agents</option>
		</select>`;
	}

	private readonly onTabChange = (e: Event) => {
		const tab = (e.target as HTMLSelectElement).value as OverviewTab;
		this._activeTab = tab;
		if (tab === 'agents') {
			this._agentOverviewState.fetch();
		}
	};

	// ── Recent (no agents, original behavior) ──

	private renderRecentOnly() {
		if (this._inactiveOverviewState.error.get() != null) {
			return html`
				<gl-section>
					<span slot="heading">Recent</span>
					<span
						>Unable to load branch data.
						<a
							href="#"
							@click=${(e: Event) => {
								e.preventDefault();
								this._inactiveOverviewState.fetch();
							}}
							>Retry</a
						>
					</span>
				</gl-section>
			`;
		}

		const overview = this._inactiveOverviewState.value.get();
		if (overview == null) {
			return this.renderLoader();
		}

		return this.renderRecentOnlyComplete(overview, this._inactiveOverviewState.loading.get());
	}

	private renderRecentOnlyComplete(overview: GetInactiveOverviewResponse, isFetching = false) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<gl-branch-section
				label="recent"
				.isFetching=${isFetching}
				.repo=${repository.path}
				.branches=${overview.recent}
			>
				<gl-branch-threshold-filter
					slot="heading-actions"
					@gl-change=${this.onChangeRecentThresholdFilter}
					.options=${[
						{ value: 'OneDay', label: '1 day' },
						{ value: 'OneWeek', label: '1 week' },
						{ value: 'OneMonth', label: '1 month' },
					] satisfies {
						value: OverviewRecentThreshold;
						label: string;
					}[]}
					.disabled=${isFetching}
					.value=${this._inactiveOverviewState.filter.recent?.threshold}
				></gl-branch-threshold-filter>
			</gl-branch-section>
			${when(
				this._inactiveOverviewState.filter.stale?.show === true && overview.stale,
				() => html`
					<gl-branch-section
						label="stale"
						.repo=${repository.path}
						.branches=${overview.stale!}
					></gl-branch-section>
				`,
			)}
		`;
	}

	private readonly onChangeRecentThresholdFilter = (e: CustomEvent<{ threshold: OverviewRecentThreshold }>) => {
		if (!this._inactiveOverviewState.filter.stale || !this._inactiveOverviewState.filter.recent) {
			return;
		}
		void this._homeCtx.homeService?.setOverviewFilter({
			stale: this._inactiveOverviewState.filter.stale,
			recent: { ...this._inactiveOverviewState.filter.recent, threshold: e.detail.threshold },
		});
	};

	// ── Recent tab (with agents dropdown) ──

	private renderRecentTab() {
		if (this._inactiveOverviewState.error.get() != null) {
			return html`
				<gl-section>
					${this.renderTabDropdown()}
					<span
						>Unable to load branch data.
						<a
							href="#"
							@click=${(e: Event) => {
								e.preventDefault();
								this._inactiveOverviewState.fetch();
							}}
							>Retry</a
						>
					</span>
				</gl-section>
			`;
		}

		const overview = this._inactiveOverviewState.value.get();
		if (overview == null) {
			return this.renderLoader();
		}

		return this.renderRecentTabComplete(overview, this._inactiveOverviewState.loading.get());
	}

	private renderRecentTabComplete(overview: GetInactiveOverviewResponse, isFetching = false) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<gl-section ?loading=${isFetching}>
				${this.renderTabDropdown()}
				<gl-branch-threshold-filter
					slot="heading-actions"
					@gl-change=${this.onChangeRecentThresholdFilter}
					.options=${[
						{ value: 'OneDay', label: '1 day' },
						{ value: 'OneWeek', label: '1 week' },
						{ value: 'OneMonth', label: '1 month' },
					] satisfies {
						value: OverviewRecentThreshold;
						label: string;
					}[]}
					.disabled=${isFetching}
					.value=${this._inactiveOverviewState.filter.recent?.threshold}
				></gl-branch-threshold-filter>
				${this.renderBranchCards(overview.recent, repository.path)}
			</gl-section>
			${when(
				this._inactiveOverviewState.filter.stale?.show === true && overview.stale,
				() => html`
					<gl-branch-section
						label="stale"
						.repo=${repository.path}
						.branches=${overview.stale!}
					></gl-branch-section>
				`,
			)}
		`;
	}

	// ── Agents tab ──

	private renderAgentsTab() {
		if (this._agentOverviewState.error.get() != null) {
			return html`
				<gl-section>
					${this.renderTabDropdown()}
					<span
						>Unable to load agent branch data.
						<a
							href="#"
							@click=${(e: Event) => {
								e.preventDefault();
								this._agentOverviewState.fetch();
							}}
							>Retry</a
						>
					</span>
				</gl-section>
			`;
		}

		const overview = this._agentOverviewState.value.get();
		if (overview == null) {
			return this.renderLoader();
		}

		return this.renderAgentsTabComplete(overview, this._agentOverviewState.loading.get());
	}

	private renderAgentsTabComplete(overview: GetInactiveOverviewResponse, isFetching = false) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<gl-section ?loading=${isFetching}>
				${this.renderTabDropdown()} ${this.renderBranchCards(overview.recent, repository.path)}
			</gl-section>
		`;
	}

	// ── Shared ──

	private renderBranchCards(branches: GetOverviewBranch[], repo: string) {
		if (branches.length === 0) {
			return html`<p>No branches</p>`;
		}

		return branches.map(
			branch => html`<gl-branch-card expandable .repo=${repo} .branch=${branch}></gl-branch-card>`,
		);
	}

	private renderLoader() {
		return html`
			<gl-section>
				<skeleton-loader slot="heading" lines="1"></skeleton-loader>
				<skeleton-loader lines="3"></skeleton-loader>
			</gl-section>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[overviewTagName]: GlOverview;
	}
}
