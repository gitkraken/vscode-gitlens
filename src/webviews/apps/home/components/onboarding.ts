import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
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

	@property({ type: Boolean })
	private slim = false;

	@query('#open-walkthrough')
	private _openWalkthroughButton!: GlButton;

	override render() {
		if (!this._state.showWalkthroughProgress) {
			return undefined;
		}

		return html`
			<gl-tooltip placement="bottom" content="Open Walkthrough">
				<a href=${createCommandLink('gitlens.openWalkthrough', {})}>
					<section class="walkthrough-progress">
						${!this.slim
							? html`
									<header class="walkthrough-progress__title">
										<span
											>GitLens Walkthrough
											(${this._state.walkthroughProgress.doneCount}/${this._state
												.walkthroughProgress.allCount})</span
										>
										<nav>
											<gl-button
												@click=${this.onDismissWalkthrough.bind(this)}
												class="walkthrough-progress__button"
												appearance="toolbar"
												tooltip="Dismiss"
												aria-label="Dismiss"
												><code-icon icon="x"></code-icon
											></gl-button>
										</nav>
									</header>
							  `
							: nothing}
						<progress
							class="walkthrough-progress__bar"
							value=${this._state.walkthroughProgress.progress}
						></progress>
					</section>
				</a>
			</gl-tooltip>
		`;
	}

	private onDismissWalkthrough() {
		this._state.showWalkthroughProgress = false;
		this.requestUpdate();
		this._ipc.sendCommand(DismissWalkthroughSection);
	}
}
