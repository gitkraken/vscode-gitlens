import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { until } from 'lit/directives/until.js';
import type { GlCommands } from '../../../../constants.commands';
import type { Source } from '../../../../constants.telemetry';
import type { Promo } from '../../../../plus/gk/models/promo';
import { createCommandLink } from '../../../../system/commands';
import { focusOutline } from './styles/lit/a11y.css';

@customElement('gl-promo')
export class GlPromo extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

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

			.link:focus-visible {
				${focusOutline}
			}

			.link:hover {
				color: inherit;
				text-decoration: underline;
			}
		`,
	];

	@query('a,button,[tabindex="0"]')
	private _focusable?: HTMLElement;

	@property({ type: Object })
	promoPromise!: Promise<Promo | undefined>;

	@property({ type: Object })
	source?: Source;

	@property({ reflect: true, type: String })
	type: 'link' | 'info' = 'info';

	private _hasPromo = false;
	@property({ type: Boolean, reflect: true, attribute: 'has-promo' })
	get hasPromo() {
		return this._hasPromo;
	}
	private set hasPromo(value: boolean) {
		this._hasPromo = value;
	}

	override render(): unknown {
		return html`${until(
			this.promoPromise.then(promo => this.renderPromo(promo)),
			nothing,
		)}`;
	}

	private renderPromo(promo: Promo | undefined) {
		if (!promo?.content?.webview) {
			this.hasPromo = false;
			return;
		}

		const content = promo.content.webview;
		switch (this.type) {
			case 'info':
				if (content.info) {
					this.hasPromo = true;
					return html`<p class="promo" part="text">${unsafeHTML(content.info.html)}</p>`;
				}
				break;

			case 'link':
				if (content.link) {
					this.hasPromo = true;
					return html`<a
						class="link"
						part="link"
						href="${this.getCommandUrl(promo)}"
						title="${ifDefined(content.link.title)}"
						>${unsafeHTML(content.link.html)}</a
					>`;
				}
				break;
		}

		this.hasPromo = false;
		return nothing;
	}

	private getCommandUrl(promo: Promo | undefined) {
		let command: GlCommands | undefined;
		if (promo?.content?.webview?.link?.command?.startsWith('command:')) {
			command = promo.content.webview.link.command.substring('command:'.length) as GlCommands;
		}

		return createCommandLink<Source>(command ?? 'gitlens.plus.upgrade', this.source);
	}

	override focus(): void {
		this._focusable?.focus();
	}
}
