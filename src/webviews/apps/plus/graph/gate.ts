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

			.intro__features {
				list-style: none;
				margin-block: 0.6rem;
				margin-inline: 0;
				padding: 1.2rem;
				display: flex;
				flex-direction: column;
				gap: 1.2rem;
				background: color-mix(in srgb, #000 18%, transparent);
				border-radius: 0.6rem;
			}

			.intro__feature {
				display: flex;
				align-items: flex-start;
				gap: 0.8rem;
				line-height: 1.5;
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
					Where your development and agentic workflows come together. Go beyond history visualization to
					manage, execute, and parallelize your entire Git workflow.
				</p>
				<ul class="intro__features">
					<li class="intro__feature">
						<code-icon icon="pass"></code-icon>
						<span
							><strong>Deep Visualization:</strong> Instantly search commits, branches, files, and code
							changes across your entire repository history.</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="pass"></code-icon>
						<span
							><strong>Visual Command Center:</strong> Compare branches, review PRs, and compose commits
							directly from the interactive canvas.</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="pass"></code-icon>
						<span
							><strong>Parallel Worktrees:</strong> Manage multiple active branches side-by-side and run
							coding agents concurrently without stashing or context-switching.</span
						>
					</li>
					<li class="intro__feature">
						<code-icon icon="pass"></code-icon>
						<span
							><strong>Agentic Workflows:</strong> Launch AI coding agents to automate complex development
							tasks and track their live execution progress directly on the graph.</span
						>
					</li>
				</ul>
			</div>
		</gl-feature-gate>`;
	}
}
