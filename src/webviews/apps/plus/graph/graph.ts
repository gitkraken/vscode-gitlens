import './graph.scss';
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../../../plus/webviews/graph/protocol';
import { GlApp } from '../../shared/app';
import { scrollableBase } from '../../shared/components/styles/lit/base.css';
import type { HostIpc } from '../../shared/ipc';
import { graphBaseStyles, graphStyles } from './graph.css';
import { GraphStateProvider } from './stateProvider';
import './components/graph-wrapper';

@customElement('gl-graph-app')
export class GlGraphApp extends GlApp<State> {
	static override styles = [graphBaseStyles, scrollableBase, graphStyles];

	protected override createStateProvider(state: State, ipc: HostIpc) {
		return new GraphStateProvider(this, state, ipc);
	}

	override render() {
		return html`
			<div class="graph scrollable">
				<gl-graph-wrapper .state=${this.state}></gl-graph-wrapper>
			</div>
		`;
	}
}
