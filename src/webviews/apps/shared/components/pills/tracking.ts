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
			.pill {
				gap: 0.1rem;
				text-transform: none;
			}

			.state {
				-webkit-font-smoothing: antialiased;
				-moz-osx-font-smoothing: grayscale;
			}

			.state--missing code-icon {
				color: var(--gl-tracking-missing);
			}

			.state--ahead code-icon {
				color: var(--gl-tracking-ahead);
			}

			.state--behind code-icon {
				color: var(--gl-tracking-behind);
			}

			.state--working .working {
				color: var(--gl-tracking-working);
			}

			.state code-icon {
				font-size: inherit !important;
				line-height: inherit !important;
			}

			.working {
				display: inline-block;
				width: 1rem;
				text-align: center;
				vertical-align: text-bottom;
				font-weight: normal;
			}
		`,
	];

	@property({ type: Number })
	ahead = 0;

	@property({ type: Number })
	behind = 0;

	@property({ type: Number })
	working = 0;

	@property({ type: Boolean, attribute: 'always-show' })
	alwaysShow = false;

	@property({ type: Boolean })
	outlined = false;

	@property({ type: Boolean })
	colorized = false;

	@property({ type: Boolean })
	missingUpstream = false;

	override render() {
		if (this.ahead === 0 && this.behind === 0 && this.working === 0) {
			if (!this.alwaysShow) {
				return nothing;
			}

			if (this.missingUpstream) {
				return html`<span part="base" class="pill${this.outlined ? ' pill--outlined' : ''}">
					<span class="state${this.colorized ? ' state--missing' : ''}"
						><code-icon icon="error"></code-icon></span
				></span>`;
			}

			return html`<span part="base" class="pill${this.outlined ? ' pill--outlined' : ''}">
				<span class="state${this.colorized ? ' state--ahead' : ''}"><code-icon icon="check"></code-icon></span>
			</span>`;
		}

		return html`<span part="base" class="pill${this.outlined ? ' pill--outlined' : ''}"
			>${when(
				this.behind > 0,
				() =>
					html`<span class="state${this.colorized ? ' state--behind' : ''}"
						>${this.behind}<code-icon icon="arrow-down"></code-icon
					></span>`,
			)}${when(
				this.ahead > 0,
				() =>
					html`<span class="state${this.colorized ? ' state--ahead' : ''}"
						>${this.ahead}<code-icon icon="arrow-up"></code-icon
					></span>`,
			)}${when(
				this.working > 0,
				() =>
					html`<span class="state${this.colorized ? ' state--working' : ''}"
						>${this.working}<span class="working">&#177;</span></span
					>`,
			)}</span
		>`;
	}
}
