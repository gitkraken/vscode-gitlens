import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Commands } from '../../../../constants.commands';
import { createCommandLink } from '../../../../system/commands';
import type { State } from '../../../home/protocol';
import { DismissWalkthroughSection } from '../../../home/protocol';
import type { GlButton } from '../../shared/components/button';
import { ipcContext } from '../../shared/context';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import { homeBaseStyles, walkthroughProgressStyles } from '../home.css';
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

	@query('#open-walkthrough')
	private _openWalkthroughButton!: GlButton;

	override render() {
		if (!this._state.showWalkthroughProgress) {
			return undefined;
		}

		return html`
			<section class="walkthrough-progress" @click=${(e: MouseEvent) => this.onFallthroughClick(e)}>
				<header class="walkthrough-progress__title">
					<span
						>GitLens Walkthrough
						(${this._state.walkthroughProgress.doneCount}/${this._state.walkthroughProgress.allCount})</span
					>
					<nav>
						<gl-button
							id="open-walkthrough"
							href=${createCommandLink(Commands.OpenWalkthrough, {})}
							class="walkthrough-progress__button"
							appearance="toolbar"
							><code-icon icon="play"></code-icon
						></gl-button>
						<gl-button
							@click=${this.onDismissWalkthrough.bind(this)}
							class="walkthrough-progress__button"
							appearance="toolbar"
							><code-icon icon="x"></code-icon
						></gl-button>
					</nav>
				</header>
				<progress
					class="walkthrough-progress__bar"
					value=${this._state.walkthroughProgress.progress}
				></progress>
			</section>
		`;
	}

	private onDismissWalkthrough() {
		this._state.showWalkthroughProgress = false;
		this.requestUpdate();
		this._ipc.sendCommand(DismissWalkthroughSection);
	}

	private onFallthroughClick(e: MouseEvent) {
		if ((e.target as HTMLElement)?.closest('gl-button')) {
			return;
		}
		this._openWalkthroughButton.click();
	}
}
