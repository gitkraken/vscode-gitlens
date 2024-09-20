import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getApplicablePromo } from '../../../../plus/gk/account/promos';
import type { State } from '../../../home/protocol';
import { linkBase } from '../../shared/components/styles/lit/base.css';
import { stateContext } from '../context';
import { homeBaseStyles, inlineNavStyles } from '../home.css';
import '../../shared/components/code-icon';
import '../../shared/components/overlays/tooltip';
import '../../shared/components/promo';

@customElement('gl-home-nav')
export class GlHomeNav extends LitElement {
	static override styles = [
		linkBase,
		homeBaseStyles,
		inlineNavStyles,
		css`
			:host {
				display: block;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	override render() {
		return html`
			<gl-promo
				.promo=${getApplicablePromo(this._state.subscription.state)}
				class="promo-banner promo-banner--eyebrow"
				id="promo"
				type="link"
			></gl-promo>
			<nav class="inline-nav" id="links" aria-label="Help and Resources">
				<div class="inline-nav__group">
					<gl-tooltip hoist>
						<a
							class="inline-nav__link inline-nav__link--text"
							href="https://help.gitkraken.com/gitlens/gitlens-release-notes-current/"
							aria-label="What's New"
							><code-icon icon="megaphone"></code-icon><span>What's New</span></a
						>
						<span slot="content">What's New</span>
					</gl-tooltip>
					<gl-tooltip hoist>
						<a
							class="inline-nav__link inline-nav__link--text"
							href="https://help.gitkraken.com/gitlens/gitlens-home/"
							aria-label="Help Center"
							><code-icon icon="question"></code-icon><span>Help</span></a
						>
						<span slot="content">Help Center</span>
					</gl-tooltip>
					<gl-tooltip hoist>
						<a
							class="inline-nav__link inline-nav__link--text"
							href="https://github.com/gitkraken/vscode-gitlens/issues"
							aria-label="Feedback"
							><code-icon icon="feedback"></code-icon><span>Feedback</span></a
						>
						<span slot="content">Feedback</span>
					</gl-tooltip>
				</div>
				<div class="inline-nav__group">
					<gl-tooltip hoist>
						<a
							class="inline-nav__link"
							href="https://github.com/gitkraken/vscode-gitlens/discussions"
							aria-label="GitHub Discussions"
							><code-icon icon="comment-discussion"></code-icon
						></a>
						<span slot="content">GitHub Discussions</span>
					</gl-tooltip>
					<gl-tooltip hoist>
						<a
							class="inline-nav__link"
							href="https://github.com/gitkraken/vscode-gitlens"
							aria-label="GitHub Repo"
							><code-icon icon="github"></code-icon
						></a>
						<span slot="content">GitHub Repo</span>
					</gl-tooltip>
					<gl-tooltip hoist>
						<a class="inline-nav__link" href="https://twitter.com/gitlens" aria-label="@gitlens on Twitter"
							><code-icon icon="twitter"></code-icon
						></a>
						<span slot="content">@gitlens on Twitter</span>
					</gl-tooltip>
					<gl-tooltip hoist>
						<a
							class="inline-nav__link"
							href=${'https://gitkraken.com/gitlens?utm_source=gitlens-extension&utm_medium=in-app-links&utm_campaign=gitlens-logo-links'}
							aria-label="GitLens Website"
							><code-icon icon="globe"></code-icon
						></a>
						<span slot="content">GitLens Website</span>
					</gl-tooltip>
				</div>
			</nav>
		`;
	}
}
