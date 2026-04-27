import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { basename } from '@gitlens/utils/path.js';
import type {
	AgentSessionState,
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
import './agent-session-card.js';
import './branch-section.js';

export const overviewTagName = 'gl-overview';

type OverviewTab = 'recent' | 'agents';
type AgentFilter = 'workspace' | 'all';

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

			.tabs {
				display: inline-flex;
				gap: 0.6rem;
			}

			.tab {
				appearance: none;
				background: none;
				border: none;
				padding: 0;
				margin: 0;
				cursor: pointer;
				font-family: inherit;
				font-size: inherit;
				font-weight: normal;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.tab:hover {
				color: var(--vscode-foreground);
			}

			.tab[aria-selected='true'] {
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

	@state()
	private _agentFilter: AgentFilter = 'workspace';

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

	private renderTabs() {
		return html`<div class="tabs" slot="heading" role="tablist">
			<button
				class="tab"
				role="tab"
				aria-selected=${this._activeTab === 'recent'}
				@click=${() => this.switchTab('recent')}
			>
				Recent
			</button>
			<button
				class="tab"
				role="tab"
				aria-selected=${this._activeTab === 'agents'}
				@click=${() => this.switchTab('agents')}
			>
				Agents
			</button>
		</div>`;
	}

	private switchTab(tab: OverviewTab): void {
		if (this._activeTab === tab) return;
		this._activeTab = tab;
		if (tab === 'agents') {
			this._agentOverviewState.fetch();
		}
	}

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
					${this.renderTabs()}
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
				${this.renderTabs()}
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
					${this.renderTabs()}
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
		const branches = this.filterAgentBranches(overview.recent, repository.path);
		const unrepresentedSessions =
			this._agentFilter === 'all' ? this.getUnrepresentedAgentSessions(branches, repository.path) : [];

		return html`
			<gl-section ?loading=${isFetching}>
				${this.renderTabs()}
				<select
					slot="heading-actions"
					class="select"
					.value=${this._agentFilter}
					@change=${this.onAgentFilterChange}
				>
					<option value="workspace" ?selected=${this._agentFilter === 'workspace'}>workspace</option>
					<option value="all" ?selected=${this._agentFilter === 'all'}>all</option>
				</select>
				${branches.length > 0 || unrepresentedSessions.length > 0
					? html`${branches.length > 0
							? this.renderBranchCards(branches, repository.path)
							: nothing}${this.renderAgentSessionCards(unrepresentedSessions)}`
					: html`<p>No agent sessions</p>`}
			</gl-section>
		`;
	}

	private readonly onAgentFilterChange = (e: Event) => {
		this._agentFilter = (e.target as HTMLSelectElement).value as AgentFilter;
	};

	private filterAgentBranches(branches: GetOverviewBranch[], repoPath: string): GetOverviewBranch[] {
		if (this._agentFilter === 'all') return branches;

		const sessions = this._homeCtx.agentSessions.get() ?? [];
		const workspaceBranches = new Set<string>();
		for (const session of sessions) {
			if (session.branch != null && session.workspacePath === repoPath) {
				workspaceBranches.add(session.branch);
			}
		}

		return branches.filter(b => workspaceBranches.has(b.name));
	}

	private getUnrepresentedAgentSessions(
		renderedBranches: GetOverviewBranch[],
		repoPath: string,
	): AgentSessionState[] {
		const sessions = this._homeCtx.agentSessions.get() ?? [];
		if (sessions.length === 0) return [];

		const renderedBranchNames = new Set(renderedBranches.map(b => b.name));
		return sessions.filter(s => {
			if (s.branch == null) return true;
			if (s.workspacePath !== repoPath) return true;
			return !renderedBranchNames.has(s.branch);
		});
	}

	private renderAgentSessionCards(sessions: AgentSessionState[]): unknown {
		if (sessions.length === 0) return nothing;

		const groups = new Map<string, AgentSessionState[]>();
		for (const session of sessions) {
			const key = session.workspacePath || session.cwd || 'unknown';
			let group = groups.get(key);
			if (group == null) {
				group = [];
				groups.set(key, group);
			}
			group.push(session);
		}

		return html`${Array.from(
			groups,
			([key, groupSessions]) => html`
				<gl-agent-session-card
					.label=${key !== 'unknown' ? basename(key) : 'Unknown'}
					.labelTitle=${key !== 'unknown' ? key : ''}
					.labelType=${groupSessions[0].workspacePath ? 'workspace' : 'cwd'}
					.sessions=${groupSessions}
				></gl-agent-session-card>
			`,
		)}`;
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
