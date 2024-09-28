import './graph.scss';
import { html } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import type { State } from '../../../../plus/webviews/graph/protocol';
import { DidFocusAccount } from '../../../../plus/webviews/graph/protocol';
import type { GlGraphWrapper } from './GraphWrapper';
import { GlApp } from '../../shared/app';
import { scrollableBase } from '../../shared/components/styles/lit/base.css';
import type { Disposable } from '../../shared/events';
import type { HostIpc } from '../../shared/ipc';
import { graphBaseStyles, graphStyles } from './graph.css';
import { GraphStateProvider } from './stateProvider';
import './GraphWrapper';

@customElement('gl-graph-app')
export class GlGraphApp extends GlApp<State> {
	static override styles = [graphBaseStyles, scrollableBase, graphStyles];
	private disposable: Disposable | undefined;

	@query('#graph-wrapper')
	private graphWrapperEl!: GlGraphWrapper;

	private badgeSource = { source: 'graph', detail: 'badge' };

	protected override createStateProvider(state: State, ipc: HostIpc) {
		return new GraphStateProvider(this, state, ipc);
	}

	override connectedCallback(): void {
		super.connectedCallback();

		this.disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidFocusAccount.is(msg):
					this.graphWrapperEl.show();
					break;
			}
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this.disposable?.dispose();
	}

	override render() {
		return html`
			<div class="graph scrollable">
				<gl-graph-wrapper id="graph-wrapper"></gl-graph-wrapper>
			</div>
		`;
	}
}
