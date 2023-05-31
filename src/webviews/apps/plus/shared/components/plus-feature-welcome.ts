import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { isSubscriptionStatePaidOrTrial, SubscriptionState } from '../../../../../subscription';
import './plus-feature-gate';

@customElement('plus-feature-welcome')
export class PlusFeatureWelcome extends LitElement {
	static override styles = css`
		:host {
			--background: var(--vscode-sideBar-background);
			--foreground: var(--vscode-sideBar-foreground);
			--link-foreground: var(--vscode-textLink-foreground);
			--link-foreground-active: var(--vscode-textLink-activeForeground);

			position: absolute;
			top: 0;
			left: 0;
			bottom: 0;
			right: 0;
			font-size: 1.3rem;
			overflow: auto;
			z-index: 100;

			box-sizing: border-box;
		}

		:host-context(body[data-placement='editor']) {
			--background: transparent;
			--foreground: var(--vscode-editor-foreground);

			backdrop-filter: blur(3px) saturate(0.8);
			padding: 0 2rem;
		}

		section {
			--section-foreground: var(--foreground);
			--section-background: var(--background);
			--section-border-color: transparent;

			display: flex;
			flex-direction: column;
			padding: 0 2rem 1.3rem 2rem;
			background: var(--section-background);
			color: var(--section-foreground);
			border: 1px solid var(--section-border-color);

			height: min-content;
		}

		:host-context(body[data-placement='editor']) section {
			--section-foreground: var(--color-alert-foreground);
			--section-background: var(--color-alert-infoBackground);
			--section-border-color: var(--color-alert-infoBorder);

			--link-decoration-default: underline;
			--link-foreground: var(--vscode-foreground);
			--link-foreground-active: var(--vscode-foreground);

			border-radius: 0.3rem;
			max-width: 600px;
			max-height: min-content;
			margin: 0.2rem auto;
			padding: 0 1.3rem;
		}
	`;

	@property({ type: Boolean })
	allowed?: boolean;

	@property({ type: Number })
	state?: SubscriptionState;

	@property({ reflect: true })
	get appearance() {
		return (document.body.getAttribute('data-placement') ?? 'editor') === 'editor' ? 'alert' : 'welcome';
	}

	override render() {
		if (this.allowed || this.state == null || isSubscriptionStatePaidOrTrial(this.state)) {
			this.hidden = true;
			return undefined;
		}

		this.hidden = false;
		return html`
			<section>
				<slot hidden=${this.state === SubscriptionState.Free ? nothing : ''}></slot>
				<plus-feature-gate appearance=${this.appearance} state=${this.state}></plus-feature-gate>
			</section>
		`;
	}
}
