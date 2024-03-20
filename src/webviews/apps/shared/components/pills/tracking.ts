import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { baseStyles } from './pill.css';
import '../code-icon';

@customElement('gl-tracking-pill')
export class GlTrackingPill extends LitElement {
	static override styles = [
		baseStyles,
		css`
			.state code-icon {
				font-size: inherit !important;
				line-height: inherit !important;
			}
		`,
	];

	@property({ type: Number })
	ahead = 0;

	@property({ type: Number })
	behind = 0;

	override render() {
		if (this.ahead === 0 && this.behind === 0) return nothing;

		return html`<span class="pill"
			>${when(
				this.behind > 0,
				() => html`<span class="state">${this.behind}<code-icon icon="arrow-down"></code-icon></span>`,
			)}${when(
				this.ahead > 0,
				() => html`<span class="state">${this.ahead}<code-icon icon="arrow-up"></code-icon></span>`,
			)}</span
		>`;
	}
}
