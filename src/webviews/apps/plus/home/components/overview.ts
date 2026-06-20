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
import type { AgentOverviewState, InactiveOverviewState } from './overviewState.js';
import { agentOverviewStateContext, inactiveOverviewStateContext } from './overviewState.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/menu/menu-popover.js';
import '../../../shared/components/skeleton-loader.js';
import './agent-session-card.js';
import './branch-section.js';

export const overviewTagName = 'gl-overview';

type OverviewTab = 'recent' | 'agents';
type AgentFilter = 'workspace' | 'all';

/** Recent-timeframe options for the overview's "Recent" filter, in display order. */
const recentThresholdItems: { value: OverviewRecentThreshold; label: string }[] = [
	{ value: 'OneDay', label: '1 day' },
	{ value: 'OneWeek', label: '1 week' },
	{ value: 'OneMonth', label: '1 month' },
];

@customElement(overviewTagName)
export class GlOverview extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		css`
			:host {
				display: block;
				margin-bottom: var(--gl-space-24);
				color: var(--vscode-foreground);
			}

			/* Native <select> styling — used by the agents workspace/all filter. */
			.select {
				font-weight: 500;
				color: var(--color-foreground--25);
				text-decoration: none !important;
				outline: none;
				background: none;
				border: none;
			}

			.select option {
				color: var(--vscode-foreground);
				background-color: var(--vscode-dropdown-background);
			}

			.select option:checked {
				color: var(--vscode-list-activeSelectionForeground);
				background-color: var(--vscode-list-activeSelectionBackground);
			}

			.select:not(:disabled) {
				color: var(--color-foreground--50);
				cursor: pointer;
			}

			.select:not(:disabled):focus {
				outline: 1px solid var(--color-focus-border);
			}

			.select:not(:disabled):hover {
				color: var(--vscode-foreground);
				text-decoration: underline !important;
			}

			/* Recent-timeframe filter — the gl-menu-popover anchor button. */
			.threshold-filter {
				display: inline-flex;
				gap: var(--gl-space-2);
				align-items: center;
				padding: 0;
				font: inherit;
				font-weight: 500;
				color: var(--color-foreground--50);
				white-space: nowrap;
				cursor: pointer;
				background: none;
				border: none;
			}

			.threshold-filter:hover:not(:disabled) {
				color: var(--vscode-foreground);
			}

			.threshold-filter:focus-visible {
				outline: 1px solid var(--color-focus-border);
			}

			.threshold-filter:disabled {
				color: var(--color-foreground--25);
				cursor: default;
			}

			.threshold-filter code-icon {
				font-size: 1rem;
			}

			.tabs {
				display: inline-flex;
				gap: var(--gl-space-6);
			}

			.tab {
				padding: 0;
				margin: 0;
				font-family: inherit;
				font-size: inherit;
				font-weight: normal;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				appearance: none;
				cursor: pointer;
				background: none;
				border: none;
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
				${this.renderRecentThresholdFilter(isFetching)}
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

	private renderRecentThresholdFilter(isFetching: boolean) {
		const threshold = this._inactiveOverviewState.filter.recent?.threshold;
		const label = recentThresholdItems.find(o => o.value === threshold)?.label ?? recentThresholdItems[1].label;
		return html`
			<gl-menu-popover
				slot="heading-actions"
				placement="bottom-end"
				?disabled=${isFetching}
				.items=${recentThresholdItems.map(o => ({
					value: o.value,
					label: o.label,
					selected: o.value === threshold,
				}))}
				@gl-menu-select=${this.onChangeRecentThresholdFilter}
			>
				<button
					slot="anchor"
					class="threshold-filter"
					type="button"
					?disabled=${isFetching}
					aria-label="Change Recent Timeframe"
				>
					${label}<code-icon icon="chevron-down"></code-icon>
				</button>
			</gl-menu-popover>
		`;
	}

	private readonly onChangeRecentThresholdFilter = (e: CustomEvent<{ value: string }>) => {
		if (!this._inactiveOverviewState.filter.stale || !this._inactiveOverviewState.filter.recent) {
			return;
		}

		void this._homeCtx.homeService?.setOverviewFilter({
			stale: this._inactiveOverviewState.filter.stale,
			recent: {
				...this._inactiveOverviewState.filter.recent,
				threshold: e.detail.value as OverviewRecentThreshold,
			},
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
				${this.renderTabs()} ${this.renderRecentThresholdFilter(isFetching)}
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
		const branches = this.filterAgentBranches(overview.recent);
		const unrepresentedSessions = this._agentFilter === 'all' ? this.getUnrepresentedAgentSessions(branches) : [];

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

	private filterAgentBranches(branches: GetOverviewBranch[]): GetOverviewBranch[] {
		if (this._agentFilter === 'all') return branches;

		// Sessions associate with worktrees, keyed by full path. Build the set of worktree paths
		// the rendered branches occupy, then keep only branches whose worktree matches a session.
		// Match by `worktreePath` (stable identifier set by host's `resolveGitInfo`) — not
		// `workspacePath`, which is the matched workspace folder, not a repo identifier.
		// A branch with `worktree == null` is "not checked out anywhere" in Home's wire format
		// (the default-worktree branch always carries `worktree.path === repoPath`), so it can't
		// host an agent and is excluded from the join — previously these branches fell back to
		// `repoPath` and false-matched the default-worktree session.
		const sessions = this._homeCtx.agentSessions.get() ?? [];
		const branchWorktreePaths = new Set<string>();
		for (const branch of branches) {
			if (branch.worktree?.path != null) {
				branchWorktreePaths.add(branch.worktree.path);
			}
		}
		const sessionWorktreePaths = new Set<string>();
		for (const session of sessions) {
			if (session.worktreePath != null && branchWorktreePaths.has(session.worktreePath)) {
				sessionWorktreePaths.add(session.worktreePath);
			}
		}

		return branches.filter(b => b.worktree?.path != null && sessionWorktreePaths.has(b.worktree.path));
	}

	private getUnrepresentedAgentSessions(renderedBranches: GetOverviewBranch[]): AgentSessionState[] {
		const sessions = this._homeCtx.agentSessions.get() ?? [];
		if (sessions.length === 0) return [];

		// A session is "unrepresented" if its worktree path doesn't match any rendered branch's
		// worktree. Foreign-repo sessions naturally fall into this bucket because their worktree
		// paths don't appear in this repo's branch set. No-worktree branches contribute nothing
		// to the rendered set — otherwise the default-worktree session would be falsely
		// "represented" by any uncheckedout branch and never surface as its own card.
		const renderedWorktreePaths = new Set<string>();
		for (const branch of renderedBranches) {
			if (branch.worktree?.path != null) {
				renderedWorktreePaths.add(branch.worktree.path);
			}
		}
		return sessions.filter(s => s.worktreePath == null || !renderedWorktreePaths.has(s.worktreePath));
	}

	private renderAgentSessionCards(sessions: AgentSessionState[]): unknown {
		if (sessions.length === 0) return nothing;

		const groups = new Map<string, AgentSessionState[]>();
		for (const session of sessions) {
			// Group by `worktreePath` so sessions in the same worktree always share a card,
			// regardless of which workspace folder Claude Code happened to match on launch.
			// Fall back through `workspacePath` then `cwd` so cold-cache sessions still get a
			// group rather than collapsing into 'unknown'.
			const key = session.worktreePath || session.workspacePath || session.cwd || 'unknown';
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
					.labelType=${groupSessions[0].worktreePath || groupSessions[0].workspacePath ? 'workspace' : 'cwd'}
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
