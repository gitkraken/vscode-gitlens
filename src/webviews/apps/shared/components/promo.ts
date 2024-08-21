import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Promo } from '../../../../plus/gk/account/promos';

@customElement('gl-promo')
export class GlPromo extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}

			.promo {
				margin: 0;
				margin-top: 0.8rem;
				text-align: center;
			}

			.header {
				margin-right: 0.4rem;
			}

			.content {
				font-size: smaller;
			}

			.muted {
				opacity: 0.7;
			}

			.link {
				display: block;
				color: inherit;
				max-width: 100%;
				text-align: center;
				text-decoration: none;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.link:hover {
				color: inherit;
				text-decoration: underline;
			}
		`,
	];

	@property({ type: Object })
	promo: Promo | undefined;

	@property({ reflect: true, type: String })
	type: 'link' | 'info' = 'info';

	override render() {
		if (!this.promo) return;

		const promoHtml = this.renderPromo(this.promo);
		if (!promoHtml) return;

		if (this.type === 'link') {
			return html`<a
				class="link"
				href="${this.promo.command ?? 'command:gitlens.plus.upgrade'}"
				title="${this.promo.commandTooltip}"
				>${promoHtml}</a
			>`;
		}

		return html`<p class="promo">${promoHtml}</p>`;
	}

	private renderPromo(promo: Promo) {
		switch (promo.key) {
			case 'devexdays24':
				return html`<span class="header"><gl-svg-devexdays24-promo></gl-svg-devexdays24-promo>Sale:</span
					><span class="content"><b>Save up to 80% on GitLens Pro</b> - lowest price of the year!</span>`;

			case 'pro50':
				if (this.type === 'link') {
					return html`<span class="content"
						>Special: <b>1st seat of Pro is now 50%+ off.</b> See your special price.</span
					>`;
				}

				return html`<span class="content muted">Special: <b>1st seat of Pro is now 50%+ off</b></span>`;
		}

		return nothing;
	}
}

@customElement('gl-svg-devexdays24-promo')
export class GlSvgDevExDays24Promo extends LitElement {
	static override styles = [
		css`
			svg {
				max-width: 8rem;
				height: auto;
				vertical-align: text-bottom;
			}
		`,
	];
	override render() {
		return svg`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- a-prettier-ignore -->
			<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 138 25">
				<path
					d="M64.06 13.26c0 .73-.55 1.32-1.24 1.32-.68 0-1.24-.6-1.24-1.32 0-.73.56-1.33 1.24-1.33.69 0 1.24.6 1.24 1.33ZM29.84 19.64h-1.66l-4.2-13h1.57l3.47 11.06L32.5 6.65h1.55l-4.2 12.99ZM22.93 19.64H15.6c-1.65 0-2.43-.4-2.43-2.5v-8c0-2.1.78-2.5 2.43-2.5h5.38c1.66 0 2.44.4 2.44 2.5v2.96c0 2.1-.78 2.5-2.44 2.5h-6.3v2.51c0 1.04.33 1.06 2.14 1.06h6.1v1.47Zm-1-7.56V9.2c0-.69-.13-1.07-1.01-1.07h-5.23c-.88 0-1.01.38-1.01 1.07v3.94h6.24c.88 0 1.01-.38 1.01-1.06ZM8.79 19.64H3.4c-1.66 0-2.43-.4-2.43-2.5v-8c0-2.1.77-2.5 2.43-2.5h6.33V.75h1.48v16.4c0 2.1-.77 2.5-2.43 2.5Zm.95-2.53V8.13H3.5c-.89 0-1.02.38-1.02 1.07v7.91c0 .69.13 1.06 1.02 1.06h5.22c.89 0 1.02-.37 1.02-1.06ZM109.26 19.64h-6.7v-1.47h6.61c.89 0 1.02-.37 1.02-1.06v-2.2c0-.68-.13-1.06-1.02-1.06h-4.7c-1.65 0-2.42-.4-2.42-2.5v-2.2c0-2.1.77-2.5 2.43-2.5h6.66v1.48h-6.6c-.88 0-1.01.38-1.01 1.07v2.12c0 .64.13 1.07.95 1.07h4.78c1.66 0 2.43.4 2.43 2.5v2.24c0 2.1-.77 2.5-2.43 2.5ZM95.77 24.36H94.4l1.48-4.72-4.43-13h1.6l3.54 10.73 3.43-10.72h1.5l-5.75 17.71ZM88.22 19.64h-5.38c-1.66 0-2.43-.4-2.43-2.5v-3.12c0-2.1.77-2.5 2.43-2.5h6.33V9.2c0-.69-.14-1.07-1.02-1.07h-7.5V6.65h7.57c1.66 0 2.43.4 2.43 2.5v7.98c0 2.1-.77 2.5-2.43 2.5Zm.95-2.53V13h-6.24c-.89 0-1.02.38-1.02 1.06v3.05c0 .69.13 1.06 1.02 1.06h5.22c.88 0 1.02-.37 1.02-1.06ZM76.27 19.64h-5.38c-1.66 0-2.43-.4-2.43-2.5V9.14c0-2.1.77-2.5 2.43-2.5h6.33V.74h1.48v16.4c0 2.1-.77 2.5-2.43 2.5Zm.95-2.53V8.13h-6.24c-.89 0-1.02.38-1.02 1.07v7.91c0 .69.13 1.06 1.02 1.06h5.22c.89 0 1.02-.37 1.02-1.06ZM45.6 19.64h-7.33c-1.66 0-2.43-.4-2.43-2.5v-8c0-2.1.77-2.5 2.43-2.5h5.38c1.66 0 2.43.4 2.43 2.5v2.96c0 2.1-.77 2.5-2.43 2.5h-5.53v1.92c0 .8.2.83 1.17.83h6.3v2.29Zm-1.77-8.15v-1.7c0-.69-.13-.83-.8-.83h-4.11c-.67 0-.8.14-.8.83v2.52h4.91c.66 0 .8-.14.8-.82ZM137.37 19.64h-2.65V15.4h-7.97v-2.84l4.98-9.99h3.05l-5.13 10.11h5.07V6.65h2.65v12.99ZM125.83 19.64h-10.18V16.6l6.8-6.56c.86-.85.9-1.4.9-2.08V6c0-.69-.13-.71-.69-.71h-3.65c-.55 0-.68.02-.68.7v1.68h-2.68v-2.6c0-2.1.77-2.5 2.43-2.5h5.5c1.65 0 2.42.4 2.42 2.5v2.63c0 2.1-.02 2.9-1.37 4.2l-5.24 5.01h6.44v2.72ZM46.42 22.65c0-.63.48-1.14 1.07-1.14h10.1c.6 0 1.08.5 1.08 1.14 0 .63-.48 1.14-1.07 1.14H47.49c-.59 0-1.07-.51-1.07-1.14ZM47.54 17.98l2.99-4.46-3-5.03c-.42-.7.05-1.61.83-1.61h1.6c.35 0 .68.2.85.52l3.46 6.38-3.45 5.4a.97.97 0 0 1-.81.46h-1.67c-.8 0-1.27-.97-.8-1.66Z"
					fill="currentColor"
				/>
				<path
					opacity=".5"
					d="m57.8 17.98-2.99-4.46 3-5.03c.42-.7-.05-1.61-.83-1.61h-1.6c-.35 0-.68.2-.85.52l-3.46 6.38 3.45 5.4c.18.29.49.46.81.46H57c.8 0 1.27-.97.8-1.66Z"
					fill="currentColor"
				/>
			</svg>
		`;
	}
}
