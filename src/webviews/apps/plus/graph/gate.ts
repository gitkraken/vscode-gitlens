import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createCommandLink } from '../../../../system/commands.js';
import { ChooseRepositoryCommand } from '../../../plus/graph/protocol.js';
import { featureGateContentStyles } from '../../shared/components/feature-gate.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import { linkStyles } from '../shared/components/vscode.css.js';
import { graphStateContext } from './context.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/feature-gate.js';

@customElement('gl-graph-gate')
export class GlGraphGate extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		featureGateContentStyles,
		css`
			gl-feature-gate::part(section) {
				width: 90vw;
				max-width: 90rem;
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	override render() {
		return html`<gl-feature-gate
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
			?hidden=${this.graphState.allowed !== false}
			.source=${{ source: 'graph', detail: 'gate' } as const}
			.state=${this.graphState.subscription?.state}
			.webroot=${this.graphState.webroot}
			@gl-switch-repos=${this.onSwitchRepos}
		>
			<section slot="feature" class="feature">
				<header class="feature__header">
					<div class="icon-cube feature__feature-icon"><code-icon icon="gl-gitlens"></code-icon></div>
					<hgroup>
						<h2 class="feature__title">
							<span>Try the All-New Commit Graph</span>
							<gl-feature-badge
								.source=${{ source: 'graph', detail: 'badge' } as const}
								.subscription=${this.graphState.subscription}
							></gl-feature-badge>
						</h2>
						<p class="feature__lede">Where your development and agentic workflows come together</p>
					</hgroup>
				</header>

				<p class="feature__sub">
					Parallelize your workflow—manage multiple active worktrees, orchestrate concurrent agents, and
					execute your entire Git lifecycle without context-switching
				</p>

				<ul class="list">
					<li class="list__item">
						<span class="icon-cube"><code-icon icon="layout"></code-icon></span>
						<span class="list__copy"
							><strong>Unified Workspace</strong> Centralize your workflow with the Side Bar and dockable
							Details Panel. Detach the graph into a separate window to maximize your editor space</span
						>
					</li>

					<li class="list__item">
						<span class="icon-cube"><code-icon icon="robot"></code-icon></span>
						<span class="list__copy"
							><strong>Orchestrate Agents</strong> Launch, monitor, and interact with agents from the
							graph, Agents Side Bar, or Kanban board to approve permissions and view execution plans
							inline</span
						>
					</li>
					<li class="list__item">
						<span class="icon-cube"><code-icon icon="shield"></code-icon></span>
						<span class="list__copy"
							><strong>Command Center</strong> Review changes, stage files, create or compose commits, and
							resolve conflicts. On a clean worktree the Details Panel guides your next steps—like
							pulling, pushing, or drafting a PR</span
						>
					</li>
					<li class="list__item">
						<span class="icon-cube"><code-icon icon="arrow-swap"></code-icon></span>
						<span class="list__copy"
							><strong>Parallelize Work</strong> Juggle multiple active worktrees and agent sessions
							within a single view. Focus the graph on specific changes instantly to review and track
							where agents are working in real-time</span
						>
					</li>
					<li class="list__item">
						<span class="icon-cube"><code-icon icon="wand"></code-icon></span>
						<span class="list__copy"
							><strong>AI Compose & Review</strong> Bring order from chaos. Restructure changes into
							clean, review-ready commits automatically. Catch issues early with severity-tagged reviews
							that you can delegate directly to an agent</span
						>
					</li>
					<li class="list__item">
						<span class="icon-cube"><code-icon icon="pulse"></code-icon></span>
						<span class="list__copy"
							><strong>Deep Visualizations</strong> Analyze repo evolution with the Visual History.
							Pinpoint hotspots and trends or watch agent activity in real-time using the Files, Commits,
							and Agent Activity treemaps</span
						>
					</li>
				</ul>
			</section>
		</gl-feature-gate>`;
	}

	private onSwitchRepos(): void {
		this._ipc.sendCommand(ChooseRepositoryCommand);
	}
}
