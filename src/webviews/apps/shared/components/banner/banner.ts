import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
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

	override render(): unknown {
		return html` <div part="base" class=${classMap(this.classNames)}>${this.renderContent()}</div> `;
	}

	private renderContent() {
		return html`
			<div class="banner__content">
				${this.layout === 'responsive' ? this.renderResponsiveContent() : this.renderDefaultContent()}
			</div>
			${this.layout !== 'responsive' && this.dismissible ? this.renderDismissButton() : ''}
		`;
	}

	private renderDefaultContent() {
		return html`
			${this.bannerTitle ? this.renderTitle() : ''} ${this.body ? this.renderBody() : ''} ${this.renderButtons()}
		`;
	}

	private renderResponsiveContent() {
		return html`
			<div class="banner__text">
				${this.bannerTitle ? this.renderTitle() : ''} ${this.body ? this.renderBody() : ''}
			</div>
			${this.renderButtons()} ${this.dismissible ? this.renderDismissButton() : ''}
		`;
	}

	private renderTitle() {
		return html`<div class="banner__title">${this.bannerTitle}</div>`;
	}

	private renderBody() {
		return html`<div class="banner__body" .innerHTML=${this.body}></div>`;
	}

	private renderButtons() {
		const hasPrimary = this.primaryButton;
		const hasSecondary = this.secondaryButton;

		if (!hasPrimary && !hasSecondary) return '';

		return html`
			<div class="banner__buttons">
				${hasPrimary ? this.renderPrimaryButton() : ''} ${hasSecondary ? this.renderSecondaryButton() : ''}
			</div>
		`;
	}

	private renderPrimaryButton() {
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
