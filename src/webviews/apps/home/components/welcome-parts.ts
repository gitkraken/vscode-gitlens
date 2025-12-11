import { css, html, LitElement } from 'lit';
import { customElement, queryAssignedElements, state } from 'lit/decorators.js';
import '../../shared/components/button';
import '../../shared/components/code-icon';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-card': GlFeatureCard;
		'gl-feature-carousel': GlFeatureCarousel;
		'gl-feature-narrow-card': GlFeatureNarrowCard;
		'gl-scrollable-features': GlScrollableFeatures;
	}
}

@customElement('gl-feature-carousel')
export class GlFeatureCarousel extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
				width: 100%;
			}

			.carousel {
				display: flex;
				gap: 1em;
				justify-content: center;
			}

			.button {
				display: flex;
				align-items: center;
			}

			.content {
				flex: 1;
				max-width: 520px;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			::slotted(*) {
				display: none;
			}

			::slotted([data-active]) {
				display: flex;
				width: 100%;
			}
		`,
	];

	@queryAssignedElements({ flatten: true })
	private cards!: HTMLElement[];

	@state()
	private currentIndex = 0;

	override firstUpdated(): void {
		this.updateActiveCard();
	}

	private updateActiveCard(): void {
		this.cards.forEach((card, index) => {
			if (index === this.currentIndex) {
				card.setAttribute('data-active', '');
			} else {
				card.removeAttribute('data-active');
			}
		});
	}

	private handlePrevious(): void {
		if (this.cards.length === 0) return;
		this.currentIndex = (this.currentIndex - 1 + this.cards.length) % this.cards.length;
		this.updateActiveCard();
	}

	private handleNext(): void {
		if (this.cards.length === 0) return;
		this.currentIndex = (this.currentIndex + 1) % this.cards.length;
		this.updateActiveCard();
	}

	private handleSlotChange(): void {
		this.currentIndex = 0;
		this.updateActiveCard();
	}

	override render(): unknown {
		return html`
			<div class="carousel">
				<gl-button
					class="button"
					appearance="input"
					@click=${this.handlePrevious}
					aria-label="Previous feature"
				>
					<code-icon icon="chevron-left" size="20"></code-icon>
				</gl-button>

				<div class="content">
					<slot @slotchange=${this.handleSlotChange}></slot>
				</div>

				<gl-button class="button" appearance="input" @click=${this.handleNext} aria-label="Next feature">
					<code-icon icon="chevron-right" size="20"></code-icon>
				</gl-button>
			</div>
		`;
	}
}

@customElement('gl-feature-card')
export class GlFeatureCard extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				gap: 1em;
			}

			.image {
				flex: 1 1 50%;
				width: 50%;
			}

			.content {
				margin-top: 0.5em;
				flex: 1 0 50%;
				display: block;
			}

			@media (max-width: 400px) {
				:host {
					flex-direction: column;
				}

				.image {
					width: 100%;
				}

				.content {
					margin-top: 0;
					margin-left: 0.3em;
					margin-right: 0.3em;
				}

				::slotted(*) {
					width: 100%;
				}
			}
		`,
	];

	override render(): unknown {
		return html`
			<div class="image">
				<slot name="image"></slot>
			</div>
			<div class="content">
				<slot></slot>
			</div>
		`;
	}
}

@customElement('gl-feature-narrow-card')
export class GlFeatureNarrowCard extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: 0.7em;
				width: 12em;
				min-width: 12em;
				text-align: initial;
			}

			.image ::slotted(img) {
				max-height: 2.23em;
				border-radius: 0.6em;
			}

			::slotted(p:last-child) {
				margin-top: 0.5em;
			}

			.content {
				display: block;
			}

			@media (max-width: 400px) {
				.content {
					margin-left: 0.3em;
					margin-right: 0.3em;
				}
			}
		`,
	];

	override render(): unknown {
		return html`
			<div class="image">
				<slot name="image"></slot>
			</div>
			<div class="content">
				<slot></slot>
			</div>
		`;
	}
}

@customElement('gl-scrollable-features')
export class GlScrollableFeatures extends LitElement {
	static override styles = [
		css`
			:host {
				--side-shadow-padding: 1em;
				--side-shadow-color: transparent;

				--final-side-shadow-padding: max(var(--side-shadow-padding), 1em);
				position: relative;
				max-width: 100%;
			}

			:host::before,
			:host::after {
				content: ' ';
				position: absolute;
				top: 0;
				width: var(--final-side-shadow-padding);
				height: 100%;
			}

			:host::before {
				left: 0;
				background: linear-gradient(to left, transparent 0%, var(--side-shadow-color) 83%);
			}
			:host::after {
				right: 0;
				background: linear-gradient(to right, transparent 0%, var(--side-shadow-color) 83%);
			}

			.content {
				box-sizing: border-box;
				padding: 0 var(--final-side-shadow-padding);
				display: flex;
				gap: 1em;
				overflow-x: auto;
				overflow-y: hidden;
				scrollbar-width: none;
			}
		`,
	];

	override render(): unknown {
		return html`<div class="content"><slot></slot></div>`;
	}
}
