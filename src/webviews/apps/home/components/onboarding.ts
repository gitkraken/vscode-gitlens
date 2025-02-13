import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { OpenWalkthroughCommandArgs } from '../../../../commands/walkthroughs';
import { createCommandLink } from '../../../../system/commands';
import type { State } from '../../../home/protocol';
import { DismissWalkthroughSection } from '../../../home/protocol';
import { ipcContext } from '../../shared/contexts/ipc';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import { homeBaseStyles, walkthroughProgressStyles } from '../home.css';
import '../../shared/components/button';
import '../../shared/components/code-icon';
import '../../shared/components/overlays/tooltip';

@customElement('gl-onboarding')
export class GlOnboarding extends LitElement {
	static override styles = [homeBaseStyles, walkthroughProgressStyles];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume<HostIpc>({ context: ipcContext, subscribe: true })
	@state()
	private _ipc!: HostIpc;

	override render(): unknown {
		if (this._state.walkthroughProgress == null) return undefined;

		return html`<gl-button
				@click=${this.onDismissWalkthrough}
				class="walkthrough-progress__button"
				appearance="toolbar"
				tooltip="Dismiss"
				aria-label="Dismiss"
				><code-icon icon="x"></code-icon
			></gl-button>
			<gl-tooltip placement="bottom" content="Open Walkthrough">
				<a
					class="walkthrough-progress"
					href=${createCommandLink<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
						source: { source: 'home', detail: 'onboarding' },
					})}
				>
					<header class="walkthrough-progress__title">
						<span
							>GitLens Walkthrough
							(${this._state.walkthroughProgress.doneCount}/${this._state.walkthroughProgress
								.allCount})</span
						>
					</header>
					<progress
						class="walkthrough-progress__bar"
						value=${this._state.walkthroughProgress.progress}
					></progress>
				</a>
			</gl-tooltip>`;
	}

	private onDismissWalkthrough = () => {
		this._state.walkthroughProgress = undefined;
		this._ipc.sendCommand(DismissWalkthroughSection);
		this.requestUpdate();
	};
}
