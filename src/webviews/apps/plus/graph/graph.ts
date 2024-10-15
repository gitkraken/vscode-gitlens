import './graph.scss';
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../../../plus/webviews/graph/protocol';
import { GlApp } from '../../shared/app';
import { scrollableBase } from '../../shared/components/styles/lit/base.css';
import type { HostIpc } from '../../shared/ipc';
import { graphAppStyles } from './graph.css';
import { GraphStateProvider } from './stateProvider';
import './graph-header';
import './graph-wrapper';

@customElement('gl-graph-app')
export class GlGraphApp extends GlApp<State> {
	static override styles = [graphAppStyles, scrollableBase];

	protected override createStateProvider(state: State, ipc: HostIpc) {
		return new GraphStateProvider(this, state, ipc);
	}

	override render() {
		return html`
			<div class="graph scrollable">
				<gl-graph-header></gl-graph-header>
				<div>
					<gl-graph-gate></gl-graph-gate>
					<main>
						<gl-graph-wrapper></gl-graph-wrapper>
						<!-- future: commit details -->
					</main>
				</div>
			</div>
		`;
	}
}
