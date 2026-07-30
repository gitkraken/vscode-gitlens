import { css } from 'lit';

export const overviewBarStyles = css`
	:host {
		display: block;
		flex: 0 0 auto;
		padding-block-end: 0.3rem;
		font-family: var(--font-family);
		background: var(--color-background);
		border-block-end: var(--gl-border-width) solid var(--vscode-panel-border, var(--color-foreground--25));
	}

	.bar {
		/* Flex so the single '.pills' child (flex: 0 0 auto) sizes to its content and overflows to scroll. */
		display: flex;
		overflow: auto hidden;
		scrollbar-width: none;

		/* Names this scroller as a timeline so the edge fades below bind their opacity to its scroll progress.
		   Physical 'x', not logical 'inline': a linear-gradient direction can't be expressed logically, so the
		   fades are physical anyway and a logical axis here would desync from them. */
		scroll-timeline: --bar-scroll x;
	}

	.bar::-webkit-scrollbar {
		display: none;
	}

	/* EDGE FADES — the only cue that pills are scrolled out of view, since the scrollbar is suppressed above
	   and the pan is wheel-driven. Sticky flex items pinned to the scrollport edges, pulled back out of the
	   flow by a negative margin so they contribute nothing to scrollWidth (which onWheel's pan math samples).

	   WHICH edge is faded rides a scroll timeline, not a scroll listener: the bar has none, so a wheel-only
	   hook would miss scrollbar drag and the keyboard focus() scroll-into-view. WHETHER there's anything to
	   fade is the '.is-overflowing' gate instead (see updateOverflowing) — once a scroll range collapses to
	   zero Chromium keeps the timeline reporting 100% rather than going inactive, which would strand a
	   start-edge fade over a bar that no longer overflows. No fill-mode avoids that; only the gate does.

	   Under forced colors the fades simply don't appear: a gradient isn't a forceable background, so the UA
	   drops it. That's the right outcome (no theme color smeared over the forced canvas), and it's why there
	   is no Canvas override here. */
	.bar.is-overflowing::before,
	.bar.is-overflowing::after {
		--_fade-width: 2.4rem;
		/* Matches what :host paints, so pills (translucent color-mix fills) dissolve into the bar's own
		   backdrop instead of under a foreign color. */
		--_fade-bg: var(--color-background);
		/* Hold the fade opaque for its first quarter before ramping — a bare edge-to-edge ramp over 2.4rem
		   never gets dark enough to read as "there's more", it just dims the pill. Same shape and width as
		   the commit-message scroller's fades, so both surfaces cut off identically. */
		--_fade: var(--_fade-bg) 25%, transparent;

		content: '';
		position: sticky;
		z-index: 1;
		flex: none;
		width: var(--_fade-width);
		pointer-events: none; /* the fades overlay live pill buttons */
		opacity: 0;
		animation: linear both;
		animation-timeline: --bar-scroll;
	}

	.bar.is-overflowing::before {
		left: 0;
		margin-right: calc(-1 * var(--_fade-width));
		background: linear-gradient(to right, var(--_fade));
		animation-name: scroll-fade-in;
	}

	.bar.is-overflowing::after {
		right: 0;
		margin-left: calc(-1 * var(--_fade-width));
		background: linear-gradient(to left, var(--_fade));
		animation-name: scroll-fade-out;
	}

	/* Same names as the commit-message scroller's fades (shadow-scoped, so no collision): '-in' appears once
	   scrolled off the start, '-out' disappears on reaching the end. */
	@keyframes scroll-fade-in {
		0% {
			opacity: 0;
		}
		2%,
		100% {
			opacity: 1;
		}
	}

	@keyframes scroll-fade-out {
		0%,
		98% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/* While a wheel-pan is animating, take the pills out of hit-testing so sliding them under a
	   stationary cursor doesn't fire per-frame hover work (see onWheel). Restored once it settles. */
	.bar.scrolling .pills {
		pointer-events: none;
	}

	.pills {
		display: flex;
		flex: 0 0 auto;
		gap: var(--gl-space-4);
		align-items: center;
		min-height: 2rem;
		padding: var(--gl-space-6) var(--gl-space-8);
	}

	/* The chip is the flex item; the popover only wraps the chip's main button (so hovering an
	   row-marker leg shows that leg's own tooltip instead of the branch hover). */
	.pill {
		display: inline-flex;
		flex: 0 0 auto;
		gap: 0.35rem;
		align-items: center;
		padding: 0.15rem 0.55rem;
		font-size: 1.05rem;
		line-height: 1.5;
		white-space: nowrap;
		background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
		border: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		border-radius: var(--gl-radius-sm);
	}

	/* The popover wraps the main button in an anchor box, so that button is no longer the flex item —
	   restore its sizing there. (gl-popover's own [slot='anchor'] is width: fit-content.) */
	gl-popover {
		flex: 0 0 auto;
	}

	/* Give icons the same line box as the text so flex centering is exact — must inherit BOTH (a unitless
	   line-height alone recomputes against each icon's own font-size). Same recipe as wip-stats. */
	.pill code-icon {
		font-size: inherit;
		line-height: inherit;
	}

	.pill:hover {
		background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
		border-color: color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent);
	}

	.pill--primary {
		background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
		border-color: var(--vscode-focusBorder);
	}

	.pill--selected {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}

	/* The selectable part of the chip: the roving tab stop, and the only control that opens the branch
	   hover. Unstyled as a button — the chip carries the visuals.

	   BLOCK-level flex, deliberately: as an inline-flex it sits in the popover's anchor line box, where its
	   inline baseline is synthesized from its FIRST flex item — .pill__dot, a text-less span whose bottom
	   margin edge becomes that baseline. That grew the line box past the row height and dropped the whole
	   group below the legs, so the branch name and the leg labels never shared a baseline. As a block the
	   anchor box has no baseline to derive, and both groups center on the same row. */
	.pill__main {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		padding: 0;
		font: inherit;
		color: inherit;
		white-space: nowrap;
		cursor: pointer;
		background: none;
		border: none;
	}

	/* Optical correction: an icon glyph fills its em box, so centering it in the row lands its ink center on
	   the row's center — but the row also reserves descender space the (lowercase-dominant) branch name never
	   uses, which leaves the text's own mass sitting lower and the icons reading high. Nudge the glyphs down
	   onto that mass. Uses the translate PROPERTY, not transform, so it composes with code-icon's own
	   flip/spin transforms instead of clobbering them. */
	.pill code-icon,
	.pill__dot {
		translate: 0 0.09em;
	}

	.pill__dot {
		width: 0.7rem;
		height: 0.7rem;
		background: var(--gl-agent-working-color);
		border-radius: 50%;
	}

	/* Icon + count read as one unit, so they stay tight against each other while the pill's own gap
	   separates them from the branch name. */
	.pill__agent {
		display: inline-flex;
		gap: 0.2rem;
		align-items: center;
	}

	.pill__agent-count {
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	/* Unpushed indicator — shares the canonical ahead/unpublished color (theme.scss :root token), the
	   same one the scope pane uses for unpushed commits. */
	.pill__unpushed-icon {
		color: var(--gl-tracking-ahead);
	}

	/* Pill icon shares the canonical agent palette (theme.scss :root tokens, always present in webviews —
	   referenced bare, matching tree-view / agent-tooltip). */
	.pill--agent-idle .pill__agent {
		color: var(--gl-agent-idle-color);
	}

	.pill--agent-working .pill__agent {
		color: var(--gl-agent-working-color);
	}

	.pill--agent-needs-input .pill__agent {
		color: var(--gl-agent-waiting-color);
	}

	/* ROW-MARKER LEGS — always visible at rest (a deliberate product decision: the bar is the persistent
	   "where am I" home, so its jumps must not be hover-reveal). Separated from the branch name by a hair-
	   line so the chip still reads as one unit. */
	.pill__legs {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		padding-inline-start: 0.35rem;
		border-inline-start: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
	}

	.pill__leg {
		display: inline-flex;
		gap: 0.2rem;
		align-items: center;
		padding: 0 0.2rem;
		font: inherit;
		line-height: inherit;
		color: inherit;
		background: none;
		border: none;
		border-radius: var(--gl-radius-xs);
	}

	.pill__leg--jump {
		cursor: pointer;
	}

	.pill__leg--jump:hover {
		background: color-mix(in srgb, currentcolor 20%, transparent);
	}

	/* Kind colors follow the graph's own row-marker-role vocabulary: HEAD green, upstream the deeper green of
	   the same family (same branch, elsewhere), merge-target purple. The fallbacks collapse head and upstream
	   onto one charts token — there's no darker-green counterpart in that palette — which is fine because they
	   only fire if the whole --gl-row-marker-* chain is missing, at which point the emphasis is already gone. */
	.pill__leg--head {
		color: var(--gl-row-marker-head, var(--vscode-charts-green));
	}

	.pill__leg--upstream {
		color: var(--gl-row-marker-upstream, var(--vscode-charts-green));
	}

	.pill__leg--target {
		color: var(--gl-row-marker-target, var(--vscode-charts-purple));
	}

	/* The upstream and merge-target legs name their ref (e.g. origin, main) — ellipsize if long. */
	.pill__leg-label {
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`;
