import { consume } from '@lit/context';
import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createWebviewCommandLink } from '../../../../system/webview';
import type { State } from '../../../plus/graph/protocol';
import { GlElement } from '../../shared/components/element';
import { stateContext } from './context';
import '../../shared/components/feature-badge';
import '../../shared/components/feature-gate';

@customElement('gl-graph-gate')
export class GlGraphGate extends GlElement {
	static override styles = css`
		gl-feature-gate gl-feature-badge {
			vertical-align: super;
			margin-left: 0.4rem;
			margin-right: 0.4rem;
		}
	`;

	@consume({ context: stateContext, subscribe: true })
	@state()
	state!: State;

	override render() {
		return html`<gl-feature-gate
			.featurePreview=${this.state.featurePreview}
			featurePreviewCommandLink=${ifDefined(
				this.state.featurePreview
					? createWebviewCommandLink(
							'gitlens.plus.continueFeaturePreview',
							this.state.webviewId,
							this.state.webviewInstanceId,
							{ feature: this.state.featurePreview.feature },
					  )
					: undefined,
			)}
			appearance="alert"
			featureWithArticleIfNeeded="the Commit Graph"
			.source=${{ source: 'graph', detail: 'gate' } as const}
			.state=${this.state.subscription?.state}
			.webroot=${this.state.webroot}
			?visible=${!this.state.allowed}
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
