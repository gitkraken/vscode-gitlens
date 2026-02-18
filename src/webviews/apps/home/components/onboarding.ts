import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { walkthroughProgressSteps } from '../../../../constants.walkthroughs.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { State } from '../../../home/protocol.js';
import { DismissWalkthroughSection } from '../../../home/protocol.js';
import { ruleStyles } from '../../plus/shared/components/vscode.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { HostIpc } from '../../shared/ipc.js';
import { stateContext } from '../context.js';
import { homeBaseStyles, walkthroughProgressStyles } from '../home.css.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/tooltip.js';

@customElement('gl-onboarding')
export class GlOnboarding extends LitElement {
	static override styles = [
		homeBaseStyles,
		walkthroughProgressStyles,
		ruleStyles,
		css`
			.walkthrough-progress__label {
				margin-block: 0;
			}
			.walkthrough-progress__steps {
				margin-block: 0;
				padding-inline-start: 0;
			}
			.walkthrough-progress__step {
				list-style: none;
				margin-block-start: 0.3rem;
			}
			.walkthrough-progress__step-label {
				margin-inline-start: 0.3rem;
			}
			code-icon[icon='circle-large'] {
				color: var(--color-foreground--50);
			}
			code-icon[icon='pass'] {
				color: #00dd00;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume<HostIpc>({ context: ipcContext, subscribe: true })
	@state()
	private _ipc!: HostIpc;

	private get isWalkthroughComplete(): boolean {
		const progress = this._state.walkthroughProgress;
		return progress != null && progress.doneCount === progress.allCount;
	}

	override render(): unknown {
		if (this._state.walkthroughProgress == null) return undefined;

		return html`${this.isWalkthroughComplete
				? html`<gl-button
						@click=${this.onDismissWalkthrough}
						class="walkthrough-progress__button"
						appearance="toolbar"
						tooltip="Dismiss"
						aria-label="Dismiss"
						><code-icon icon="x"></code-icon
					></gl-button>`
				: nothing}
			<gl-tooltip placement="bottom">
				<a class="walkthrough-progress" href=${createCommandLink('gitlens.showWelcomeView')}>
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
				<div slot="content">
					<div>Open Walkthrough</div>
					<hr />
					${this.renderWalkthroughProgress()}
				</div>
			</gl-tooltip>`;
	}

	private renderWalkthroughProgress(): unknown {
		if (this._state.walkthroughProgress == null) return undefined;

		return html`<p class="walkthrough-progress__label">
				Walkthrough Progress
				(${this._state.walkthroughProgress.doneCount}/${this._state.walkthroughProgress.allCount})
			</p>
			<ul class="walkthrough-progress__steps">
				${Object.entries(walkthroughProgressSteps).map(([key, label]) => {
					const isCompleted =
						this._state.walkthroughProgress!.state[key as keyof typeof walkthroughProgressSteps];
					return html`<li class="walkthrough-progress__step ${isCompleted ? 'completed' : ''}">
						<code-icon icon="${isCompleted ? 'pass' : 'circle-large'}"></code-icon>
						<span class="walkthrough-progress__step-label">${label}</span>
					</li>`;
				})}
			</ul>`;
	}

	private onDismissWalkthrough = () => {
		this._state.walkthroughProgress = undefined;
		this._ipc.sendCommand(DismissWalkthroughSection);
		this.requestUpdate();
	};
}
