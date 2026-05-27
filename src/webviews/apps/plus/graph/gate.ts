import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createCommandLink } from '../../../../system/commands.js';
import { linkStyles } from '../shared/components/vscode.css.js';
import { graphStateContext } from './context.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/feature-gate.js';

@customElement('gl-graph-gate')
export class GlGraphGate extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		css`
			gl-feature-gate::part(section) {
				width: 90vw;
				max-width: 90rem;
			}

			.intro {
				display: flex;
				flex-direction: column;
				gap: 1rem;
				margin-block: 0.2rem 1.2rem;
			}

			.intro__title {
				display: flex;
				align-items: baseline;
				flex-wrap: wrap;
				gap: 0.6rem;
				margin: 0;
				font-size: 1.6rem;
				font-weight: 600;
				line-height: 1.2;
			}

			.intro__title gl-feature-badge {
				margin: 0;
				transform: translateY(-0.4rem);
			}

			.intro__lede {
				margin: 0;
				color: var(--color-foreground--85);
				line-height: 1.5;
			}

			.intro__lede--sub {
				display: inline-block;
				margin: 0;
				color: var(--color-foreground--85);
				line-height: 1.5;
				font-size: 1.1rem;
			}

			.intro__features {
				list-style: none;
				margin-block: 0.6rem;
				margin-inline: 0;
				padding: 1.2rem;
				display: grid;
				grid-template-columns: repeat(2, 1fr);
				gap: 1.2rem;
				background: color-mix(in srgb, #000 18%, transparent);
				border-radius: 0.6rem;
			}

			.intro__feature {
				display: flex;
				align-items: flex-start;
				gap: 0.8rem;
				line-height: 1.5;
				font-size: 1.1rem;
				opacity: 0.9;
			}

			.intro__feature strong {
				text-transform: uppercase;
				margin-right: 0.4rem;
				font-size: 1.2rem;
				opacity: 1;
			}

			.intro__feature code-icon {
				color: var(--vscode-textLink-foreground);
				margin-top: 0.2rem;
				flex-shrink: 0;
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

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
			?hidden=${this.graphState.allowed !== false}
			.source=${{ source: 'graph', detail: 'gate' } as const}
			.state=${this.graphState.subscription?.state}
			.webroot=${this.graphState.webroot}
		>
			<div slot="feature" class="intro">
				<h2 class="intro__title">
					<span>Try the All-New Commit Graph</span>
					<gl-feature-badge
						.source=${{ source: 'graph', detail: 'badge' } as const}
						subscription="{subscription}"
					></gl-feature-badge>
				</h2>
				<p class="intro__lede">
					Where your development and agentic workflows come together
					<span class="intro__lede--sub"
						>Parallelize your workflow—manage multiple active worktrees, orchestrate concurrent agents, and
						execute your entire Git lifecycle without context-switching</span
					>
				</p>
				<ul class="intro__features">
					<li class="intro__feature">
						<code-icon icon="layout"></code-icon>
						<span
							><strong>Unified Workspace</strong> Centralize your workflow with the Side Bar and dockable
							Details Panel. Detach the graph into a separate window to maximize your editor space</span
						>
					</li>

					<li class="intro__feature">
						<code-icon icon="robot"></code-icon>
						<span
							><strong>Orchestrate Agents</strong> Launch, monitor, and interact with agents from the
							graph, Agents Side Bar, or Kanban board to approve permissions and view execution plans
							inline</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="shield"></code-icon>
						<span
							><strong>Command Center</strong> Review changes, stage files, create or compose commits, and
							resolve conflicts. On a clean worktree the Details Panel guides your next steps—like
							pulling, pushing, or drafting a PR</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="arrow-swap"></code-icon>
						<span
							><strong>Parallelize Work</strong> Juggle multiple active worktrees and agent sessions
							within a single view. Focus the graph on specific changes instantly to review and track
							where agents are working in real-time</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="wand"></code-icon>
						<span
							><strong>AI Compose & Review</strong> Bring order from chaos. Restructure changes into
							clean, review-ready commits automatically. Catch issues early with severity-tagged reviews
							that you can delegate directly to an agent</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="pulse"></code-icon>
						<span
							><strong>Deep Visualizations</strong> Analyze repo evolution with the Visual History.
							Pinpoint hotspots and trends or watch agent activity in real-time using the Files, Commits,
							and Agent Activity treemaps</span
						>
					</li>
				</ul>
			</div>
		</gl-feature-gate>`;
	}
}
