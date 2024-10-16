import './graph.scss';
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../../../plus/webviews/graph/protocol';
import { GlApp } from '../../shared/app';
import type { HostIpc } from '../../shared/ipc';
import { graphAppStyles, graphBaselineStyles } from './graph.css';
import { GraphStateProvider } from './stateProvider';
import './graph-header';
import './graph-wrapper';

@customElement('gl-graph-app')
export class GlGraphApp extends GlApp<State> {
	static override styles = [graphBaselineStyles, graphAppStyles];

	protected override createStateProvider(state: State, ipc: HostIpc) {
		return new GraphStateProvider(this, state, ipc);
	}

	override render() {
		return html`
			<div class="graph">
				<gl-graph-header class="graph__header"></gl-graph-header>
				<div class="graph__workspace">
					<gl-graph-gate></gl-graph-gate>
					<main class="graph__panes">
						<gl-graph-wrapper></gl-graph-wrapper>
						<!-- future: commit details -->
					</main>
				</div>
			</div>
		`;
	}
}
