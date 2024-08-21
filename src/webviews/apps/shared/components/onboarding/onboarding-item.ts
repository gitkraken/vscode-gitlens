import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import { GlElement, observe } from '../element';

@customElement('gl-onboarding-item')
export class GlOnboardingItem extends GlElement {
	static override readonly shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	override attachShadow(init: ShadowRootInit): ShadowRoot {
		return super.attachShadow({ ...init, delegatesFocus: !this.disabled });
	}

	static override readonly styles = [
		css`
			:host {
				--gl-action-button-color: var(--sl-color-neutral-700, gray);
				--gl-disabled-text-color: var(--vscode-disabledForeground);
				--gl-unchecked-icon-color: inherit;
				--gl-checked-icon-color: var(--sl-color-success-500, green);

				display: flex;
				align-items: center;
				font-size: 14px;
			}

			/* action buttons */
			.actions {
				display: flex;
				align-items: center;
				margin: -4px 0;
			}
			.actions gl-button {
				--button-padding: 0;
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
				--code-icon-size: 20px;
				--code-icon-v-align: middle;
				color: var(--gl-action-button-color);
			}

			/* check icon */
			code-icon.check {
				color: var(--gl-unchecked-icon-color);
				overflow: visible;
				display: inline-block;
				width: 14px;
				flex-shrink: 0;
				margin-right: 8px;
			}
			code-icon.check.disabled {
				color: var(--gl-disabled-text-color);
			}
			code-icon.check:not(.disabled) {
				color: var(--gl-unchecked-icon-color);
			}
			code-icon.check.checked:not(.disabled) {
				color: var(--gl-checked-icon-color);
			}

			/* description */
			.description {
				display: inline-flex;
				flex: 1;
				align-items: center;
			}
			.description-label {
				flex: 1;
			}
			.description.disabled .description-label {
				color: var(--gl-disabled-text-color);
			}
		`,
	];

	@property({ type: Boolean })
	checked = false;

	@property({ type: String, attribute: 'play-title' })
	playTitle?: string;

	@property({ type: String, attribute: 'play-href' })
	playHref?: string;

	@property({ type: String, attribute: 'info-title' })
	infoTitle?: string;

	@property({ type: String, attribute: 'info-href' })
	infoHref?: string;

	@property({ type: Boolean })
	disabled?: boolean;

	private get infoPresented() {
		return Boolean(this.infoHref) || Boolean(this.infoTitle);
	}

	private renderPlay() {
		if (!this.playHref) return nothing;

		return html`<gl-button
			?disabled=${this.disabled}
			href=${this.playHref}
			tooltip=${ifDefined(this.playTitle)}
			appearance="toolbar"
			><code-icon icon="play-circle"></code-icon
		></gl-button>`;
	}

	private renderInfo() {
		if (!this.infoPresented) return nothing;

		return html`<gl-button
			?disabled=${this.disabled}
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
				disabled: Boolean(this.disabled),
			})}
			icon=${when(
				this.checked,
				() => 'pass',
				() => 'circle-large-outline',
			)}
		></code-icon>`;
	}

	private renderActions() {
		return html` <div class="actions">${this.renderPlay()}${this.renderInfo()}</div>`;
	}

	protected override render() {
		return html`
			${this.renderCheckIcon()}
			<div
				class=${classMap({
					description: true,
					disabled: this.checked || Boolean(this.disabled),
				})}
			>
				<span class="description-label"><slot></slot></span>
				${this.renderActions()}
			</div>
		`;
	}
}
