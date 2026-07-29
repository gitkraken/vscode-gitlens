import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Classic "0 0 36 36" viewBox + r=16 donut-chart coordinate space. The arc uses pathLength="100" so
// dash math is percentage-based, independent of both the coordinate space and the rendered size.
const radius = 16;

/** Where the count reads relative to the ring. */
export type ProgressRingCountPlacement = 'end' | 'center' | 'sr-only';

@customElement('gl-progress-ring')
export class GlProgressRing extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			gap: var(--gl-space-4);
			align-items: center;
			vertical-align: middle;
		}

		.ring {
			position: relative;
			display: inline-flex;
			flex: none;
			/* Fallback lives in var(), not as a --gl-progress-ring-size declaration here — a value
			   declared directly would always win over one inherited from an ancestor wrapper (declared
			   beats inherited, regardless of specificity), defeating consumers that set the var higher up
			   the tree (matches gl-avatar's --gl-avatar-size). */
			width: var(--gl-progress-ring-size, 2.2rem);
			aspect-ratio: 1;
		}

		svg {
			display: block;
			width: 100%;
			height: 100%;
			overflow: visible;
		}

		circle {
			fill: none;
			/* Thickness is in viewBox units (36 = full diameter), so the stroke scales proportionally
			   with --gl-progress-ring-size. NOT non-scaling-stroke: that makes Chromium compute
			   stroke-dasharray/-dashoffset in screen pixels (ignoring pathLength), which breaks the
			   fraction — verified live; at small sizes the dash wraps the circle and reads as complete. */
			stroke-width: var(--gl-progress-ring-thickness, 3.6px);
		}

		/* Match the tokens the walkthrough progress bar uses (walkthroughProgressStyles in home.css.ts):
		   track = --color-alert-neutralBackground, value = --vscode-progressBar-background. */
		.track {
			stroke: var(--color-alert-neutralBackground);
		}

		.arc {
			stroke: var(--vscode-progressBar-background, blue);
			stroke-linecap: round;
			/* SVG circles start their path at 3 o'clock and draw clockwise; rotating -90deg moves the
			   start to 12 o'clock so progress reads like a clock face. */
			transform: rotate(-90deg);
			transform-origin: center;
			transition: stroke-dashoffset var(--gl-duration-medium) var(--gl-ease-out);
		}

		@media (prefers-reduced-motion: reduce) {
			.arc {
				transition: none;
			}
		}

		.count {
			font-size: var(--gl-progress-ring-count-font-size, var(--gl-font-sm));
			font-variant-numeric: tabular-nums;
			line-height: 1;
			color: inherit;
		}

		.count--center {
			position: absolute;
			inset: 0;
			display: flex;
			place-content: center;
			align-items: center;
			font-size: var(--gl-progress-ring-count-font-size, 0.9rem);
			pointer-events: none;
		}
	`;

	/** Completed count. */
	@property({ type: Number })
	value = 0;

	/** Total count. */
	@property({ type: Number })
	max = 0;

	/**
	 * Where the count reads: `end` (default) beside the ring, `center` inside it, or `sr-only` — the ring
	 * alone, with the count still announced to screen readers via the host `aria-label`.
	 */
	@property({ attribute: 'count-placement' })
	countPlacement: ProgressRingCountPlacement = 'end';

	private get fraction(): number {
		return this.max > 0 ? Math.min(this.value / this.max, 1) : 0;
	}

	override willUpdate(): void {
		this.setAttribute('role', 'img');
		this.setAttribute('aria-label', `Walkthrough progress: ${this.value} of ${this.max} complete`);
	}

	override render(): unknown {
		const offset = 100 * (1 - this.fraction);
		const count = `${this.value}/${this.max}`;

		return html`
			<span class="ring">
				<svg viewBox="0 0 36 36" aria-hidden="true">
					<circle class="track" cx="18" cy="18" r=${radius}></circle>
					${
						this.fraction > 0
							? // Must be svg``, not html``: Lit parses nested templates standalone, so a bare
								// <circle> in an html`` fragment lands in the HTML namespace and never renders.
								svg`<circle
								class="arc"
								cx="18"
								cy="18"
								r=${radius}
								pathLength="100"
								stroke-dasharray="100"
								stroke-dashoffset=${offset}
							></circle>`
							: nothing
					}
				</svg>
				${
					this.countPlacement === 'center'
						? html`<span class="count count--center" aria-hidden="true">${count}</span>`
						: nothing
				}
			</span>
			${this.countPlacement === 'end' ? html`<span class="count" aria-hidden="true">${count}</span>` : nothing}
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-progress-ring': GlProgressRing;
	}
}
