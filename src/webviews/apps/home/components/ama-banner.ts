import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { OnboardingState } from '../../shared/contexts/onboarding.js';
import { onboardingContext } from '../../shared/contexts/onboarding.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/card/card.js';

@customElement('gl-ama-banner')
export class GlAmaBanner extends SignalWatcher(LitElement) {
	@consume({ context: onboardingContext })
	private _onboarding!: OnboardingState;

	static override styles = [
		linkBase,
		css`
			:host {
				margin-inline: 1.2rem;
			}
			h4 {
				font-weight: normal;
				margin-block-end: 0.4em;
			}

			p {
				margin-block: 0;
				color: var(--vscode-descriptionForeground);
			}
		`,
	];

	@state()
	private closed = false;

	override render() {
		if (this.closed || this._onboarding.banners.amaBanner === true) return nothing;

		const url =
			'https://www.gitkraken.com/lp/gitlensama?utm_source=githubdiscussion&utm_medium=hyperlink&utm_campaign=GLAMA&utm_id=GLAMA';
		return html`
			<gl-card indicator="info">
				<h4>Live AMA w/ the creator of GitLens</h4>
				<p>Feb 13 @ 1pm EST &mdash; <a href="${url}">Register now</a></p>
				<gl-button slot="actions" appearance="toolbar" tooltip="Dismiss" @click=${() => this.onClose()}
					><code-icon icon="close"></code-icon
				></gl-button>
			</gl-card>
		`;
	}

	private onClose() {
		this.closed = true;
		this._onboarding.banners.amaBanner = true;

		this._onboarding.dismiss('amaBanner');
	}
}
