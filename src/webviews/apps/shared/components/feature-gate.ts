import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SubscriptionState } from '../../../../constants.subscription';
import type { Source } from '../../../../constants.telemetry';
import type { FeaturePreview } from '../../../../features';
import { isSubscriptionStatePaidOrTrial } from '../../../../plus/gk/account/subscription';
import '../../plus/shared/components/feature-gate-plus-state';
import { linkStyles } from '../../plus/shared/components/vscode.css';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-gate': GlFeatureGate;
	}

	// interface GlobalEventHandlersEventMap {}
}

@customElement('gl-feature-gate')
export class GlFeatureGate extends LitElement {
	static override styles = [
		linkStyles,
		css`
			:host {
				--background: var(--vscode-sideBar-background);
				--foreground: var(--vscode-sideBar-foreground);

				position: absolute;
				top: 0;
				left: 0;
				bottom: 0;
				right: 0;
				overflow: auto;
				z-index: 100;

				box-sizing: border-box;
			}

			:host-context(body[data-placement='editor']),
			:host([appearance='alert']) {
				--background: transparent;
				--foreground: var(--vscode-editor-foreground);

				backdrop-filter: blur(3px) saturate(0.8);
				padding: 0 2rem;
			}

			::slotted(p) {
				margin: revert !important;
			}

			::slotted(p:first-child) {
				margin-top: 0 !important;
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

			:host-context(body[data-placement='editor']) section,
			:host([appearance='alert']) section {
				--section-foreground: var(--color-alert-foreground);
				--section-background: var(--color-alert-infoBackground);
				--section-border-color: var(--color-alert-infoBorder);

				--link-decoration-default: underline;
				--link-foreground: var(--vscode-foreground);
				/* --link-foreground-active: var(--vscode-foreground); */

				/* --link-foreground: var(--vscode-textLink-foreground); */
				--link-foreground-active: var(--vscode-textLink-activeForeground);

				border-radius: 0.3rem;
				max-width: 600px;
				max-height: min-content;
				margin: 0.2rem auto;
				padding: 1.3rem;
			}

			:host-context(body[data-placement='editor']) section ::slotted(gl-button),
			:host([appearance='alert']) section ::slotted(gl-button) {
				display: block;
				margin-left: auto;
				margin-right: auto;
			}
		`,
	];

	@property({ reflect: true })
	appearance?: 'alert' | 'welcome';

	@property({ type: Object })
	featurePreview?: FeaturePreview;

	@property({ type: String })
	featurePreviewCommandLink?: string;

	@property()
	featureWithArticleIfNeeded?: string;

	@property({ type: Object })
	source?: Source;

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	@property({ type: Boolean })
	visible?: boolean;

	@property({ type: String })
	webroot?: string;

	override render() {
		if (!this.visible || (this.state != null && isSubscriptionStatePaidOrTrial(this.state))) {
			this.hidden = true;
			return undefined;
		}

		const appearance =
			this.appearance ?? (document.body.getAttribute('data-placement') ?? 'editor') === 'editor'
				? 'alert'
				: 'welcome';

		this.hidden = false;

		return html`
			<section>
				<slot></slot>
				<gl-feature-gate-plus-state
					appearance=${appearance}
					.featurePreview=${this.featurePreview}
					.featurePreviewCommandLink=${this.featurePreviewCommandLink}
					.featureWithArticleIfNeeded=${this.featureWithArticleIfNeeded}
					.source=${this.source}
					.state=${this.state}
					.webroot=${this.webroot}
				>
					<slot name="feature" slot="feature"></slot>
				</gl-feature-gate-plus-state>
			</section>
		`;
	}
}
