import { consume } from '@lit/context';
import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { State } from '../../../../plus/webviews/graph/protocol';
import { GlElement } from '../../shared/components/element';
import { stateContext } from './stateProvider';

import '../../shared/components/feature-badge';
import '../../shared/components/feature-gate';

@customElement('gl-graph-gate')
export class GlGraphHeader extends GlElement {
	static override styles = [];

	@consume({ context: stateContext, subscribe: true })
	@state()
	state!: State;

	override render() {
		return html`<gl-feature-gate
			class="graph-app__gate"
			appearance="alert"
			.featureWithArticleIfNeeded=${'the Commit Graph'}
			.source=${{ source: 'graph', detail: 'gate' }}
			.state=${this.state.subscription?.state}
			?visible=${!this.state.allowed}
		>
			<p slot="feature">
				<a href="https://help.gitkraken.com/gitlens/gitlens-features/#commit-graph-pro">Commit Graph</a>
				<gl-feature-badge
					.source=${{ source: 'graph', detail: 'badge' }}
					.subscription=${this.state.subscription}
				></gl-feature-badge
				>&nbsp; &mdash; easily visualize your repository and keep track of all work in progress. Use the rich
				commit search to find a specific commit, message, author, a changed file or files, or even a specific
				code change.
			</p>
		</gl-feature-gate>`;
	}
}
