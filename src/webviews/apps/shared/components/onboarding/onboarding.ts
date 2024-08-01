import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { OnboardingItemConfiguration, OnboardingStateTemplate } from './onboarding-types';

import './onboarding-item';
import './onboarding-item-group';
import './progress-tracker';
import '../accordion/accordion';

@customElement('gl-onboarding')
export class GlOnboarding<
	OnboardingState extends OnboardingStateTemplate,
	OnboardingItem extends string,
> extends LitElement {
	static override readonly styles = css`
		gl-accordion {
			--gk-accordion-details-color: currentColor;
			--gk-accordion-button-color: currentColor;
			--gk-accordion-button-padding: 12px 20px;
			--gk-accordion-details-padding: 6px 20px 12px 20px;
			--gk-accordion-button-width: 100%;
			--gk-accordion-button-border: none;
			--gk-accordion-button-chevron-size: 13px;
			--gk-accordion-button-focus-outline: none;
			--gk-accordion-button-background-color-hovered: var(--vscode-list-hoverBackground);
			--gk-accordion-button-border-radius: 0;
		}
		h3.title {
			text-transform: uppercase;
			font-weight: 700;
			font-size: 11px;
			text-align: left;
			margin: 0;
			color: currentColor;
			width: 100%;
		}
		h3.title span.progress {
			color: var(--vscode-progressBar-background);
		}
		gl-progress-tracker {
			--gl-progress-foreground-color: var(--vscode-progressBar-background);
			--gl-progress-background-color: var(--progress-bar-color);
		}

		gl-onboarding-item {
			margin: 2px 0;
			--gl-disabled-text-color: var(--vscode-disabledForeground);
			--gl-checked-icon-color: var(--sl-color-success-500, green);
			--gl-action-button-color: var(--sl-color-neutral-700, gray);
		}

		gl-onboarding-item-group {
			--gl-onboarding-group-indent: 20px;
		}
		gl-onboarding-item-group.top-onboarding-group {
			--gl-onboarding-group-indent: 0px;
			margin-top: 12px;
		}
	`;

	static override readonly shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	@property({ type: Object })
	state?: OnboardingState;

	@property({ type: Array })
	onboardingConfiguration?: OnboardingItemConfiguration<OnboardingItem>[];

	@state()
	isExpanded: boolean = true;

	override connectedCallback(): void {
		super.connectedCallback();
		this.isExpanded = !this.finished;
	}

	private get progress() {
		const onboardingState = this.state;
		const onboardingConfiguration = this.onboardingConfiguration;
		if (!onboardingState || !onboardingConfiguration) return 0;
		return Number(
			onboardingConfiguration.reduce((acc, onboardingItem) => {
				const ownState = Boolean(onboardingState[`${onboardingItem.itemId}Checked`]);
				if (!onboardingItem.children) {
					return acc + Number(ownState);
				}
				return acc + Number(this.calcStateFromChildren(onboardingItem));
			}, 0),
		);
	}

	private get stepCount() {
		return this.onboardingConfiguration?.length ?? 0;
	}

	private renderOnboardingItem(onboardingItem: OnboardingItemConfiguration<OnboardingItem>) {
		return html`
			<gl-onboarding-item
				.checked=${Boolean(this.state?.[`${onboardingItem.itemId}Checked`])}
				play-href=${ifDefined(onboardingItem.playHref)}
				info-href=${ifDefined(onboardingItem.infoHref)}
				info-title=${ifDefined(onboardingItem.infoTooltip)}
				>${onboardingItem.title}
			</gl-onboarding-item>
		`;
	}

	private calcStateFromChildren(onboardingItem: OnboardingItemConfiguration<OnboardingItem>) {
		return (
			onboardingItem.children?.reduce(
				(acc, onboardingItemChild) => acc && Boolean(this.state?.[`${onboardingItemChild.itemId}Checked`]),
				true,
			) ?? false
		);
	}

	private renderOnboardingGroup(onboardingItem: OnboardingItemConfiguration<OnboardingItem>) {
		return html`
			<gl-onboarding-item-group>
				<gl-onboarding-item
					.checked=${this.calcStateFromChildren(onboardingItem)}
					slot=${'top'}
					play-href=${ifDefined(onboardingItem.playHref)}
					info-href=${ifDefined(onboardingItem.infoHref)}
					info-title=${ifDefined(onboardingItem.infoTooltip)}
					>${onboardingItem.title}
				</gl-onboarding-item>
				${repeat(onboardingItem.children ?? [], item => item.itemId, this.renderOnboardingItem.bind(this))}
			</gl-onboarding-item-group>
		`;
	}

	private get finished() {
		return this.progress === this.stepCount;
	}

	protected override render() {
		if (!this.state) {
			return html``;
		}
		return html`
			<gl-accordion show-chevron ?default-is-expanded=${!this.finished}>
				<h3 class="title" slot="button-content">
					<slot name="title"></slot>
					<span class="progress">${this.progress}/${this.stepCount}</span>
				</h3>

				<div slot="details-content">
					<gl-progress-tracker progress=${this.progress} stepCount=${this.stepCount}></gl-progress-tracker>
					<gl-onboarding-item-group class="top-onboarding-group">
						${repeat(
							this.onboardingConfiguration ?? [],
							item => item.itemId,
							item => html`
								${when(
									Boolean(item.children?.length),
									this.renderOnboardingGroup.bind(this, item),
									this.renderOnboardingItem.bind(this, item),
								)}
							`,
						)}
					</gl-onboarding-item-group>
				</div></gl-accordion
			>
		`;
	}
}
