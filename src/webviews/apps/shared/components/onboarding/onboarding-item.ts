import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';

@customElement('gl-onboarding-item')
export class GlOnboardingItem extends LitElement {
	static override readonly shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	private static cssInputVariables = css`
		:host {
			--gl-action-button-color: gray;
			--gl-disabled-text-color: gray;
			--gl-unchecked-icon-color: inherit;
			--gl-checked-icon-color: green;
		}
	`;

	private static actionButtonsStyles = css`
		.actions {
			display: flex;
			align-items: center;
			margin: -4px 0;
		}
		.actions gl-button {
			--button-padding: 2px 0 0 0;
		}
		.actions gl-button.tooltip-only:focus-within {
			outline: none;
		}
		.actions gl-button.tooltip-only {
			cursor: default !important;
			background: unset;
		}
		.actions gl-button.tooltip-only * {
			cursor: default !important;
		}
		.actions gl-button code-icon {
			font-size: 20px;
			color: var(--gl-action-button-color);
		}
	`;

	private static checkIconStyles = css`
		code-icon.check {
			color: var(--gl-unchecked-icon-color);
			overflow: visible;
			display: inline-block;
			width: 14px;
			flex-shrink: 0;
			margin-right: 8px;
		}
		code-icon.check.checked {
			color: var(--gl-checked-icon-color);
		}
	`;

	private static descriptionStyles = css`
		.description {
			display: inline-flex;
			flex: 1;
			align-items: center;
		}
		.description span {
			flex: 1;
		}
		.description.disabled span {
			color: var(--gl-disabled-text-color);
		}
	`;

	static override readonly styles = [
		GlOnboardingItem.cssInputVariables,
		GlOnboardingItem.actionButtonsStyles,
		GlOnboardingItem.checkIconStyles,
		GlOnboardingItem.descriptionStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				font-size: 14px;
			}
		`,
	];

	@property({ type: Boolean })
	checked = false;

	@property({ type: String, attribute: 'play-href' })
	playHref = '';

	@property({ type: String, attribute: 'info-title' })
	infoTitle?: string;

	@property({ type: String, attribute: 'info-href' })
	infoHref?: string;

	private get infoPresented() {
		return Boolean(this.infoHref) || Boolean(this.infoTitle);
	}

	private renderPlay() {
		return html`<gl-button href=${this.playHref} appearance="toolbar"
			><code-icon icon="play-circle"></code-icon
		></gl-button>`;
	}

	private renderInfo() {
		return html`<gl-button
			href=${ifDefined(this.infoHref)}
			class=${classMap({
				'tooltip-only': !this.infoHref,
			})}
			appearance="toolbar"
		>
			${when(this.infoTitle, () => html`<span slot="tooltip">${this.infoTitle}</span>`)}
			<code-icon icon="info"></code-icon
		></gl-button>`;
	}

	private renderCheckIcon() {
		return html` <code-icon
			class=${classMap({
				check: true,
				checked: this.checked,
			})}
			icon=${when(
				this.checked,
				() => 'pass',
				() => 'circle-large-outline',
			)}
		></code-icon>`;
	}

	private renderActions() {
		return html` <div class="actions">
			${when(Boolean(this.playHref), this.renderPlay.bind(this))}
			${when(this.infoPresented, this.renderInfo.bind(this))}
		</div>`;
	}

	protected override render() {
		return html`
			${this.renderCheckIcon()}
			<div
				class=${classMap({
					description: true,
					disabled: this.checked,
				})}
			>
				<span><slot></slot></span>
				${this.renderActions()}
			</div>
		`;
	}
}
