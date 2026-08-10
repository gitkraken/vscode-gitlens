import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { Source } from '../../../../constants.telemetry.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { GraphShowAction } from '../../../plus/graph/protocol.js';
import { ChooseAccountOrgCommand, ChooseRepositoryCommand } from '../../../plus/graph/protocol.js';
import { featureGateContentStyles } from '../../shared/components/feature-gate.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import { subscriptionContext } from '../../shared/contexts/subscription.js';
import type { SubscriptionContextState } from '../../shared/contexts/subscription.js';
import { linkStyles } from '../shared/components/vscode.css.js';
import { graphStateContext } from './context.js';
import { getIntentSourceDetail, intentCopyByAction } from './intentCopy.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/feature-gate.js';
import '../../shared/components/gitlens-logo-circle.js';

@customElement('gl-graph-gate')
export class GlGraphGate extends SignalWatcher(LitElement) {
	static override styles = [linkStyles, featureGateContentStyles];

	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	/** The task that brought the user here (parked by the app while gated) — selects the gate copy;
	 *  actions without task copy fall back to the generic Commit Graph pitch. */
	@property({ attribute: false })
	intentAction?: GraphShowAction;

	override render() {
		const orgCount = this._subscription.organizationsCount.get();
		const copy = this.intentAction != null ? intentCopyByAction[this.intentAction] : undefined;
		const source: Source = { source: 'graph', detail: getIntentSourceDetail('gate', this.intentAction) };

		return html`<gl-feature-gate
			variant="sheet"
			.featurePreview=${this.graphState.featurePreview}
			featurePreviewCommandLink=${ifDefined(
				this.graphState.featurePreview
					? createCommandLink('gitlens.plus.continueFeaturePreview', {
							feature: this.graphState.featurePreview.feature,
						})
					: undefined,
			)}
			appearance="alert"
			featureRestriction="private-repos"
			featureWithArticleIfNeeded="the Commit Graph"
			?allowRepoSwitch=${this.graphState.allowRepoSwitch}
			?allowOrgSwitch=${orgCount > 1}
			.source=${source}
			.state=${this.graphState.subscription?.state}
			.webroot=${this.graphState.webroot}
			@gl-switch-repos=${this.onSwitchRepos}
			@gl-switch-orgs=${this.onSwitchOrgs}
		>
			<section slot="feature" class="feature">
				<header class="feature__header">
					<gitlens-logo-circle class="feature__feature-icon"></gitlens-logo-circle>
					<hgroup>
						<h2 class="feature__title">
							<span>${copy?.heading ?? 'All-New Commit Graph'}</span>
							<gl-feature-badge
								.source=${{ source: 'graph', detail: 'badge' } as const}
								.subscription=${this.graphState.subscription}
							></gl-feature-badge>
						</h2>
						<p class="feature__lede">
							${copy?.body ?? 'Where your development and agentic workflows come together'}
						</p>
					</hgroup>
				</header>

				<p class="feature__sub">
					<strong
						>${
							copy != null
								? 'Try the All-New Commit Graph to parallelize your workflow'
								: 'Parallelize your workflow'
						}</strong
					>
					&mdash; manage multiple active worktrees, orchestrate concurrent agents, and execute your entire Git
					lifecycle without context-switching
				</p>

				<div class="list">
					<details class="list__item">
						<summary class="list__summary">
							<span class="icon-cube"><code-icon icon="layout"></code-icon></span>
							<strong>Unified Workspace</strong>
							<code-icon class="list__chevron" icon="chevron-right"></code-icon>
						</summary>
						<span class="list__copy"
							>Centralize your workflow with the Side Bar and dockable Details Panel. Detach the graph
							into a separate window to maximize your editor space</span
						>
					</details>

					<details class="list__item">
						<summary class="list__summary">
							<span class="icon-cube"><code-icon icon="robot"></code-icon></span>
							<strong>Orchestrate Agents</strong>
							<code-icon class="list__chevron" icon="chevron-right"></code-icon>
						</summary>
						<span class="list__copy"
							>Launch, monitor, and interact with agents from the graph, Agents Side Bar, or Kanban board
							to approve permissions and view execution plans inline</span
						>
					</details>
					<details class="list__item">
						<summary class="list__summary">
							<span class="icon-cube"><code-icon icon="shield"></code-icon></span>
							<strong>Command Center</strong>
							<code-icon class="list__chevron" icon="chevron-right"></code-icon>
						</summary>
						<span class="list__copy"
							>Review changes, stage files, create or compose commits, and resolve conflicts. On a clean
							worktree the Details Panel guides your next steps—like pulling, pushing, or drafting a
							PR</span
						>
					</details>
					<details class="list__item">
						<summary class="list__summary">
							<span class="icon-cube"><code-icon icon="arrow-swap"></code-icon></span>
							<strong>Parallelize Work</strong>
							<code-icon class="list__chevron" icon="chevron-right"></code-icon>
						</summary>
						<span class="list__copy"
							>Juggle multiple active worktrees and agent sessions within a single view. Focus the graph
							on specific changes instantly to review and track where agents are working in
							real-time</span
						>
					</details>
					<details class="list__item">
						<summary class="list__summary">
							<span class="icon-cube"><code-icon icon="wand"></code-icon></span>
							<strong>AI Compose & Review</strong>
							<code-icon class="list__chevron" icon="chevron-right"></code-icon>
						</summary>
						<span class="list__copy"
							>Bring order from chaos. Restructure changes into clean, review-ready commits automatically.
							Catch issues early with severity-tagged reviews that you can delegate directly to an
							agent</span
						>
					</details>
					<details class="list__item">
						<summary class="list__summary">
							<span class="icon-cube"><code-icon icon="pulse"></code-icon></span>
							<strong>Deep Visualizations</strong>
							<code-icon class="list__chevron" icon="chevron-right"></code-icon>
						</summary>
						<span class="list__copy"
							>Analyze repo evolution with the Visual History. Pinpoint hotspots and trends or watch agent
							activity in real-time using the Files, Commits, and Agent Activity treemaps</span
						>
					</details>
				</div>
			</section>
		</gl-feature-gate>`;
	}

	private onSwitchRepos(): void {
		this._ipc.sendCommand(ChooseRepositoryCommand);
	}

	private onSwitchOrgs(): void {
		this._ipc.sendCommand(ChooseAccountOrgCommand);
	}
}
