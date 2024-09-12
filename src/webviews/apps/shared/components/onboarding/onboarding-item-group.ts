import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('gl-onboarding-item-group')
export class GlOnboardingItemGroup extends LitElement {
	static override readonly styles = css`
		:host {
			--gl-onboarding-group-indent: 10px;
		}
		:host,
		.wrapper {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		.wrapper {
			--indent: var(--gl-onboarding-group-indent);
			margin-left: var(--indent);
			width: calc(100% - var(--indent));
		}
	`;

	protected override render() {
		return html`
			<slot name="top"></slot>
			<div class="wrapper">
				<slot></slot>
			</div>
		`;
	}
}
