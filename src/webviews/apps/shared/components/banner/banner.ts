import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { bannerStyles } from './banner.css';
import '../button';

export const bannerTagName = 'gl-banner';

export type BannerDisplay = 'solid' | 'outline' | 'gradient' | 'gradient-transparent' | 'gradient-purple';

@customElement(bannerTagName)
export class GlBanner extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [bannerStyles];

	@property({ reflect: true })
	display: BannerDisplay = 'solid';

	@property({ attribute: 'banner-title' })
	bannerTitle?: string;

	@property()
	body?: string;

	@property({ attribute: 'primary-button' })
	primaryButton?: string;

	@property({ attribute: 'primary-button-href' })
	primaryButtonHref?: string;

	@property({ attribute: 'primary-button-command' })
	primaryButtonCommand?: string;

	@property({ attribute: 'secondary-button' })
	secondaryButton?: string;

	@property({ attribute: 'secondary-button-href' })
	secondaryButtonHref?: string;

	@property({ attribute: 'secondary-button-command' })
	secondaryButtonCommand?: string;

	@property({ type: Boolean, attribute: 'dismissible' })
	dismissible = false;

	@property({ attribute: 'dismiss-href' })
	dismissHref?: string;

	@property({ attribute: 'layout' })
	layout: 'default' | 'responsive' = 'default';

	private get classNames() {
		return {
			banner: true,
			[`banner--${this.display}`]: true,
			[`banner--${this.layout}`]: this.layout !== 'default',
		};
	}

	override render() {
		return html`<div part="base" class=${classMap(this.classNames)}>
			<div class="banner__content">
				${this.layout === 'responsive' ? this.renderResponsiveContent() : this.renderDefaultContent()}
			</div>
			${this.layout !== 'responsive' ? this.renderDismissButton() : undefined}
		</div>`;
	}

	private renderDefaultContent() {
		return html`${this.renderTitle()} ${this.renderBody()} ${this.renderButtons()}`;
	}

	private renderResponsiveContent() {
		return html`
			<div class="banner__text">${this.renderTitle()} ${this.renderBody()}</div>
			${this.renderButtons()} ${this.renderDismissButton()}
		`;
	}

	private renderTitle() {
		if (!this.bannerTitle) return undefined;

		return html`<div class="banner__title">${this.bannerTitle}</div>`;
	}

	private renderBody() {
		if (!this.body) return undefined;

		return html`<div class="banner__body">${unsafeHTML(this.body)}</div>`;
	}

	private renderButtons() {
		const primary = this.renderPrimaryButton();
		const secondary = this.renderSecondaryButton();

		if (!primary && !secondary) return undefined;

		return html`<div class="banner__buttons">${primary} ${secondary}</div>`;
	}

	private renderPrimaryButton() {
		if (!this.primaryButton) return undefined;

		return html`
			<gl-button
				class="banner__button banner__button--primary"
				appearance=${this.display === 'gradient-purple' ? 'secondary' : undefined}
				?full=${this.display === 'gradient-purple'}
				href=${ifDefined(this.primaryButtonHref)}
				truncate
				@click=${this.onPrimaryButtonClick}
			>
				${this.primaryButton}
			</gl-button>
		`;
	}

	private renderSecondaryButton() {
		if (!this.secondaryButton) return undefined;

		return html`
			<gl-button
				class="banner__button banner__button--secondary"
				appearance="toolbar"
				href=${ifDefined(this.secondaryButtonHref)}
				@click=${this.onSecondaryButtonClick}
			>
				${this.secondaryButton}
			</gl-button>
		`;
	}

	private renderDismissButton() {
		if (!this.dismissible) return undefined;

		return html`
			<gl-button
				class="banner__dismiss"
				appearance="toolbar"
				href=${ifDefined(this.dismissHref)}
				aria-label="Dismiss"
				tooltip="Dismiss"
				@click=${this.onDismissClick}
			>
				<code-icon icon="close"></code-icon>
			</gl-button>
		`;
	}

	private onPrimaryButtonClick(e: Event) {
		if (this.primaryButtonCommand) {
			e.preventDefault();
		}
		this.dispatchEvent(
			new CustomEvent('gl-banner-primary-click', {
				detail: { command: this.primaryButtonCommand },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onSecondaryButtonClick(e: Event) {
		if (this.secondaryButtonCommand) {
			e.preventDefault();
		}
		this.dispatchEvent(
			new CustomEvent('gl-banner-secondary-click', {
				detail: { command: this.secondaryButtonCommand },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onDismissClick(e: Event) {
		e.preventDefault();
		this.dispatchEvent(
			new CustomEvent('gl-banner-dismiss', {
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[bannerTagName]: GlBanner;
	}
}
