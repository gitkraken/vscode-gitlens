import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createWebviewCommandLink } from '../../../../system/webview';
import { GlElement } from '../../shared/components/element';
import { linkStyles } from '../shared/components/vscode.css';
import { graphStateContext } from './context';
import '../../shared/components/feature-badge';
import '../../shared/components/feature-gate';

@customElement('gl-graph-gate')
export class GlGraphGate extends SignalWatcher(GlElement) {
	static override styles = [
		linkStyles,
		css`
			gl-feature-gate gl-feature-badge {
				vertical-align: super;
				margin-left: 0.4rem;
				margin-right: 0.4rem;
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
					? createWebviewCommandLink(
							'gitlens.plus.continueFeaturePreview',
							this.graphState.webviewId,
							this.graphState.webviewInstanceId,
							{ feature: this.graphState.featurePreview.feature },
						)
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
			<p slot="feature">
				<a href="https://help.gitkraken.com/gitlens/gitlens-features/#commit-graph-pro">Commit Graph</a>
				<gl-feature-badge
					.source=${{ source: 'graph', detail: 'badge' } as const}
					subscription="{subscription}"
				></gl-feature-badge>
				&mdash; easily visualize your repository and keep track of all work in progress. Use the rich commit
				search to find a specific commit, message, author, a changed file or files, or even a specific code
				change.
			</p>
		</gl-feature-gate>`;
	}
}
