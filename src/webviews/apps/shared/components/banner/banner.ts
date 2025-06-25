import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { bannerStyles } from './banner.css';
import '../button';

export const bannerTagName = 'gl-banner';

export type BannerDisplay = 'solid' | 'outline' | 'gradient' | 'gradient-transparent';

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

	private get classNames() {
		return {
			banner: true,
			[`banner--${this.display}`]: true,
		};
	}

	override render(): unknown {
		return html`
			<div part="base" class=${classMap(this.classNames)}>
				${this.renderContent()}
			</div>
		`;
	}

	private renderContent() {
		return html`
			<div class="banner__content">
				${this.bannerTitle ? this.renderTitle() : ''}
				${this.body ? this.renderBody() : ''}
				${this.renderButtons()}
			</div>
		`;
	}

	private renderTitle() {
		return html`<div class="banner__title">${this.bannerTitle}</div>`;
	}

	private renderBody() {
		return html`<div class="banner__body">${this.body}</div>`;
	}

	private renderButtons() {
		const hasPrimary = this.primaryButton;
		const hasSecondary = this.secondaryButton;

		if (!hasPrimary && !hasSecondary) return '';

		return html`
			<div class="banner__buttons">
				${hasPrimary ? this.renderPrimaryButton() : ''}
				${hasSecondary ? this.renderSecondaryButton() : ''}
			</div>
		`;
	}

	private renderPrimaryButton() {
		return html`
			<gl-button
				class="banner__button banner__button--primary"
				href=${ifDefined(this.primaryButtonHref)}
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
}

declare global {
	interface HTMLElementTagNameMap {
		[bannerTagName]: GlBanner;
	}
}
