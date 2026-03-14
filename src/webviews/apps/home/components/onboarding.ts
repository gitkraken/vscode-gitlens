import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { walkthroughProgressSteps } from '../../../../constants.walkthroughs.js';
import { createCommandLink } from '../../../../system/commands.js';
import { ruleStyles } from '../../plus/shared/components/vscode.css.js';
import type { OnboardingState } from '../../shared/contexts/onboarding.js';
import { onboardingContext } from '../../shared/contexts/onboarding.js';
import { homeBaseStyles, walkthroughProgressStyles } from '../home.css.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/tooltip.js';

@customElement('gl-onboarding')
export class GlOnboarding extends SignalWatcher(LitElement) {
	@consume({ context: onboardingContext })
	private _onboarding!: OnboardingState;

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

	private get isWalkthroughComplete(): boolean {
		const progress = this._onboarding.walkthroughProgress.get();
		return progress != null && progress.doneCount === progress.allCount;
	}

	override render(): unknown {
		const progress = this._onboarding.walkthroughProgress.get();
		if (progress == null) return undefined;

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
						<span>GitLens Walkthrough (${progress.doneCount}/${progress.allCount})</span>
					</header>
					<progress class="walkthrough-progress__bar" value=${progress.progress}></progress>
				</a>
				<div slot="content">
					<div>Open Walkthrough</div>
					<hr />
					${this.renderWalkthroughProgress()}
				</div>
			</gl-tooltip>`;
	}

	private renderWalkthroughProgress(): unknown {
		const progress = this._onboarding.walkthroughProgress.get();
		if (progress == null) return undefined;

		return html`<p class="walkthrough-progress__label">
				Walkthrough Progress (${progress.doneCount}/${progress.allCount})
			</p>
			<ul class="walkthrough-progress__steps">
				${Object.entries(walkthroughProgressSteps).map(([key, label]) => {
					const isCompleted = progress.state[key as keyof typeof walkthroughProgressSteps];
					return html`<li class="walkthrough-progress__step ${isCompleted ? 'completed' : ''}">
						<code-icon icon="${isCompleted ? 'pass' : 'circle-large'}"></code-icon>
						<span class="walkthrough-progress__step-label">${label}</span>
					</li>`;
				})}
			</ul>`;
	}

	private onDismissWalkthrough = () => {
		this._onboarding.walkthroughProgress.set(undefined);
		this._onboarding.dismissWalkthrough();
	};
}
