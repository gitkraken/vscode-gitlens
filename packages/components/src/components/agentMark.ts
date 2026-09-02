import type { CSSResult } from 'lit';
import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type AgentMarkCategory = 'working' | 'needs-input' | 'idle' | 'ended';

export type GlAgentMarkVariant = 'default' | 'badge';

/**
 * The ONE agent-phase indicator, consolidating what used to be three separate mechanisms: the
 * pulsing ringed dot (`agentWorkingDotStyles`, a shadow-DOM `css` constant hand-duplicated as
 * light-DOM SCSS in the graph's `.gl-graph__agent-status-dot`), the `gl-warning`/`gl-warning-filled`
 * crossfade badge for `needs-input`, and the bare `pass` checkmark / no-badge-at-all treatment for
 * `ended`/`idle`. A `css` template literal can't be shared into the graph's light-DOM row
 * templates — a custom element can, which is why this is a component rather than another shared
 * style constant.
 *
 * Every phase draws the same three layers — a solid core, a static ring around it that is ALWAYS
 * present (what keeps the phase legible at rest and under `prefers-reduced-motion: reduce`), and,
 * for the two live phases, two waves leaving the ring a half-cycle apart:
 *
 *  - `working` — circle, core + ring + waves, 2s cycle, continuous.
 *  - `needs-input` — triangle, core + ring + waves, same wave at the same speed, on a 5s cycle, so
 *    the gap between pulses is long where `working`'s is continuous.
 *  - `idle` — a filled dot, no ring, no waves. Suppressed entirely in `badge` variant: the glyph
 *    the badge sits on already says an agent is here, so a mark meaning "nothing is happening" is
 *    noise on every row that has one.
 *  - `ended` — the same dot hollowed out: outline only, no fill, no waves.
 *
 * A ring means LIVE, so only `working` and `needs-input` carry one; `idle` and `ended` are drawn
 * larger to compensate for the presence a ring would have lent them.
 *
 * THE WAVE IS A SOLID COPY OF THE SHAPE, NOT AN OUTLINE AND NOT A GRADIENT. It scales out of the
 * core and fades. A gradient reads as a soft blob sitting inside the silhouette rather than the
 * silhouette itself broadcasting, which is what made the triangle look inert. Falling
 * off from 0% with no plateau is too diffuse to register at this size. The ring, by contrast, IS
 * an outline, at 40% of the current color, and it never animates — a phase change re-times the
 * mark, it never restructures it.
 *
 * The circle and square are CSS layers, carried over unchanged from the shipped
 * `.gl-graph__agent-status-dot`, down to the whole-even-pixel sizing (a 6px core in a 12px ring at
 * the webview's `1rem = 10px`) and the `box-sizing: border-box` that keeps the ring's 1px border
 * from landing it a pixel low and right of the core. The triangle is SVG instead, because a CSS
 * box can be given a triangular silhouette with `clip-path` but cannot then be given a triangular
 * OUTLINE for its ring. Both draw the same three layers with the same timing.
 *
 * Color is `currentColor` throughout — this element does NOT pick its own phase color. Consumers
 * own that (typically the shared `--gl-agent-*-color` tokens in `theme.scss`) and own POSITION:
 * this renders in normal flow, sized only, so a corner-badge consumer positions it with its own
 * `position: absolute` rule, exactly as the retired `agentWorkingDotStyles` required.
 */
@customElement('gl-agent-mark')
export class GlAgentMark extends LitElement {
	static override styles: CSSResult = css`
		:host {
			position: relative;
			display: inline-flex;
			flex: none;
			align-items: center;
			justify-content: center;
			/* The core's box. The ring and waves overflow it, centered on the same point — the same
		   arrangement the shipped mark used, where the 0.6rem dot carried a 1.2rem ring. */
			width: 0.6rem;
			height: 0.6rem;
			vertical-align: middle;
			/* Contain the internal chip/waves/mark z-index ladder. Without this the host sets no
		   stacking context of its own, so those layers compete with whatever the consumer has
		   around them — the details panel's sticky section heading lost to the mark's svg on DOM
		   order and the mark scrolled over the header. */
			isolation: isolate;
		}

		/* Sized by INK, not by box. A triangle inscribed in the same box as a circle carries about
	   half its area and reads visibly smaller, so the box is grown until the two marks weigh the
	   same: the polygon covers 0.875 of the width and 0.881 of the height, the rounded-corner
	   stroke adds a little back, and the 0.86 scale takes some off — leaving roughly 0.80rem of
	   ink across, which matches the 0.6rem disc's area. One size for both variants, exactly as
	   the circle has one size for both. */
		:host([category='needs-input']) {
			width: 0.86rem;
			height: 0.74rem;
		}

		/* The badge variant is sized in em, NOT rem, so it tracks the glyph it overlays. The graph's
	   robot is 1.6rem and the tree's identity glyph is 1.3rem; a fixed rem badge that suits one
	   swallows the other. Consumers set font-size on the element to size the badge: both the graph
	   row and the sidebar leaf use 1.2rem, giving a 0.45rem core in a 0.9rem ring. */
		:host([variant='badge']) {
			width: 0.375em;
			height: 0.375em;
		}

		:host([variant='badge']) .mark {
			width: 0.375em;
			height: 0.375em;
		}

		:host([variant='badge']) .mark::before,
		:host([variant='badge']) .mark::after,
		:host([variant='badge']) .wave {
			width: 0.75em;
			height: 0.75em;
			margin: -0.375em 0 0 -0.375em;
		}

		:host([variant='badge'][category='needs-input']) {
			width: 0.54em;
			height: 0.46em;
		}

		/* The opaque backing that keeps the glyph underneath from showing through the ring's
	   transparent interior. Drawn HERE, not by consumers: only this element knows each phase's
	   silhouette and ring size, and a consumer approximating both with one circular disc clips
	   the wrong shape and far too much of the glyph. Consumers just set the colour — the row's
	   own background — and get a cut that matches whatever phase is rendering.

	   Sized off the ring and scaled about the centre, so it stays concentric with the mark no
	   matter how either is resized. */
		.chip {
			position: absolute;
			top: 50%;
			left: 50%;
			box-sizing: border-box;
			width: 1.2rem;
			height: 1.2rem;
			margin: -0.6rem 0 0 -0.6rem;
			background: var(--gl-agent-mark-chip, transparent);
			/* NOT inherit: the chip is a sibling of .mark, so it would take :host's (none) and
		   punch a square hole out of the glyph behind a round mark. */
			border-radius: 50%;
			transform: scale(1.1);
		}

		:host([variant='badge']) .chip {
			width: 0.75em;
			height: 0.75em;
			margin: -0.375em 0 0 -0.375em;
		}

		/* ---------- circle + square: the shipped CSS mark, unchanged ---------- */

		.mark {
			position: relative;
			/* border-box so the ended ring's 1px border sits INSIDE the box. Under content-box it
		   adds outside, and the flex host squashes the width back but not the height, leaving a
		   6x8 egg instead of a circle. */
			box-sizing: border-box;
			display: inline-block;
			width: 0.6rem;
			height: 0.6rem;
			background: currentColor;
			border-radius: 50%;
		}

		/* Idle is a bare dot and ended is a bare outline — fill versus no fill, which reads as
	   present-but-resting versus gone. Neither carries a ring: a ring means "there is activity
	   to enclose", and hanging one on a resting or finished session was noise (the ended
	   squircle-in-a-ring especially). */
		/* The ringless phases are drawn LARGER than the live ones' cores. working and needs-input
	   carry a ring, so their total footprint reads substantial at a 0.6rem core; idle and
	   ended have only the core itself, and at that same diameter they look insubstantial
	   beside a ringed mark. idle goes to 0.8rem, and ended to 0.9rem on top of that, because
	   an outline carries only its edge as ink — the same compensation the triangle gets for
	   enclosing less area than a disc. */
		:host([category='idle']),
		:host([category='idle']) .mark {
			width: 0.8rem;
			height: 0.8rem;
		}

		:host([category='ended']),
		:host([category='ended']) .mark {
			width: 0.9rem;
			height: 0.9rem;
		}

		:host([variant='badge'][category='ended']),
		:host([variant='badge'][category='ended']) .mark {
			width: 0.5625em;
			height: 0.5625em;
		}

		:host([category='ended']) .mark {
			background: transparent;
			border: 1px solid currentColor;
		}

		:host([category='idle']) .mark::after,
		:host([category='ended']) .mark::after {
			display: none;
		}

		/* One shared box for the ring and both waves. ::after is the permanent ring, ::before is
	   wave one, and the child element is wave two — a third layer needs a real element, both
	   pseudos being spoken for. */
		.mark::before,
		.mark::after,
		.wave {
			position: absolute;
			top: 50%;
			left: 50%;
			/* border-box is load-bearing: the centering margin is exactly half the ring's OUTER
		   size, and under content-box the 1px border would sit outside width, landing the
		   ring a pixel low and right of the core. There is no global box-sizing reset in a
		   shadow root. */
			box-sizing: border-box;
			width: 1.2rem;
			height: 1.2rem;
			margin: -0.6rem 0 0 -0.6rem;
			content: '';
			border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
			/* Take the core's silhouette rather than restating it — a new shape only has to set
		   its radius once, on .mark, and the ring and both waves follow. */
			border-radius: inherit;
		}

		/* The waves exist only while animating — at rest they would just double the resting ring. */
		.mark::before,
		.wave {
			display: none;
		}

		@media (prefers-reduced-motion: no-preference) {
			/* The wave is a SOLID copy of the core, grown outward and faded — not an outline, not a
		   gradient. A gradient reads as a soft blob sitting inside the silhouette rather than as
		   the silhouette itself broadcasting. Only ::before and the child ever become a wave;
		   ::after stays the ring in EVERY phase, so a phase change re-times the mark instead of
		   restructuring it. */
			:host([category='working']) .mark::before,
			:host([category='working']) .wave {
				inset: 0;
				display: block;
				width: auto;
				height: auto;
				margin: 0;
				background: currentColor;
				border: 0;
				animation: gl-agent-mark-wave 2s cubic-bezier(0.25, 0, 0, 1) infinite;
			}

			:host([category='working']) .wave {
				animation-delay: 1s;
			}

			:host([category='working']) .mark {
				animation: gl-agent-mark-core 1s cubic-bezier(0.16, 0.84, 0.44, 1) infinite;
			}
		}

		/* Starts at the core's own size and grows past the ring, then holds still for the rest of the
	   cycle. TWO keyframes, one motion: the travel must take the same 1.4s in both, so its share
	   of the cycle differs — 70% of the circle's 2s, 28% of the triangle's 5s. Reusing one
	   keyframe across both cycle lengths stretches the triangle's travel to 3.5s and it reads as
	   slow motion. To change the GAP, change the cycle length and recompute the percentage from
	   1.4s; never edit the percentage on its own. */
		@keyframes gl-agent-mark-wave {
			0% {
				opacity: 0.85;
				transform: scale(1);
			}

			70%,
			100% {
				opacity: 0;
				transform: scale(2.6);
			}
		}

		@keyframes gl-agent-mark-wave-spaced {
			0% {
				opacity: 0.85;
				transform: scale(1);
			}

			28%,
			100% {
				opacity: 0;
				transform: scale(2.6);
			}
		}

		@keyframes gl-agent-mark-core {
			0% {
				box-shadow: 0 0 0 0 currentColor;
			}

			18% {
				box-shadow: 0 0 0 0.12rem currentColor;
			}

			60%,
			100% {
				box-shadow: 0 0 0 0 currentColor;
			}
		}

		/* ---------- triangle ---------- */

		svg {
			position: relative;
			z-index: 2;
			display: block;
			width: 100%;
			height: 100%;
			/* The waves travel past the core's box; without this they clip at its edge instead of
		   reading as an outward ripple. */
			overflow: visible;
		}

		/* Centroid, not the bounding box's midpoint — expanding from the box centre drifts the shapes
	   toward the wider base and reads as off-axis. Percentages resolve against the viewBox for
	   the SVG shapes and against the border box for the spans, which land in the same place. */
		.tri-core,
		.tri-ring,
		.tri-wave,
		.tri-chip {
			transform-origin: 50% 66.66%;
		}

		/* The chip, in the triangle's own silhouette. A CSS layer rather than an SVG polygon so it can
	   take the same layered background the circle's chip does — a consumer compositing a
	   translucent row colour over an opaque base has no single colour to hand an SVG fill, and a
	   translucent chip hides nothing. Scaled past the ring so the glyph underneath is cleared
	   rather than grazed.

	   Keep these declarations on .tri-chip ALONE. Sharing them with the core and ring clips
	   the core's rounded-corner bulge (which lives outside its fill box, by construction) and
	   halves the ring's stroke. */
		.tri-chip {
			position: absolute;
			inset: 0;
			/* Explicit ladder: chip, then waves, then the mark itself. The svg carrying the ring and
		   core is NOT positioned, so without this the absolutely-positioned chip paints over it
		   and the triangle disappears the moment the chip has an opaque colour to paint. */
			z-index: 0;
			background: var(--gl-agent-mark-chip, transparent);
			clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
			transform: scale(2.4);
		}

		/* Rounded corners without hand-authored arc data: stroke the fill in its own color with a
	   round linejoin, painted under the fill, then scale back so the bulge doesn't grow the
	   silhouette. */
		.tri-core {
			fill: currentColor;
			stroke: currentColor;
			stroke-width: 3.4;
			stroke-linejoin: round;
			paint-order: stroke fill;
			transform: scale(0.86);
		}

		/* 2.0, not the circle's implicit 2× on a same-sized box: the triangle's core carries a
	   rounded-corner stroke bulge the circle doesn't, and its apex sits nearer the ring than any
	   point of a disc does, so a ring computed purely from widths reads as hugging the core. */
		.tri-ring {
			fill: none;
			stroke: color-mix(in srgb, currentColor 40%, transparent);
			stroke-width: 1;
			stroke-linejoin: round;
			vector-effect: non-scaling-stroke;
			transform: scale(2);
		}

		/* The circle's wave, clipped to a triangle — same keyframe, same easing, same solid fill.
	   transform-origin is the polygon's centroid as a percentage of the box, so it grows from
	   the triangle's visual centre rather than drifting toward its wider base. */
		.tri-wave {
			position: absolute;
			inset: 0;
			z-index: 1;
			display: none;
			background: currentColor;
			opacity: 0;
			clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
			transform-origin: 50% 66.66%;
		}

		@media (prefers-reduced-motion: no-preference) {
			:host([category='needs-input']) .tri-wave {
				display: block;
				animation: gl-agent-mark-wave-spaced 5s cubic-bezier(0.25, 0, 0, 1) infinite;
			}

			:host([category='needs-input']) .tri-wave--b {
				animation-delay: 1s;
			}

			:host([category='needs-input']) .tri-core {
				animation: gl-agent-mark-tri-core 5s cubic-bezier(0.16, 0.84, 0.44, 1) infinite;
			}
		}

		@keyframes gl-agent-mark-tri-core {
			0%,
			12%,
			100% {
				transform: scale(0.86);
			}

			3.6% {
				transform: scale(0.98);
			}
		}
	`;

	/** The agent session's phase category — picks the silhouette (circle / triangle / square) and
	 *  which layers (core / ring / waves) render. Reflected so consumers can key size/position CSS
	 *  off `gl-agent-mark[category="…"]` the same way the retired classes did. */
	@property({ reflect: true })
	category: AgentMarkCategory = 'idle';

	/** `default` is the in-flow size; `badge` is the smaller corner-overlay size (over the robot
	 *  identity icon). Reflected so consumers can key size overrides off the attribute if needed. */
	@property({ reflect: true })
	variant: GlAgentMarkVariant = 'default';

	override render(): unknown {
		// An idle agent gets no corner badge — see the class comment.
		if (this.category === 'idle' && this.variant === 'badge') return nothing;

		if (this.category === 'needs-input') return this.renderTriangle();

		return html`<span class="chip" aria-hidden="true"></span
			><span class="mark" aria-hidden="true"><span class="wave"></span></span>`;
	}

	private renderTriangle(): unknown {
		const points = '12,1.5 22.5,20 1.5,20';

		// Must use the `svg` tag function, not `html`: Lit parses an interpolated child template
		// standalone, so a bare `<polygon>` inserted via `${…}` from an `html`-tagged template
		// lands in the HTML namespace and never renders (gl-progress-ring.ts hits the same trap).
		// The waves are plain spans rather than polygons — see `.tri-wave`.
		return html`<span class="tri-chip" aria-hidden="true"></span
			><span class="tri-wave tri-wave--a" aria-hidden="true"></span
			><span class="tri-wave tri-wave--b" aria-hidden="true"></span>
			<svg viewBox="0 0 24 21" aria-hidden="true">
				${svg`<polygon class="tri-ring" points=${points}></polygon>
				<polygon class="tri-core" points=${points}></polygon>`}
			</svg>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-agent-mark': GlAgentMark;
	}
}
