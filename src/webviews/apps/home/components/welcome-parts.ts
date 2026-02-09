import type { TemplateResult } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, queryAssignedElements, state } from 'lit/decorators.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import type { SubscriptionState } from '../../../../constants.subscription.js';
import type { WalkthroughContextKeys } from '../../../../constants.walkthroughs.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-card': GlFeatureCard;
		'gl-feature-carousel': GlFeatureCarousel;
		'gl-feature-narrow-card': GlFeatureNarrowCard;
		'gl-scrollable-features': GlScrollableFeatures;
		'gl-walkthrough': GlWalkthrough;
		'gl-walkthrough-step': GlWalkthroughStep;
	}

	interface GlobalEventHandlersEventMap {
		'gl-walkthrough-step-expand-toggled': CustomEvent<{ expanded: boolean }>;
	}
}

@customElement('gl-feature-carousel')
export class GlFeatureCarousel extends LitElement {
	static override styles = [
		css`
			:host {
				--active-dot-color: var(--text-color);
				--inactive-dot-color: var(--card-background);
				display: block;
				width: 100%;
			}

			.carousel {
				display: grid;
				grid-template-columns: 0fr auto 0fr;
				grid-template-rows: auto 0fr;
				gap: 1em;
				justify-content: center;
			}

			.button {
				display: flex;
				align-items: center;
			}
			.button.previous {
				grid-column: 1;
				grid-row: 1;
			}
			.button.next {
				grid-column: 3;
				grid-row: 1;
			}

			.content {
				max-width: 520px;
				display: flex;
				align-items: center;
				justify-content: center;
				width: 100%;
				grid-column: 2;
				grid-row: 1;
			}

			.dots {
				display: flex;
				align-items: center;
				gap: 0;
				justify-content: center;
				grid-column: 2;
				grid-row: 2;
			}

			.dot {
				padding: 0.5em;
				cursor: pointer;
				position: relative;
			}

			.dot::before {
				content: '';
				display: block;
				width: 8px;
				height: 8px;
				border-radius: 50%;
				background-color: var(--inactive-dot-color);
				transition: background-color 0.2s ease;
			}

			.dot:hover::before {
				background-color: var(--active-dot-color);
			}

			.dot[data-active]::before {
				background-color: var(--active-dot-color);
			}

			::slotted(*) {
				display: none;
			}

			::slotted([data-active]) {
				display: flex;
				width: 100%;
			}

			@media (max-width: 400px) {
				.carousel {
					display: grid;
					grid-template-columns: 1fr auto 1fr;
					grid-template-rows: auto 0fr;
					gap: 0.5em;
				}
				.content {
					grid-column: 1 / span 3;
					grid-row: 1;
				}
				.button {
					display: block;
				}
				.button.previous {
					grid-column: 1;
					grid-row: 2;
				}
				.button.next {
					grid-column: 3;
					grid-row: 2;
				}
			}
		`,
	];

	@queryAssignedElements({ flatten: true })
	private cards!: HTMLElement[];

	@state()
	private currentIndex = 0;

	override firstUpdated(): void {
		this.updateActiveCard();
		this.requestUpdate();
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

	private handleDotClick(index: number): void {
		this.currentIndex = index;
		this.updateActiveCard();
	}

	override render(): unknown {
		return html`
			<div class="carousel">
				<div class="content">
					<slot @slotchange=${this.handleSlotChange}></slot>
				</div>

				<gl-button
					class="button previous"
					appearance="input"
					@click=${this.handlePrevious}
					aria-label="Previous feature"
				>
					<code-icon icon="chevron-left" size="20"></code-icon>
				</gl-button>
				<div class="dots">
					${this.cards.map(
						(_, index) => html`
							<span
								class="dot"
								?data-active=${index === this.currentIndex}
								@click=${() => this.handleDotClick(index)}
								role="button"
								tabindex="0"
								aria-label="Go to feature ${index + 1}"
								@keydown=${(e: KeyboardEvent) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										this.handleDotClick(index);
									}
								}}
							></span>
						`,
					)}
				</div>
				<gl-button class="button next" appearance="input" @click=${this.handleNext} aria-label="Next feature">
					<code-icon icon="chevron-right" size="20"></code-icon>
				</gl-button>
			</div>
		`;
	}
}

export type WalkthroughStep = {
	id: string;
	/** The key used to track completion in the walkthrough progress state */
	walkthroughKey?: WalkthroughContextKeys;
	title: string;
	body: TemplateResult;
	condition?: (plusState?: SubscriptionState) => boolean;
};

@customElement('gl-walkthrough-step')
export class GlWalkthroughStep extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}

			:host(:focus-within) {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.header {
				display: flex;
				align-items: center;
				gap: 0.6em;
				cursor: pointer;
				user-select: none;
			}

			.header:hover {
				opacity: 0.8;
			}

			.header:focus {
				outline: none;
			}

			.icon {
				flex: none;
				transition: transform 0.2s ease;
			}

			:host([expanded]) .icon {
				transform: rotate(90deg);
			}

			.title {
				flex: 1;
				display: block;
			}

			.status-icon {
				flex: none;
				color: var(--vscode-textLink-foreground);
			}

			.content {
				display: none;
				flex-direction: column;
				gap: 1em;
			}

			:host([expanded]) .content {
				display: flex;
			}
		`,
	];

	@property({ type: String })
	stepId?: string;

	@property({ type: Boolean, reflect: true })
	completed: boolean = false;

	@property({ type: Boolean, reflect: true })
	expanded: boolean = false;

	toggleExpanded(expanded = !this.expanded): void {
		this.expanded = expanded;

		queueMicrotask(() => {
			this.dispatchEvent(
				new CustomEvent('gl-walkthrough-step-expand-toggled', {
					detail: { expanded: expanded },
					bubbles: true,
					composed: true,
				}),
			);
		});
	}

	private handleHeaderClick(): void {
		this.toggleExpanded();
	}

	private handleHeaderKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.toggleExpanded();
		}
	}

	override render(): unknown {
		return html`
			<div
				part="header"
				class="header"
				role="button"
				tabindex="0"
				aria-expanded=${this.expanded}
				@click=${this.handleHeaderClick}
				@keydown=${this.handleHeaderKeydown}
			>
				<code-icon class="icon" icon="chevron-right"></code-icon>
				<span class="title"><slot name="title"></slot></span>
				<code-icon class="status-icon" icon=${this.completed ? 'pass-filled' : 'circle-large'}></code-icon>
			</div>
			<div class="content">
				<slot></slot>
			</div>
		`;
	}
}

@customElement('gl-walkthrough')
export class GlWalkthrough extends LitElement {
	@queryAssignedElements({ selector: 'gl-walkthrough-step' })
	private steps!: GlWalkthroughStep[];

	/** The stepId of the currently expanded step, or undefined if no step is expanded */
	@property({ type: String, reflect: true, attribute: 'expanded-step-id' })
	expandedStepId?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('gl-walkthrough-step-expand-toggled', this.onStepExpandToggled);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.removeEventListener('gl-walkthrough-step-expand-toggled', this.onStepExpandToggled);
	}

	override updated(changedProperties: Map<string, unknown>): void {
		super.updated(changedProperties);

		// When expandedStepId is changed programmatically, sync the step states
		if (changedProperties.has('expandedStepId')) {
			this.syncStepsToExpandedStepId();
		}
	}

	private readonly onStepExpandToggled = (e: GlobalEventHandlersEventMap['gl-walkthrough-step-expand-toggled']) => {
		const path = e.composedPath();
		const step = path.find(p => (p as HTMLElement).matches?.('gl-walkthrough-step')) as
			| GlWalkthroughStep
			| undefined;

		if (step == null) return;

		if (step.expanded) {
			// Step is being expanded - collapse all others and update expandedStepId
			this.steps.forEach(s => {
				if (s !== step) {
					s.expanded = false;
				}
			});
			this.expandedStepId = step.stepId;
		} else {
			// Step is being collapsed - set expandedStepId to undefined
			this.expandedStepId = undefined;
		}
	};

	private syncStepsToExpandedStepId(): void {
		// Sync step expanded states to match expandedStepId
		this.steps.forEach(step => {
			step.expanded = step.stepId != null && step.stepId === this.expandedStepId;
		});
	}

	private handleSlotChange(): void {
		// Sync step states when slot content changes
		if (this.expandedStepId != null) {
			this.syncStepsToExpandedStepId();
		} else {
			// If no expandedStepId is set, check if any step is already expanded and sync
			const expandedStep = this.steps.find(step => step.expanded);
			if (expandedStep != null) {
				this.expandedStepId = expandedStep.stepId;
			}
		}
	}

	override render(): unknown {
		return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
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

	private hasBeenVisible: boolean = false;

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		const isVisible = isElementVisible(this);
		if (!isVisible || this.hasBeenVisible) return;

		const isInViewport = isElementInViewport(this);
		const isPartiallyInViewport = isElementPartiallyInViewport(this);
		const visible = isVisible && (isInViewport || isPartiallyInViewport);
		if (visible && !this.hasBeenVisible) {
			this.hasBeenVisible = true;

			// Dispatch a custom event when any property changes
			this.dispatchEvent(
				new CustomEvent('gl-feature-appeared', {
					detail: {
						changedProperties: [...changedProperties.keys()],
						visibility: {
							isVisible: isVisible,
							isInViewport: isInViewport,
							isPartiallyInViewport: isPartiallyInViewport,
						},
					},
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	/** is used to make the component reactive to 'data-active' attribute changes */
	@property({ type: Boolean, reflect: true, attribute: 'data-active' })
	private _dataActive: boolean = false;

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
				display: block;
				width: 12em;
				min-width: 12em;
				text-align: initial;
			}

			::slotted(p:last-child) {
				margin-top: 0.5em;
			}

			@media (max-width: 400px) {
				:host {
					width: 100%;
					box-sizing: border-box;
					min-width: initial;
					padding-left: 0.3em;
					padding-right: 0.3em;
				}
			}
		`,
	];

	override render(): unknown {
		return html`<slot></slot>`;
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
				display: block;
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
				scroll-snap-type: x proximity;
			}

			::slotted(*) {
				scroll-snap-align: center;
			}

			@media (max-width: 400px) {
				:host::before,
				:host::after {
					content: none;
				}
				.content {
					flex-direction: column;
					gap: 0.5em;
				}
			}
		`,
	];

	override render(): unknown {
		return html`<div class="content"><slot></slot></div>`;
	}
}

function isElementVisible(element: HTMLElement): boolean {
	// Check if element is hidden by display: none or visibility: hidden
	const style = window.getComputedStyle(element);
	if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
		return false;
	}

	// Check if element has zero dimensions
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) {
		return false;
	}

	return true;
}

function isElementInViewport(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

function isElementPartiallyInViewport(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	const windowHeight = window.innerHeight || document.documentElement.clientHeight;
	const windowWidth = window.innerWidth || document.documentElement.clientWidth;

	return rect.bottom > 0 && rect.right > 0 && rect.top < windowHeight && rect.left < windowWidth;
}
