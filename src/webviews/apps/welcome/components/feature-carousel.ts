import { css, html, LitElement } from 'lit';
import { customElement, queryAssignedElements, state } from 'lit/decorators.js';
import '../../shared/components/button';
import '../../shared/components/code-icon';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-carousel': GlFeatureCarousel;
		'gl-feature-card': GlFeatureCard;
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
				gap: 1rem;
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
			}

			.image {
			}
			.content {
			}
			::slotted(img) {
			}

			::slotted(h1) {
			}

			::slotted(p) {
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
