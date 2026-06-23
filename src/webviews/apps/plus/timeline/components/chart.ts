import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { getAltKeySymbol } from '@env/platform.js';
import type { CurrentUserNameStyle } from '@gitlens/git/utils/commit.utils.js';
import { formatIdentityDisplayName } from '@gitlens/git/utils/commit.utils.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { getCssVariable } from '@gitlens/utils/color.js';
import { defer } from '@gitlens/utils/promise.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { State, TimelineDatum, TimelineSliceBy } from '../../../../plus/timeline/protocol.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import { GlElement } from '../../../shared/components/element.js';
import { formatDate, fromNow } from '../../../shared/date.js';
import type { Disposable } from '../../../shared/events.js';
import { onDidChangeTheme } from '../../../shared/theme.js';
import type { TimelineBinUnit, TimelineViewModel } from './chart/timelineData.js';
import { buildViewModel, chooseBinUnit, isPseudoCommitDatum, probeViewModelDomain } from './chart/timelineData.js';
import type { TimelineDrawState, TimelineLayout, TimelineTheme } from './chart/timelineRenderer.js';
import {
	bubbleEdgePaddingPx,
	computeLayout,
	drawHeader,
	drawOverlay,
	drawSwimlanes,
	drawVolume,
	findNearestVolumeBar,
	formatY2,
	getAxisTicks,
	getHorizontalScrollbarGeometry,
	hitTestBubble,
	hitTestHorizontalScrollbar,
	hitTestVerticalScrollbar,
	hitTestVolumeBar,
	horizontalScrollbarDeltaToTimestampShift,
	pickRailColumnWidth,
	pickY2TickStops,
	railLeftOffsetPx,
	sliceVirtualCenterY,
	tsToX,
	verticalScrollbarDeltaToScrollY,
	volumeBarHeight,
	xToTs,
} from './chart/timelineRenderer.js';
import type { SliderChangeEventDetail } from './slider.js';
import { GlChartSlider } from './slider.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/indicators/watermark-loader.js';

const brushThresholdPx = 3;
const wheelZoomFactor = 0.001;
/** Absolute zoom-in floor: 1 hour. Picked so the natural minimum is "see individual commits" —
 *  scaling the floor against `windowSpanMs` (the configured period) instead produced effective
 *  floors in the weeks/months range for longer periods, leaving the zoom buttons no-op'ing well
 *  before the user reached useful granularity. */
const minVisibleSpanMs = 60 * 60 * 1000;

// Default 10-color categorical palette. Picked to read against both light and dark themes; can be
// overridden per-theme via `--color-timeline-slice-0` … `--color-timeline-slice-9` CSS variables.
const defaultSlicePalette: readonly string[] = [
	'#3D7EFF',
	'#FF9F40',
	'#1AB394',
	'#E91E63',
	'#9C27B0',
	'#8B5A2B',
	'#FF6B9D',
	'#7B7B7B',
	'#FFC107',
	'#26A69A',
];

export const tagName = 'gl-timeline-chart';

/**
 * Canvas-backed Visual File History chart. Owns the bubble swimlanes, volume histogram, slider footer,
 * and all interactions; the surrounding [timeline.ts](../timeline.ts) wires it to scope/period/sliceBy
 * state and forwards `gl-commit-select` selections to the host extension.
 */
@customElement(tagName)
export class GlTimelineChart extends GlElement {
	static readonly tagName = tagName;

	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		:host {
			position: relative;
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			outline: none;

			/* Trap the chart's internal z-ordinals (notice, tooltip, rail) so they can't compete
		   with app-level chrome — e.g. the loading progress-indicator at raised(1), which the
		   notice's z-index: 3 would otherwise cover and blur */
			isolation: isolate;

			/* Sizing constants shared between the canvas layout and the DOM rail overlay so the
	   rail's bottom edge lines up with the canvas's swimlane bottom (= top of axis label
	   strip). Keep in sync with the constants in timelineRenderer.ts:
	   volumeHeightPx (64) + axisLabelStripHeightPx (20) = 84px bottom offset; headerPaddingPx
	   (18) = top offset. */
			--rail-left-offset: 8px;
			--rail-column-width: 36px;
			--rail-edge-padding: 4px;
			--rail-bottom-offset: 0px;
			--timeline-glass-start: color-mix(in srgb, var(--vscode-editor-background) 42%, transparent);
			--timeline-glass-end: color-mix(in srgb, var(--vscode-editor-background) 28%, transparent);
			--timeline-glass-filter: blur(10px) saturate(1.45) brightness(1.08);
		}

		.rail {
			/* Overlays the canvas's left gutter. Avatars inside are positioned with absolute
	   canvas-Y coords, and the Y2 axis ("Lines changed") is rendered at the bottom.
	   The glass pane lives in ::before so text and avatars stay crisp above it. */
			position: absolute;
			top: 0;
			bottom: var(--rail-bottom-offset, 84px);
			left: 0;
			z-index: 2;
			width: calc(var(--rail-left-offset, 8px) + var(--rail-column-width, 36px) + var(--rail-edge-padding, 4px));
			overflow: visible;
			pointer-events: none;
		}

		.rail::before {
			position: absolute;
			inset: 0;
			pointer-events: none;
			content: '';
			background: linear-gradient(90deg, var(--timeline-glass-start), var(--timeline-glass-end));
			border-right: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-widget-border) 32%, transparent);
			box-shadow: inset -1px 0 0 color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
			-webkit-backdrop-filter: var(--timeline-glass-filter);
			backdrop-filter: var(--timeline-glass-filter);
		}

		.rail__avatar {
			position: absolute;
			left: calc(var(--rail-left-offset, 8px) + var(--rail-column-width, 36px) / 2);
			z-index: 1;
			padding: var(--gl-space-2);
			pointer-events: auto;
			cursor: pointer;
			background: transparent;
			border-radius: 50%;
			transform: translate(-50%, -50%);
			transition:
				transform var(--gl-duration-x-fast) var(--gl-ease-out),
				opacity var(--gl-duration-x-fast) var(--gl-ease-out),
				background var(--gl-duration-x-fast) var(--gl-ease-out);
		}

		.rail__avatar gl-tooltip {
			display: block;
		}

		.rail__avatar gl-avatar {
			display: block;
			border-radius: 50%;

			/* Slotted initials inherit color from gl-avatar's shadow .thumb--text rule (slot's own
	   color wins over light-DOM cascade). The --gl-avatar-text-color custom property
	   crosses the shadow boundary and pins the initials black against the slice color. */
			--gl-avatar-text-color: #000;
		}

		.rail__avatar gl-avatar::part(avatar) {
			font-weight: 700;
			background: var(--rail-avatar-color, transparent);
			box-shadow: 0 0 0 1.5px var(--rail-avatar-color, transparent);
		}

		/* gl-avatar has its own untransitioned hover-scale (1.2) — the rail wraps it in a
   hover-scaled outer element, so the inner scale doubles up and snaps instantly while
   the outer one smoothly transitions, producing visible jank. Suppress the inner hover
   scale here; the outer .rail__avatar:hover owns the hover affordance. */
		.rail__avatar gl-avatar::part(avatar):hover {
			transform: none;
		}

		.rail__avatar[data-dimmed='true'] {
			opacity: 0.35;
		}

		.rail__avatar[data-hidden='true'] {
			opacity: 0.3;
			filter: grayscale(0.85);
		}

		.rail__avatar[data-active='true'] {
			background: var(--vscode-list-hoverBackground);
		}

		.rail__avatar:hover {
			z-index: 4;
			transform: translate(-50%, -50%) scale(1.08);
		}

		/* Branch slice — rendered instead of an avatar when sliceBy='branch'. Default state is a
   24px circular badge in the slice color with a centered git-branch icon. Hover or
   chart-side activation expands max-width rightward to reveal the branch name as a
   pill that extends beyond the rail's right edge into the chart area. The rail itself
   has overflow: visible so the pill isn't clipped. */
		.rail__branch {
			position: absolute;

			/* Anchor the pill at a FIXED x — the icon's center lands where it would at the minimum
	   36px column width (= rail-left-offset + 18px - 12px = rail-left-offset + 6px), which
	   matches the author avatar's center at the same minimum rail. Anchoring to the *current*
	   column-mid would re-center the icon every time the column grew and leave a gap to the
	   left of the icon on widened rails — instead we keep the icon stationary and let only
	   the pill's right edge expand into the freed-up column space. */
			left: calc(var(--rail-left-offset, 8px) + 6px);
			z-index: 1;
			display: inline-flex;
			align-items: center;
			width: max-content;

			/* Collapsed pill is icon-only (24px = a dot, matching author avatars) at the min 36px
	   column width, and grows with --rail-column-width to reveal more of the branch name
	   on widened rails. Pill-right tracks the column's right edge minus a small inset so it
	   doesn't crowd the rail's edge padding. Hover/active still expands to 24rem for full
	   reveal. */
			max-width: calc(var(--rail-column-width, 36px) - 12px);
			height: 24px;
			overflow: hidden;
			color: #000;
			pointer-events: auto;
			cursor: pointer;
			background: var(--rail-avatar-color, transparent);
			border-radius: var(--gl-radius-xl);
			transform: translateY(-50%);
			transition:
				max-width var(--gl-duration-medium) var(--gl-ease-out),
				opacity var(--gl-duration-x-fast) var(--gl-ease-out);
		}

		.rail__branch gl-tooltip {
			display: contents;
		}

		.rail__branch-icon {
			display: inline-flex;
			flex: 0 0 24px;
			align-items: center;
			justify-content: center;
			width: 24px;
			height: 24px;
			--code-icon-size: 14px;
			--code-icon-v-align: unset;
		}

		.rail__branch-name {
			flex: 0 1 auto;
			max-width: 22rem;
			padding: 0 var(--gl-space-8) 0 var(--gl-space-2);
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: var(--gl-font-sm);
			font-weight: 600;
			white-space: nowrap;
		}

		.rail__branch:hover,
		.rail__branch[data-active='true'] {
			z-index: 4;
			max-width: 24rem;
		}

		.rail__branch[data-dimmed='true'] {
			opacity: 0.35;
		}

		.rail__branch[data-hidden='true'] {
			opacity: 0.3;
			filter: grayscale(0.85);
		}

		.rail-tooltip__name {
			font-weight: 600;
		}

		.rail-tooltip__meta {
			margin-top: 0.15rem;
			font-size: 0.85em;
			color: var(--color-foreground--75);
		}

		.rail-tooltip__hint {
			max-width: 16rem;
			margin-top: var(--gl-space-4);
			font-size: 0.8em;
			color: var(--color-foreground--50);
		}

		.rail__y2-title {
			position: absolute;
			left: calc(var(--rail-left-offset, 8px) + 2px);
			z-index: 1;
			font-size: var(--gl-font-micro);
			color: var(--color-foreground--75);
			white-space: nowrap;
			pointer-events: none;
			transform: translate(-50%, -50%) rotate(-90deg);
		}

		.rail__y2-tick {
			position: absolute;
			right: -4px;
			z-index: 1;
			width: 4px;
			height: 1px;
			background: var(--color-foreground--85);
			transform: translateY(-50%);
		}

		.rail__y2-label {
			position: absolute;
			right: 6px;
			z-index: 1;
			font-size: var(--gl-font-micro);
			color: var(--color-foreground--75);
			white-space: nowrap;
			pointer-events: none;
			transform: translateY(-50%);
		}

		.axis-overlay {
			position: absolute;
			left: 0;
			z-index: 2;
			width: 100%;
			overflow: visible;
			font-size: var(--gl-font-micro);
			line-height: 12px;
			color: var(--axis-label-color);
			pointer-events: none;
		}

		.axis-overlay__glass {
			position: absolute;
			top: 0;
			bottom: 0;
			background: linear-gradient(
				180deg,
				color-mix(in srgb, var(--vscode-editor-background) 68%, transparent),
				color-mix(in srgb, var(--vscode-editor-background) 56%, transparent)
			);
			border-top: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-widget-border) 22%, transparent);
			box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
			-webkit-backdrop-filter: var(--timeline-glass-filter);
			backdrop-filter: var(--timeline-glass-filter);
		}

		.axis-overlay__baseline {
			position: absolute;
			height: 1px;
			background: color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent);
		}

		.axis-overlay__tick {
			position: absolute;
			width: 1px;
			height: 5px;
			background: var(--axis-domain-color);
			transform: translateX(-50%);
		}

		.axis-overlay__label {
			position: absolute;
			bottom: 4px;
			font-size: var(--gl-font-micro);
			line-height: 12px;
			color: var(--axis-label-color);
			white-space: nowrap;
			transform: translateX(-50%);
		}

		.axis-overlay[data-compact='true'] .axis-overlay__label {
			top: 50%;
			bottom: auto;
			transform: translate(-50%, -50%);
		}

		.axis-overlay__scrollbar {
			position: absolute;
			background: color-mix(in srgb, var(--axis-scrollbar-track) 35%, transparent);
		}

		/* Thumb is translucent (but more opaque than the 35% track) so the date labels behind it stay
		   readable. Themes whose scrollbar tokens are fully opaque -- e.g. Amethyst Dark's opaque
		   purple hover slider -- would otherwise paint over the labels and blend into an unreadable
		   smear. */
		.axis-overlay__scrollbar-thumb {
			position: absolute;
			top: 0;
			height: 100%;
			background: color-mix(in srgb, var(--axis-scrollbar-thumb) 55%, transparent);
		}

		#wrapper {
			position: relative;
			flex: 1 1 auto;
			min-height: 0;
			overflow: visible;
			outline: none;
		}

		footer {
			display: flex;
			flex: 0 0 auto;
			gap: var(--gl-space-8);
			align-items: center;
			margin: 0 var(--gl-space-10) var(--gl-space-4);
		}

		gl-chart-slider {
			flex: 1 0 auto;
			margin-left: 1.4rem;
		}

		gl-commit-sha-copy {
			min-width: 7.5rem;
			margin-left: var(--gl-space-12);
			color: var(--color-foreground--75);
			text-align: right;
		}

		.actions {
			display: flex;
			gap: var(--gl-space-2);
			align-items: center;
		}

		canvas {
			display: block;
			width: 100%;
			height: 100%;
			cursor: default;
		}

		canvas[data-brushing='true'] {
			cursor: ew-resize;
		}

		.tooltip {
			position: absolute;
			z-index: 10;
			display: none;
			max-width: 320px;
			padding: var(--gl-space-6) var(--gl-space-8);
			font-size: var(--gl-font-sm);
			color: var(--vscode-editorHoverWidget-foreground, var(--color-hover-foreground));
			pointer-events: none;
			background: var(--vscode-editorHoverWidget-background, var(--color-hover-background));
			border: var(--gl-border-width) solid var(--vscode-editorHoverWidget-border, var(--color-hover-border));
			border-radius: var(--gl-radius-sm);
		}

		.tooltip[data-visible='true'] {
			display: block;
		}

		.tooltip .tooltip__author {
			margin-bottom: var(--gl-space-2);
			font-weight: 600;
		}

		.tooltip .tooltip__row {
			display: flex;
			gap: var(--gl-space-6);
			margin-top: var(--gl-space-2);
			color: var(--color-foreground--75);
		}

		.tooltip .tooltip__additions {
			color: var(--vscode-gitlens-timelineAdditionsColor, #49be47);
		}

		.tooltip .tooltip__deletions {
			color: var(--vscode-gitlens-timelineDeletionsColor, #c3202d);
		}

		.tooltip .tooltip__message {
			max-width: 300px;
			margin-top: var(--gl-space-4);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		@keyframes notice-fade-in {
			from {
				opacity: 0;
			}

			to {
				opacity: 1;
			}
		}

		.notice {
			position: absolute;
			inset: 0;
			z-index: 3;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			padding: 10% 2rem 30%;
			color: var(--color-foreground--75);
			pointer-events: none;
		}

		/* Re-enable pointer events on interactive content rendered into the empty slot
   (e.g. the timeframe dropdown shown when no commits match). The .notice wrapper
   stays click-through so the canvas behind keeps receiving hover/brush events. */
		::slotted([slot='empty']) {
			pointer-events: auto;
		}

		.notice--blur {
			opacity: 0;
			-webkit-backdrop-filter: blur(15px);
			backdrop-filter: blur(15px);
			animation: notice-fade-in var(--gl-duration-medium) var(--gl-ease-in) forwards;
		}

		:host([placement='view']) .notice--blur {
			animation-delay: 0.5s;
		}

		/* "Loading older history" affordance — the rail-edge line + scanner are the entire signal,
   bounded vertically to the swimlane region (below the header padding, above the x-axis).
   Top offset clears the small headerPaddingPx; bottom offset clears the volume strip
   (volumeHeightPx = 64px) so the line ends exactly at the x-axis tick line. Both are
   pointer-events:none so the chart stays fully interactive while paging is in flight. */
		.load-more-edge-line {
			position: absolute;

			/* Top sits at the host-set --load-more-top (the bottom of the breadcrumb header bar
	   inside the chart-host coordinate system). Bottom anchors at --load-more-bottom
	   (the X-axis baseline). Both are written by _ensureLayout from the actual layout
	   measurements, so the indicator always spans exactly header bottom → axis bottom
	   regardless of compact/full layouts. */
			top: var(--load-more-top, 0);
			bottom: var(--load-more-bottom, 6.4rem);
			left: calc(var(--rail-left-offset, 8px) + var(--rail-column-width, 36px) + var(--rail-edge-padding, 4px));

			/* z-index: 1 (below the rail's z-index: 2) so the box-shadow that bleeds LEFT into
	   the rail's column gets blurred by the rail's backdrop-filter — the glow appears
	   to ripple through the frosted glass as the scanner moves. The line itself sits
	   at left: rail-right-edge + 4px so the line's body is in the open chart area
	   (not under the rail), only the shadow extends into the rail and gets blurred. */
			z-index: 1;
			width: 0.1rem;

			/* clip-path: inset(top right bottom left). 0 = clip at edge, negative = extend.
	   - Top/bottom: clipped at 0 (no breadcrumb / volume-strip leak).
	   - Right: -0.5rem — just enough to keep the thumb body fully visible. The thumb is
	     wider than the 0.1rem line and centered on it via translate(-50%), so half of
	     it extends past the line's right edge into the chart area; clipping at right:0
	     would chop that half off. 0.5rem buffer fits the thumb without leaking the wide
	     rail-side glow rightward into the chart bubbles.
	   - Left: -100rem — huge, so the rail-side glow reaches across the rail unimpeded. */
			overflow: visible;
			pointer-events: none;
			background: color-mix(in srgb, var(--vscode-progressBar-background, #0078d4) 60%, transparent);
			box-shadow:
				-0.4rem 0 1.2rem 0.1rem
					color-mix(in srgb, var(--vscode-progressBar-background, #0078d4) 14%, transparent),
				-1.4rem 0 2.6rem 0.3rem
					color-mix(in srgb, var(--vscode-progressBar-background, #0078d4) 7%, transparent);
			clip-path: inset(0 -0.5rem 0 -100rem);
			animation: load-more-edge-line-pulse 1.6s var(--gl-ease-in-out) infinite;

			/* Hint the compositor that this element will animate so the browser promotes it to its
	   own layer. Keeps the pulse and the inner scanner running on the GPU instead of
	   triggering paint/layout on the chart canvas next to it. */
			will-change: opacity;
		}

		@keyframes load-more-edge-line-pulse {
			0%,
			100% {
				opacity: 0.7;
			}

			50% {
				opacity: 1;
			}
		}

		/* Moving spotlight that scans top→bottom along the line. Slim, bright body so it reads as
   a sharp sliding indicator rather than a soft trail. Animation drives transform
   (translateY) instead of top — keeps it on the GPU compositor, no per-frame layout. */
		.load-more-edge-line::after {
			position: absolute;
			top: 0;
			left: 50%;
			width: 0.25rem;
			height: 7%;
			content: '';

			/* Two-layer body, both with HARD edges (no gradient transitions): bottom is the
	   solid brand color filling the whole thumb; top is a centered hot-spot in
	   --vscode-editor-foreground (light on dark themes, dark on light themes) for an
	   inner highlight. border-radius alone gives the thumb its rounded ends — there
	   are no gradient fades at the edges so the thumb reads as a crisp solid object
	   instead of a fuzzy ball. */
			background:
				linear-gradient(
						180deg,
						transparent 0% 25%,
						var(--vscode-editor-foreground, white) 25% 75%,
						transparent 75% 100%
					)
					center / 100% 100% no-repeat,
				var(--vscode-progressBar-background, #0078d4);
			border-radius: var(--gl-radius-xs);

			/* Inset brand-color rim wraps the editor-foreground hot-spot so the body reads as a
	   bold layered "lit" object: brand-color shell with a bright contrast core. Then
	   the dispersed rail-side bloom (offset far left) is softened by the rail's
	   backdrop-filter. */
			box-shadow:
				inset 0 0 0 0.05rem var(--vscode-progressBar-background, #0078d4),
				-1.5rem 0 3rem 0.4rem color-mix(in srgb, var(--vscode-progressBar-background, #0078d4) 55%, transparent),
				-3rem 0 5rem 0.6rem color-mix(in srgb, var(--vscode-progressBar-background, #0078d4) 35%, transparent),
				-5rem 0 7rem 0.8rem color-mix(in srgb, var(--vscode-progressBar-background, #0078d4) 18%, transparent);

			/* Center horizontally and start above the line; the keyframes drive translateY
	   forward through the line. Setting transform here as the static base avoids a
	   first-frame jump between unset and the keyframes starting transform. */
			transform: translate(-50%, -120%);
			animation: load-more-edge-scanner 1.4s var(--gl-ease-in-out) infinite;
			will-change: transform, opacity;
		}

		@keyframes load-more-edge-scanner {
			0% {
				opacity: 0;
				transform: translate(-50%, -120%);
			}

			15% {
				opacity: 1;
			}

			85% {
				opacity: 1;
			}

			100% {
				opacity: 0;
				transform: translate(-50%, 1000%);
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.load-more-edge-line,
			.load-more-edge-line::after {
				animation: none;
			}

			.load-more-edge-line {
				opacity: 0.5;
			}

			.load-more-edge-line::after {
				opacity: 0;
			}
		}

		.a11y-live {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			white-space: nowrap;
			border: 0;
			clip-path: inset(50%);
		}
	`;

	@query('#canvas')
	private _canvas?: HTMLCanvasElement;

	@query('#tooltip')
	private _tooltipEl?: HTMLDivElement;

	@property()
	placement: 'editor' | 'view' | 'panel' = 'editor';

	@property()
	dateFormat!: string;

	@property({ type: String })
	head?: string;

	@property({ type: Object })
	scope?: State['scope'];

	@property()
	shortDateFormat!: string;

	@property()
	currentUserNameStyle: CurrentUserNameStyle = 'nameAndYou';

	@property()
	sliceBy: TimelineSliceBy = 'author';

	/**
	 * Width of the initial viewport in milliseconds. The host translates its period selector
	 * ("1Y", "6M", etc.) to ms and sets this prop. When set, `_zoomRange` is auto-anchored to
	 * `[newest - windowSpanMs, newest]` on fresh datasets — that's the canonical "unzoomed"
	 * state. Horizontal scroll pans further through history; zooming out beyond the dataset's
	 * left edge can fire `gl-load-more` (gated by `hasMore`). Falsy → use the loaded dataset's
	 * full span as the initial view (legacy behavior, no callers expected to rely on it).
	 */
	@property({
		type: Number,
		hasChanged: function (value: number | null, oldValue: number | null): boolean {
			if (value === oldValue) return false;
			if (value == null || oldValue == null) return true;
			// `periodToMs()` uses `Date.now()` and so returns a slightly different value on each
			// caller render (sub-second drift). Lit's default `===` change-detection would treat
			// every drift as a real change, firing `updated()` which would in turn reset
			// `_zoomRange` and clear `_zoomed` — wiping the user's zoom on every Lit cycle.
			// Tolerating sub-minute drift filters out the drift while still detecting genuine
			// period changes (1M → 1Y is a delta of months, not minutes).
			return Math.abs(value - oldValue) >= 60_000;
		},
	})
	windowSpanMs?: number;

	/**
	 * External "loading" signal — set to true by the host while a dataset fetch is in flight at the
	 * RPC level (option change → resource refetch). The chart's own `_loading` only fires when the
	 * `dataPromise` *prop* changes, which doesn't catch the host-side fetch since the resource keeps
	 * the previous dataset reference until the new one arrives. Without piping this through, option
	 * changes never showed the spinner.
	 */
	@property({ type: Boolean })
	loading = false;

	/**
	 * In `windowed` mode, set by the host while a "load more older history" fetch is in flight.
	 * Suppresses repeated `gl-load-more` emissions while a load is pending and drives the
	 * loading-gradient affordance at the chart's left edge.
	 */
	@property({ type: Boolean })
	loadingMore = false;

	/**
	 * In `windowed` mode, set by the host to `false` when there are no more older commits to
	 * load (the user has reached the repository's first commit). The chart suppresses
	 * `gl-load-more` when this is `false` and renders a muted "no more history" gradient instead
	 * of the loading-in-progress one.
	 */
	@property({ type: Boolean })
	hasMore = true;

	private _dataPromise: State['dataset'];
	@property({ type: Object })
	get dataPromise(): State['dataset'] {
		return this._dataPromise;
	}
	set dataPromise(value: State['dataset']) {
		if (this._dataPromise === value) return;

		this._dataPromise = value;
		void this._loadData();
	}

	@state() private _loading?: ReturnType<typeof defer<void>>;
	@state() private _data: TimelineDatum[] | null = null;
	@state() private _dataReversed?: TimelineDatum[];
	/** Built once per `_data` change; lets the slider scrub do an O(1) `ts → commit` lookup
	 *  instead of an O(n) Array.find on every drag tick. */
	private _commitByTs?: Map<number, TimelineDatum>;
	@state() private _selectedSha?: string;
	@state() private _shaHovered?: string;
	private _hoverIndex?: number;
	private _hoverVolumeIndex?: number;
	private _scrubSha?: string;
	@state() private _shiftKeyPressed = false;
	@state() private _zoomed = false;
	@state() private _hoverSliceIndex?: number;
	@state() private _renderTick = 0;
	@state() private _hiddenSlices: Set<number> = new Set();

	@query(GlChartSlider.tagName)
	private _slider?: GlChartSlider;

	private _ctx?: CanvasRenderingContext2D;
	private _layout?: TimelineLayout;
	private _theme?: TimelineTheme;
	private _viewModel?: TimelineViewModel;
	private _binUnit: TimelineBinUnit = 'none';

	private _zoomRange?: { oldest: number; newest: number };
	private _scrollY = 0;
	private _maxScrollY = 0;
	private _brushRange?: { startX: number; endX: number };
	private _isBrushing = false;
	private _isThumbDragging = false;
	private _thumbDragStartY = 0;
	private _thumbDragStartScrollY = 0;

	private _isHThumbDragging = false;
	private _hThumbDragStartX = 0;
	private _hThumbDragStartZoomOldest = 0;
	private _hThumbDragStartZoomNewest = 0;
	private _drawRAF: number | undefined;

	/**
	 * Cached `_zoomRange.oldest` value the chart last fired a `gl-load-more` for. Used to suppress
	 * repeated emissions while the host hasn't responded yet — without this, every rAF that runs
	 * the near-edge detector would fire a new event. Reset on dataset prop swap.
	 */
	private _loadMoreEmittedFor?: number;

	/**
	 * Hover animation state. When hover transitions, we don't drop the previous index immediately
	 * — instead we keep it as `_outgoingHoverIndex` while it fades out, and ramp the new
	 * `_hoverIndex` up. Each `_draw()` advances both intensities toward their targets and requests
	 * another frame until both reach steady state. ~140ms feels snappy without being jarring.
	 */
	private _hoverIntensity = 0;
	private _hoverIntensityTarget = 0;
	private _outgoingHoverIndex?: number;
	private _outgoingHoverIntensity = 0;
	private _lastFrameTime = 0;
	private static readonly _hoverAnimDurationMs = 140;

	private _resizeObserver?: ResizeObserver;
	private _themeDisposable?: Disposable;
	private _abortController?: AbortController;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._themeDisposable = onDidChangeTheme(() => {
			this._theme = undefined;
			this._axisLabelWidthCache.clear();
			// Pre-resolve so DOM overlays (rail, axis) reading `this._theme` during the next
			// Lit render cycle see fresh CSS-var values instead of `undefined`/defaults — the
			// rAF-deferred canvas redraw alone wouldn't update them in time.
			this._ensureTheme();
			// `_renderTick` is `@state` and is read by both `_renderRail` and `_renderAxisOverlay`,
			// so bumping it forces Lit to re-render those overlays alongside the canvas redraw.
			this._renderTick++;
			this._requestDraw();
		});
		this._resizeObserver = new ResizeObserver(() => {
			this._layout = undefined;
			this._requestDraw();
		});
		document.addEventListener('keydown', this._onDocumentKeyDown);
		document.addEventListener('keyup', this._onDocumentKeyUp);
		// Observed on the wrapper element after first render — see firstUpdated.
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._themeDisposable?.dispose();
		this._themeDisposable = undefined;
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		this._abortController?.abort();
		this._abortController = undefined;
		if (this._drawRAF != null) {
			cancelAnimationFrame(this._drawRAF);
			this._drawRAF = undefined;
		}
		document.removeEventListener('keydown', this._onDocumentKeyDown);
		document.removeEventListener('keyup', this._onDocumentKeyUp);
		this._loading?.cancel();
	}

	private readonly _onDocumentKeyDown = (e: KeyboardEvent): void => {
		if (this._shiftKeyPressed !== e.shiftKey) {
			this._shiftKeyPressed = e.shiftKey;
		}
	};

	private readonly _onDocumentKeyUp = (e: KeyboardEvent): void => {
		if (this._shiftKeyPressed !== e.shiftKey) {
			this._shiftKeyPressed = e.shiftKey;
		}
	};

	protected override firstUpdated(): void {
		if (this._canvas == null) return;

		this._ctx = this._canvas.getContext('2d', { alpha: false }) ?? undefined;
		const wrapper = this.shadowRoot?.getElementById('wrapper');
		if (wrapper && this._resizeObserver) {
			this._resizeObserver.observe(wrapper);
		}
		this._requestDraw();
	}

	/** Tracks the last `windowSpanMs` value that triggered the `updated()` reset. We compare
	 *  against this instead of relying on `changed.has('windowSpanMs')` because `periodToMs()`
	 *  produces sub-second-drifted values per parent render, and either Lit's `hasChanged` (set
	 *  on the @property) gets bypassed in some update cycles or Lit accumulates the drift
	 *  across cycles — empirically the `changed` map flagged `windowSpanMs` as changed even
	 *  when no real period change happened, wiping the user's zoom. Tracking the last-applied
	 *  value ourselves makes the reset gate robust to whatever Lit is doing.
	 *
	 *  Stored as `{ value }` (a wrapper) instead of `number | undefined` so we can distinguish
	 *  "never set" (the wrapper itself is undefined) from "set to undefined" (the wrapper is
	 *  present, its `value` is undefined — this is the `'all time'` period state). Without the
	 *  wrapper, `prevReset == null` collapses both cases together and we can't detect the
	 *  windowed → `'all'` transition. */
	private _lastResetWindowSpanMs?: { value: number | undefined };

	/** Last-seen scope identity (`type::uri::relativePath`) — used to detect a genuine file/
	 *  folder change in `updated()` while ignoring scope reference swaps that come from the
	 *  host re-emitting the same scope with enriched `head`/`base`. */
	private _lastScopeKey?: string;

	protected override updated(changed: Map<PropertyKey, unknown>): void {
		// Detect a GENUINE scope change (different file/folder), not just a reference swap from
		// the host re-emitting the same scope with enriched `head`/`base` after each fetch —
		// the latter creates a new object reference per fetch and would wipe `_zoomRange` that
		// `_loadData` just set. Compare by identity tuple `(type, uri, relativePath)`.
		const scopeKey =
			this.scope != null ? `${this.scope.type}::${this.scope.uri}::${this.scope.relativePath ?? ''}` : undefined;
		const scopeChanged = scopeKey !== this._lastScopeKey;
		if (scopeChanged) {
			this._lastScopeKey = scopeKey;
		}
		if (changed.has('sliceBy') || changed.has('head') || scopeChanged) {
			this._viewModel = undefined;
			this._zoomRange = undefined;
			this._scrollY = 0;
		}
		// Reset on genuine period change. The reset has two shapes:
		//   • Windowed period (`windowSpanMs != null`) → reseed `_zoomRange` to `[newest -
		//     windowSpanMs, newest]` so the chart re-anchors to the new timeframe.
		//   • `'all'` period (`windowSpanMs == null`) → clear `_zoomRange` so the chart shows
		//     the full dataset. Skipping this branch (the previous bug) left `_zoomRange`
		//     stuck at the prior windowed range, so picking `'all'` after `1 month` looked
		//     like nothing happened.
		// Gated on a real period change (>= 60s delta or a null transition) — sub-second
		// `Date.now()` drift in `periodToMs()` would otherwise fire this reset every parent
		// render and wipe the user's zoom. Initial-on-data-arrival seeding is in `_loadData`.
		const prevWrapper = this._lastResetWindowSpanMs;
		const prev = prevWrapper?.value;
		const curr = this.windowSpanMs ?? undefined;
		const nullTransition = prevWrapper != null && (prev == null) !== (curr == null);
		const numericChange = prev != null && curr != null && Math.abs(curr - prev) >= 60_000;
		const isInitial = prevWrapper == null;
		if (isInitial || nullTransition || numericChange) {
			this._lastResetWindowSpanMs = { value: curr };
			if (curr == null) {
				this._zoomRange = undefined;
				this._zoomed = false;
				this._loadMoreEmittedFor = undefined;
			} else {
				const anchorNewest = this._zoomRange?.newest ?? this._data?.[0]?.sort;
				if (anchorNewest != null) {
					this._zoomRange = { oldest: anchorNewest - curr, newest: anchorNewest };
					this._zoomed = false;
					this._loadMoreEmittedFor = undefined;
				}
			}
		}
		// Emit the visible range here too — `_draw` bails on null viewModel (empty datasets), so
		// without this the pill stays stale on period changes between empty time ranges. Helper
		// dedupes via the last-emitted range so the in-`_draw` call is unaffected.
		this._maybeEmitVisibleRange();
		this._requestDraw();
	}

	private async _loadData(): Promise<void> {
		this._abortController?.abort();
		this._abortController = new AbortController();
		const signal = this._abortController.signal;

		if (!this._loading?.pending) {
			this._loading = defer<void>();
			void this._loading.promise.finally(() => (this._loading = undefined));
			this.emit('gl-loading', this._loading.promise);
		}

		if (this._dataPromise == null) {
			this._data = null;
			this._commitByTs = undefined;
			this._viewModel = undefined;
			this._loading?.fulfill();
			return;
		}

		try {
			const data = await this._dataPromise;
			if (signal.aborted) {
				this._loading?.cancel();
				return;
			}

			// Detect "soft refresh": the dataset reference changed but the visible data is the
			// same shape — the user's scroll/zoom/selection should survive. Catches:
			//   - Host appended older commits, right edge unchanged (load-more extension)
			//   - Stats arrived after rows (additions/deletions populate post-fetch)
			//   - Scope object got reassigned (e.g., reachability propagated) but the same
			//     commits are at top
			//   - Leading WIP transitioned between empty placeholder ('') and a real uncommitted
			//     sha — both shapes are pseudo-commits at "now" so the rest of the dataset is
			//     unchanged; we don't want the first keystroke after a clean state to drop the
			//     user's zoom/selection.
			// Genuine resets (period change, scope change to a different file/folder) come
			// through `sliceBy`/`head`/`windowSpanMs` change in `updated()` and reset there.
			const prevNewestTs = this._data?.[0]?.sort;
			const newNewestTs = data?.[0]?.sort;
			const prevNewestSha = this._data?.[0]?.sha;
			const newNewestSha = data?.[0]?.sha;
			const prevLeadingPseudo = this._data?.[0] != null && isPseudoCommitDatum(this._data[0]);
			const newLeadingPseudo = data?.[0] != null && isPseudoCommitDatum(data[0]);
			const isExtension =
				prevNewestTs != null &&
				newNewestTs != null &&
				prevNewestTs === newNewestTs &&
				(this._data?.length ?? 0) < (data?.length ?? 0);
			const isSoftRefresh =
				(prevNewestSha != null && newNewestSha != null && prevNewestSha === newNewestSha) ||
				(prevLeadingPseudo && newLeadingPseudo);

			this._data = data;
			this._dataReversed = data?.toReversed();
			this._commitByTs = undefined;
			this._viewModel = undefined;

			if (!isExtension && !isSoftRefresh) {
				// Fresh dataset (period change, scope change, initial load): reset all transient
				// viewport / selection / scroll state.
				this._zoomRange = undefined;
				this._zoomed = false;
				this._scrollY = 0;

				// Auto-select the most recent commit visually so the chart highlights the working
				// tree on first paint. Emit `gl-commit-select` with `auto: true` ONLY on the
				// genuine first paint (no prior selection) so consumers can reflect the initial
				// selection — the standalone host skips its diff-editor RPC for `auto` events, the
				// embedded graph timeline forwards them to its details panel. Subsequent fresh
				// datasets (period / scope change) keep the prior `_selectedSha`-set state out of
				// the emit so we don't yank a commit the user picked.
				const hadSelection = this._selectedSha != null;
				this._selectedSha = data[0]?.sha;
				if (!hadSelection && this._selectedSha != null) {
					this.emit('gl-commit-select', { id: this._selectedSha, shift: false, auto: true });
				}

				// Seed `_zoomRange` to the configured timeframe anchored at the newest commit
				// when `windowSpanMs` is set. That's the "unzoomed" canonical default — the
				// timeframe IS the view, so `_zoomed = false` (zoom-out icon hidden). User can
				// zoom IN past the timeframe; zooming back out snaps to this default. For
				// empty datasets (no commits, no WIP placeholder), `newNewestTs` is undefined
				// and we anchor at `Date.now()` so the chart still has a meaningful zoom range
				// — otherwise `_zoomRange` ends up undefined and the X-axis / pill go stale on
				// period changes between empty time ranges.
				if (this.windowSpanMs != null) {
					const anchorTs = newNewestTs ?? Date.now();
					this._zoomRange = { oldest: anchorTs - this.windowSpanMs, newest: anchorTs };
					this._zoomed = false;
				}
			}
			// Either way, clear the per-frame load-more debounce so a fresh dataset can fire a
			// new request if the user is still scrolled near the left edge.
			this._loadMoreEmittedFor = undefined;

			// Run a synchronous draw if the canvas is ready, so the *next* Lit render (which
			// fires from this `_data = data` mutation via its `@state` setter) sees a populated
			// `_viewModel` and the rail / axis-overlay don't briefly disappear during the
			// chunk-merge window. Without this, the sequence is:
			//   1. `_data = data` triggers Lit's update microtask
			//   2. Microtask fires `render()` → `_renderRail` reads `_viewModel` (undefined) → nothing
			//   3. rAF fires `_draw()` → rebuilds viewModel → forces another render → rail returns
			// The user sees an empty rail for 1 frame between steps 2 and 3 on every chunk merge.
			// Drawing here closes the gap because step 1 fires LATER as a microtask, after this
			// synchronous block returns; by then `_viewModel` is already populated.
			if (this._ctx != null) {
				this._draw();
			} else {
				this._requestDraw();
			}
			this._loading?.fulfill();
		} catch {
			this._data = null;
			this._commitByTs = undefined;
			this._loading?.cancel();
		}
	}

	override render(): unknown {
		const showLoadMoreIndicator = this.loadingMore && this.hasMore && (this._data?.length ?? 0) > 0;
		return html`<div id="wrapper" tabindex="0" aria-label=${this._a11yWrapperLabel} @keydown=${this._onKeyDown}>
				${this._renderNotice()}
				<canvas
					id="canvas"
					data-brushing=${this._isBrushing ? 'true' : 'false'}
					@pointerdown=${this._onPointerDown}
					@pointermove=${this._onPointerMove}
					@pointerup=${this._onPointerUp}
					@pointerleave=${this._onPointerLeave}
					@wheel=${this._onWheel}
				></canvas>
				${this._renderRail()} ${this._renderAxisOverlay()}
				${showLoadMoreIndicator
					? html`<div
							class="load-more-edge-line"
							aria-label="Loading older history"
							role="progressbar"
						></div>`
					: nothing}
				<div id="tooltip" class="tooltip"></div>
				${this._renderA11yLive()}
			</div>
			${this._data?.length ? this._renderFooter() : nothing}`;
	}

	/**
	 * Per-slice avatar column — sits in its own gutter to the left of the canvas wrapper, never
	 * overlapping the chart area. Each row is a `<gl-avatar>` (gravatar when an email is available,
	 * initials otherwise) ringed in the slice's color so the rail doubles as the chart legend.
	 * Hover pins the slice (canvas dims other rows + volume columns); click toggles visibility.
	 */
	private _renderRail(): unknown {
		const lo = this._layout;
		const vm = this._viewModel;
		if (lo == null || vm == null) return nothing;

		// `_renderTick` is read so Lit re-runs this when scroll / row height / dataset changes.
		void this._renderTick;

		const palette = this._theme?.slicePalette ?? defaultSlicePalette;
		// Fixed avatar size — sized to fit comfortably inside the 36px rail column with consistent
		// visual weight regardless of how tall the row is. (Previously scaled with rowHeight up to
		// 28px, which both overflowed the rail column and caused the cull check below to drop the
		// last avatar on short canvases.)
		const railSize = 24;
		const sliceBy = this.sliceBy;
		const items = vm.slices.map((slice, i) => {
			const cy = lo.swimlaneTop + lo.swimlaneTopBufferPx + i * lo.rowHeight + lo.rowHeight / 2 - this._scrollY;
			// Cull only when the avatar's center falls outside the swimlane region — the rail has
			// `overflow: visible` so partial overflow into the axis-strip area is acceptable, and
			// it's far better than dropping an avatar entirely. The original tighter check (cy ±
			// avatarHalf) caused the last slice's avatar to disappear on short canvases.
			if (cy < lo.swimlaneTop || cy > lo.swimlaneBottom) {
				return nothing;
			}

			const dimmed = this._hoverSliceIndex != null && this._hoverSliceIndex !== i;
			const active = this._hoverSliceIndex === i;
			const hidden = this._hiddenSlices?.has(i) === true;
			const color = palette[slice.colorIndex % palette.length];
			// "Solo" pinpoints just this slice; "Unsolo" restores the rest. Both alt-click and a
			// plain click on the soloed slice run the same revert path.
			const isSoloed = !hidden && vm.slices.length > 1 && this._hiddenSlices.size === vm.slices.length - 1;
			const clickAction = isSoloed ? 'Unsolo' : hidden ? 'Show' : 'Hide';
			const altAction = isSoloed ? 'Unsolo' : 'Solo';
			const hint = `Click to ${clickAction} · [${getAltKeySymbol()}] Click to ${altAction}`;
			const meta = slice.commitCount != null ? pluralize('commit', slice.commitCount) : '';

			if (sliceBy === 'branch') {
				// Tooltip placement is "bottom-start" so it sits below the icon and clears the
				// expanding pill on hover (placement="right" would land underneath the pill once it
				// grew rightward). The pill itself already shows the branch name, so the tooltip
				// drops the redundant name and just carries commit count + click hint.
				return html`<div
					class="rail__branch"
					data-dimmed=${dimmed ? 'true' : 'false'}
					data-active=${active ? 'true' : 'false'}
					data-hidden=${hidden ? 'true' : 'false'}
					style=${cspStyleMap({ top: `${cy}px`, '--rail-avatar-color': color })}
					@pointerenter=${() => this._setSliceHover(i)}
					@pointerleave=${() => this._setSliceHover(undefined)}
					@click=${(e: MouseEvent) => this._toggleSlice(i, e)}
				>
					<gl-tooltip placement="bottom-start" distance=${8}>
						<span class="rail__branch-icon"><code-icon icon="git-branch"></code-icon></span>
						<span class="rail__branch-name">${slice.name}</span>
						<div slot="content">
							${meta ? html`<div class="rail-tooltip__meta">${meta}</div>` : nothing}
							<div class="rail-tooltip__hint">${hint}</div>
						</div>
					</gl-tooltip>
				</div>`;
			}

			const initials = computeInitials(slice.name);
			const displayName = formatIdentityDisplayName(
				{ name: slice.name, current: slice.current },
				this.currentUserNameStyle,
			);
			return html`<div
				class="rail__avatar"
				data-dimmed=${dimmed ? 'true' : 'false'}
				data-active=${active ? 'true' : 'false'}
				data-hidden=${hidden ? 'true' : 'false'}
				style=${cspStyleMap({
					top: `${cy}px`,
					'--rail-avatar-color': color,
					'--gl-avatar-size': `${railSize}px`,
				})}
				@pointerenter=${() => this._setSliceHover(i)}
				@pointerleave=${() => this._setSliceHover(undefined)}
				@click=${(e: MouseEvent) => this._toggleSlice(i, e)}
			>
				<gl-tooltip placement="right" distance=${10}>
					<gl-avatar .src=${slice.avatarUrl}>${initials}</gl-avatar>
					<div slot="content">
						<div class="rail-tooltip__name">${displayName}</div>
						${meta ? html`<div class="rail-tooltip__meta">${meta}</div>` : nothing}
						<div class="rail-tooltip__hint">${hint}</div>
					</div>
				</gl-tooltip>
			</div>`;
		});

		let y2Axis: unknown = nothing;
		if (lo.chartLeft > 0) {
			const yMax = Math.max(1, vm.yMaxAdd + vm.yMaxDel);
			// Bars grow upward from `volumeBottom`, so the Y2 baseline (value = 0) is the bottom
			// of the strip and tick Ys are computed by SUBTRACTING the bar height from there.
			const baselineY = lo.volumeBottom;
			const farY = lo.volumeTop;
			const usableH = Math.max(0, baselineY - farY - 2);

			// Pick the tick count by available height (each 10px label needs ~14px breathing room).
			// Below ~14px usable: skip ticks entirely so labels don't pile on top of each other.
			let tickCount = 0;
			if (usableH >= 50) {
				tickCount = 3;
			} else if (usableH >= 30) {
				tickCount = 2;
			} else if (usableH >= 14) {
				tickCount = 1;
			}

			// "Lines changed" rotates -90° and runs vertically through the strip — it needs ~50px
			// to read without clipping into the swimlane bubbles above.
			const showTitle = usableH >= 50;

			if (tickCount > 0 || showTitle) {
				const stops = tickCount > 0 ? pickY2TickStops(yMax, tickCount) : [];
				const y2Ticks = stops.map(v => {
					const y = baselineY - volumeBarHeight(v, yMax, usableH);
					const top = `${y}px`;
					return html`
						<div class="rail__y2-tick" style=${cspStyleMap({ top: top })}></div>
						<div class="rail__y2-label" style=${cspStyleMap({ top: top })}>${formatY2(v)}</div>
					`;
				});

				y2Axis = html`
					${showTitle
						? html`<div class="rail__y2-title" style=${cspStyleMap({ top: `${(baselineY + farY) / 2}px` })}>
								Lines changed
							</div>`
						: nothing}
					${y2Ticks}
				`;
			}
		}

		return html`<aside class="rail" aria-label="Authors">${items} ${y2Axis}</aside>`;
	}

	private _renderAxisOverlay(): unknown {
		const lo = this._layout;
		const vm = this._viewModel;
		const theme = this._theme;
		if (lo == null || vm == null || theme == null) return nothing;

		void this._renderTick;

		const oldest = this._zoomRange?.oldest ?? vm.oldest;
		const newest = this._zoomRange?.newest ?? vm.newest;
		const axisHeight = lo.axisStripBottom - lo.axisStripTop;
		if (axisHeight <= 0 || newest <= oldest) return nothing;

		const ticks = getAxisTicks(
			lo,
			oldest,
			newest,
			(date, unit, opts) => formatTickLabel(date, unit, this.shortDateFormat, opts),
			label => this._measureAxisLabelWidth(label),
		);
		const scrollbar = this._hasHorizontalOverflow
			? getHorizontalScrollbarGeometry(lo, vm.oldest, vm.newest, this._zoomRange!)
			: undefined;

		// Compact mode kicks in when the volume strip is hidden (very short canvas) — the axis
		// strip shrinks to ~12px to match the scrollbar footprint, and the tick nubs are dropped
		// since they don't fit cleanly in that height.
		const compact = lo.volumeBottom - lo.volumeTop <= 0;

		const overlayStyle = {
			top: `${lo.axisStripTop}px`,
			height: `${axisHeight}px`,
			'--axis-label-color': theme.axisLabel,
			'--axis-domain-color': theme.axisDomain,
			'--axis-scrollbar-track': theme.scrollThumb,
			'--axis-scrollbar-thumb': theme.scrollThumbHover,
		};
		const glassStyle = { left: `${lo.chartLeft}px`, width: `${lo.chartRight - lo.chartLeft}px` };
		const baselineStyle = {
			left: `${lo.chartLeft}px`,
			top: `${axisHeight - 1}px`,
			width: `${lo.chartRight - lo.chartLeft}px`,
		};

		return html`<div
			class="axis-overlay"
			data-compact=${compact ? 'true' : 'false'}
			aria-hidden="true"
			style=${cspStyleMap(overlayStyle)}
		>
			<div class="axis-overlay__glass" style=${cspStyleMap(glassStyle)}></div>
			<div class="axis-overlay__baseline" style=${cspStyleMap(baselineStyle)}></div>
			${ticks.map(tick => {
				const left = `${tick.x}px`;
				return compact
					? html`<div class="axis-overlay__label" style=${cspStyleMap({ left: left })}>${tick.label}</div>`
					: html`<div
								class="axis-overlay__tick"
								style=${cspStyleMap({ left: left, top: `${axisHeight - 2}px` })}
							></div>
							<div class="axis-overlay__label" style=${cspStyleMap({ left: left })}>${tick.label}</div>`;
			})}
			${scrollbar != null
				? html`<div
						class="axis-overlay__scrollbar"
						style=${cspStyleMap({
							left: `${scrollbar.trackX}px`,
							top: `${scrollbar.trackY - lo.axisStripTop}px`,
							width: `${scrollbar.trackWidth}px`,
							height: `${scrollbar.trackHeight}px`,
						})}
					>
						<div
							class="axis-overlay__scrollbar-thumb"
							style=${cspStyleMap({
								left: `${scrollbar.thumbX - scrollbar.trackX}px`,
								width: `${scrollbar.thumbWidth}px`,
							})}
						></div>
					</div>`
				: nothing}
		</div>`;
	}

	private _setSliceHover(index: number | undefined): void {
		if (this._hoverSliceIndex === index) return;

		this._hoverSliceIndex = index;
		this._requestDraw();
	}

	/**
	 * Toggle slice visibility. Plain click toggles one slice (or unsolos when the slice is the
	 * only one currently visible). Alt-click solos (or unsolos when already soloed). The "soloed
	 * slice clicked = unsolo" shortcut means a user who solo-clicked their way in can revert with
	 * one more click on the same avatar instead of having to remember the modifier.
	 */
	private _toggleSlice(index: number, e: MouseEvent): void {
		e.stopPropagation();
		const vm = this._viewModel;
		if (vm == null) return;

		const totalSlices = vm.slices.length;
		const hidden = this._hiddenSlices ?? new Set<number>();
		const isAlreadySolo = !hidden.has(index) && totalSlices > 1 && hidden.size === totalSlices - 1;

		if (e.altKey) {
			// Solo (or unsolo): if this slice is the only one visible, restore everyone; otherwise
			// hide every slice except this one.
			if (isAlreadySolo) {
				this._hiddenSlices = new Set();
			} else {
				const next = new Set<number>();
				for (let i = 0; i < totalSlices; i++) {
					if (i !== index) {
						next.add(i);
					}
				}
				this._hiddenSlices = next;
			}
		} else if (isAlreadySolo) {
			// Plain click on the soloed slice = unsolo. Saves the user from having to alt-click
			// to revert when they may not remember the modifier.
			this._hiddenSlices = new Set();
		} else {
			// Plain click: toggle this slice's visibility.
			const next = new Set(hidden);
			if (next.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			this._hiddenSlices = next;
		}
		this._requestDraw();
	}

	private _renderFooter(): unknown {
		const sha = this._shaHovered ?? this._selectedSha;
		return html`<footer>
			<gl-chart-slider
				.data=${this._dataReversed}
				?shift=${this._shiftKeyPressed}
				@gl-slider-change=${this._onSliderChanged}
			></gl-chart-slider>
			<gl-commit-sha-copy .sha=${sha} .size=${16}></gl-commit-sha-copy>
			<div class="actions">
				${this._zoomed
					? html`<gl-button
							appearance="toolbar"
							@click=${(e: MouseEvent) => (e.shiftKey || e.altKey ? this.resetZoom() : this._zoomBy(-1))}
							aria-label="Zoom Out"
						>
							<code-icon icon="zoom-out"></code-icon>
							<span slot="tooltip">Zoom Out<br />${getAltKeySymbol()} Reset Zoom</span>
						</gl-button>`
					: nothing}
				<gl-button
					appearance="toolbar"
					@click=${() => this._zoomBy(0.5)}
					tooltip="Zoom In"
					aria-label="Zoom In"
				>
					<code-icon icon="zoom-in"></code-icon>
				</gl-button>
			</div>
		</footer>`;
	}

	/** Lazy `ts → commit` lookup for the slider's scrub path. Slider events fire continuously
	 *  during drag — building this map once per dataset is the difference between O(1) per tick
	 *  and an O(n) `Array.find` over thousands of commits. Cleared in `_loadData()` whenever
	 *  `_data` is reassigned or cleared. */
	private _lookupCommitByTs(ts: number): TimelineDatum | undefined {
		if (this._commitByTs == null) {
			const map = new Map<number, TimelineDatum>();
			if (this._data != null) {
				for (const c of this._data) {
					map.set(c.sort, c);
				}
			}
			this._commitByTs = map;
		}
		return this._commitByTs.get(ts);
	}

	private readonly _onSliderChanged = (e: CustomEvent<SliderChangeEventDetail>): void => {
		const ts = e.detail.date.getTime();
		const commit = this._lookupCommitByTs(ts);
		if (commit == null) return;

		this._selectedSha = commit.sha;

		// While the user is dragging, treat the slider thumb as a virtual hover — drive the same
		// halo/scale/ring as a real pointer hover and surface the DOM tooltip — so the focused
		// commit is unmistakable in dense swimlanes. On release, fade the hover out and let the
		// quieter selection ring stand alone. Index/position resolution runs at draw-time
		// (`_resolveScrubHover`) so the auto-pan-driven viewModel rebuild below is the one read.
		if (e.detail.interim) {
			this._scrubSha = commit.sha;
			this._shaHovered = commit.sha;
			// Clear any leftover volume-strip spotlight from before the scrub started — once the
			// slider owns hover, pointer-driven volume highlights would compete with the scrub.
			this._hoverVolumeIndex = undefined;
		} else {
			this._scrubSha = undefined;
			this._shaHovered = undefined;
			this._setHover(undefined);
			this._hideTooltip();
		}

		// If the commit is outside the current zoom window, slide the window so it's visible —
		// matches the legacy chart's `revealDate` behavior. Clamp to the dataset bounds so
		// scrubbing to the newest commit (e.g., the WIP at `Date.now()`) doesn't center the
		// window on it and leave the right half showing empty future dates.
		if (this._zoomRange != null) {
			const span = this._zoomRange.newest - this._zoomRange.oldest;
			if (ts < this._zoomRange.oldest || ts > this._zoomRange.newest) {
				const half = span / 2;
				let newOldest = ts - half;
				let newNewest = ts + half;
				// Bounds come from `this._data` (always defined when a slider event fires) rather
				// than `this._viewModel`, which is `undefined` between renders — including during
				// a fast scrub where multiple slider events fire before the next `_draw` rebuilds
				// vm. Reading vm directly would skip this clamp mid-drag and let `newest` drift
				// to `ts + half`, which extends past `Date.now()` whenever `ts` is at the latest
				// commit. Dataset is sorted newest-first by the producer, so `data[0]` is newest
				// and `data[length - 1]` is oldest.
				const data = this._data;
				if (data != null && data.length > 0) {
					const dataNewest = data[0].sort;
					const dataOldest = data.at(-1)!.sort;
					if (newNewest > dataNewest) {
						newOldest -= newNewest - dataNewest;
						newNewest = dataNewest;
					}
					if (newOldest < dataOldest) {
						newNewest += dataOldest - newOldest;
						newOldest = dataOldest;
					}
					newOldest = Math.max(dataOldest, newOldest);
					newNewest = Math.min(dataNewest, newNewest);
				}
				this._zoomRange = { oldest: newOldest, newest: newNewest };
				this._viewModel = undefined;
			}
		}

		// Pass `interim` along so `actions.selectDataPoint` can skip the host RPC during scrub —
		// the diff editor only opens when the user releases the slider thumb.
		this.emit('gl-commit-select', { id: commit.sha, shift: e.detail.shift, interim: e.detail.interim });
		this._requestDraw();
	};

	/**
	 * Resolve `_scrubSha` against the current viewModel and drive `_setHover` + `_showTooltip` from
	 * the bubble's actual canvas position. Runs inside `_draw` so the rebuilt viewModel from a
	 * scrub-triggered auto-pan is the one consulted (and so the freshly-set `_hoverIndex` lands in
	 * the same frame's draw state instead of one frame late).
	 */
	private _resolveScrubHover(): void {
		if (this._scrubSha == null || this._viewModel == null || this._layout == null) return;

		const index = this._viewModel.shaToIndex.get(this._scrubSha);
		if (index == null) {
			this._setHover(undefined);
			this._hideTooltip();
			return;
		}

		this._setHover(index);

		const lo = this._layout;
		const vm = this._viewModel;
		const oldest = this._zoomRange?.oldest ?? vm.oldest;
		const newest = this._zoomRange?.newest ?? vm.newest;
		const cx = tsToX(vm.timestamps[index], oldest, newest, lo);
		const cy = sliceVirtualCenterY(vm.sliceIndex[index], lo) - this._scrollY + lo.swimlaneTop;
		this._showTooltip(index, cx, cy);
	}

	/** Single source of truth for zoom application. Every zoom path (buttons, ctrl+wheel,
	 *  volume-bar click, brush) funnels through here with a desired anchor timestamp and a
	 *  desired span. The helper handles span clamping (`[minVisibleSpanMs, maxSpan]`), drift
	 *  snap-back to `maxSpan`, anchor-centered placement, vm-bounds clamping, the `_zoomed`
	 *  flag, and the redraw kick. Consolidating these rules in one place means a fix to any of
	 *  them lands consistently across all zoom interactions. */
	private _applyZoom(anchorTs: number, desiredSpan: number): void {
		const vm = this._viewModel;
		if (vm == null) return;

		const isWindowed = this.windowSpanMs != null;
		const dataSpan = vm.newest - vm.oldest;
		const maxSpan = isWindowed ? this.windowSpanMs! : dataSpan;

		let newSpan = Math.max(minVisibleSpanMs, Math.min(maxSpan, desiredSpan));
		// Snap to exact `maxSpan` within drift tolerance — `windowSpanMs` re-evaluates against
		// `Date.now()` per parent render (sub-second drift), so a span computed off the prior
		// `_zoomRange` lands sub-minute short of the current `maxSpan` and `_zoomed` would stay
		// `true` at the default state.
		if (maxSpan - newSpan > 0 && maxSpan - newSpan < 60_000) {
			newSpan = maxSpan;
		}

		// Center on the anchor, then clamp to vm bounds. In windowed mode `vm.newest` is the
		// WIP at `Date.now()`, so the right-edge clamp keeps the viewport from drifting past
		// today; either clamp slides the viewport (keeps `newSpan`) instead of collapsing it.
		let newOldest = anchorTs - newSpan / 2;
		let newNewest = anchorTs + newSpan / 2;
		if (newNewest > vm.newest) {
			newOldest -= newNewest - vm.newest;
			newNewest = vm.newest;
		}
		if (newOldest < vm.oldest) {
			newNewest += vm.oldest - newOldest;
			newOldest = vm.oldest;
		}

		this._zoomRange = { oldest: newOldest, newest: newNewest };
		this._zoomed = newSpan < maxSpan;
		this._viewModel = undefined;
		this._requestDraw();
	}

	/** Anchor timestamp for anchor-driven zoom paths (buttons, ctrl+wheel). Selected commit when
	 *  set; otherwise the current viewport's midpoint as a sensible fallback. */
	private _zoomAnchorTs(): number {
		const vm = this._viewModel;
		const sha = this._selectedSha;
		if (vm != null && sha != null) {
			const idx = vm.shaToIndex.get(sha);
			if (idx != null) return vm.timestamps[idx];
		}

		const oldest = this._zoomRange?.oldest ?? vm?.oldest ?? Date.now();
		const newest = this._zoomRange?.newest ?? vm?.newest ?? Date.now();
		return (oldest + newest) / 2;
	}

	/** Zoom into the chart around a specific commit/bin index — used by the volume-bar click.
	 *  Picks a window of ~10% of the current visible span (so each click drills in roughly 10×). */
	private _zoomToVolumeBar(idx: number): void {
		const vm = this._viewModel;
		if (vm == null) return;

		const ts = vm.timestamps[idx];
		if (ts == null || Number.isNaN(ts)) return;

		const oldest = this._zoomRange?.oldest ?? vm.oldest;
		const newest = this._zoomRange?.newest ?? vm.newest;
		this._applyZoom(ts, (newest - oldest) * 0.1);
	}

	private _zoomBy(factor: number): void {
		if (factor === 0) {
			this.resetZoom();
			return;
		}

		const vm = this._viewModel;
		if (vm == null) return;

		const oldest = this._zoomRange?.oldest ?? vm.oldest;
		const newest = this._zoomRange?.newest ?? vm.newest;
		// Shrink (factor > 0) or expand (factor < 0) the current viewport.
		this._applyZoom(this._zoomAnchorTs(), (newest - oldest) * (1 - factor));
	}

	private _renderNotice(): unknown {
		// Full-canvas blur overlay only when there's literally nothing to look at yet (initial
		// paint, before any dataset has resolved). Once any rows are on screen we never blur —
		// transitions go through the edge-gradient affordance instead, so the user's scroll /
		// zoom / selection stays anchored to existing data while the next dataset arrives. The
		// chart's internal `_loading` defer fires on every `dataPromise` reassignment, including
		// soft refreshes that don't actually replace the visible data, so checking it alongside
		// "no data" was causing the chart to flash blur on every reactive update from the host.
		const hasData = (this._data?.length ?? 0) > 0;
		if (!hasData && (this.loading || this._loading?.pending || this._data == null)) {
			return html`<div class="notice notice--blur">
				<gl-watermark-loader pulse><p>Loading...</p></gl-watermark-loader>
			</div>`;
		}
		if (this._data != null && !this._data.length) {
			return html`<div class="notice">
				<gl-watermark-loader><slot name="empty"></slot></gl-watermark-loader>
			</div>`;
		}
		return nothing;
	}

	/** Stable description for screen readers entering the chart. Read once on focus by the AT,
	 *  so we describe what the user is looking at and how to drive it. Commit-by-commit detail
	 *  comes from the `aria-live` region updated as `_selectedSha` changes. */
	private get _a11yWrapperLabel(): string {
		const count = this._data?.length ?? 0;
		if (count === 0) return 'Visual History timeline';

		const noun = count === 1 ? 'commit' : 'commits';
		return `Visual History timeline showing ${count.toLocaleString()} ${noun}. Use arrow keys to navigate.`;
	}

	/** Cached announcement text keyed by `(selectedSha, data)`. Built only when selection moves
	 *  to a new commit; subsequent renders (renderTick bumps, hover tweens, etc.) return the
	 *  cached string. Replaces the previous "render every commit as a hidden `<li>`" approach
	 *  that produced 10K+ DOM nodes and ran `formatDate` per node — multi-second per render
	 *  on repo-scope embedded timelines, which compounded into the multi-minute graph-webview
	 *  hang on open. The aria-live region announces only the currently-focused commit, which
	 *  matches how screen reader users actually drive a canvas chart (keyboard nav, listen to
	 *  the current item) — no list to skim, just step + announce. */
	private _a11yAnnouncementCache?: { sha: string; data: TimelineDatum[]; text: string };

	private _renderA11yLive(): unknown {
		const sha = this._selectedSha;
		const data = this._data;
		if (sha == null || data == null || data.length === 0) {
			return html`<div class="a11y-live" role="status" aria-live="polite" aria-atomic="true"></div>`;
		}

		let text: string;
		if (this._a11yAnnouncementCache?.sha === sha && this._a11yAnnouncementCache.data === data) {
			text = this._a11yAnnouncementCache.text;
		} else {
			const commit = data.find(c => c.sha === sha);
			if (commit == null) {
				return html`<div class="a11y-live" role="status" aria-live="polite" aria-atomic="true"></div>`;
			}

			text = `commit ${shortenRevision(commit.sha)} by ${formatIdentityDisplayName({ name: commit.author, current: commit.current }, this.currentUserNameStyle)} on ${formatDate(new Date(commit.date), this.dateFormat)}, +${commit.additions ?? 0} -${commit.deletions ?? 0} lines: ${commit.message}`;
			this._a11yAnnouncementCache = { sha: sha, data: data, text: text };
		}

		return html`<div class="a11y-live" role="status" aria-live="polite" aria-atomic="true">${text}</div>`;
	}

	/** Cached axis-label widths. `ctx.measureText` forces a text-shaping pass per call; tick
	 *  labels for a given period repeat across renders (`'Jan'`, `'Feb'`, …). Cleared whenever
	 *  the theme is reset (`_theme = undefined`), which is the only time the font changes. */
	private _axisLabelWidthCache = new Map<string, number>();

	private _measureAxisLabelWidth(label: string): number {
		const cached = this._axisLabelWidthCache.get(label);
		if (cached != null) return cached;

		const ctx = this._ctx;
		if (ctx == null) {
			// No context yet — fall back to a rough estimate but DON'T cache it (the real measurement
			// once the canvas mounts must replace the estimate, not lose to it).
			return label.length * 6;
		}

		// Restore the prior font afterwards instead of save/restore — the full state push/pop pair
		// is heavier than a single font swap.
		const prevFont = ctx.font;
		ctx.font = '10px var(--font-family, sans-serif)';
		const width = ctx.measureText(label).width;
		ctx.font = prevFont;
		this._axisLabelWidthCache.set(label, width);
		return width;
	}

	private _layoutSliceCount = -1;
	private _lastRenderSig?: string;
	private _lastVisibleOldest?: number;
	private _lastVisibleNewest?: number;

	/** Emit `gl-visible-range-changed` if the visible range has actually moved since the last
	 *  emit. Called from both `_draw` (for normal renders with a viewModel) and `updated()` (for
	 *  empty-data states where `_draw` bails before its own emit can fire). The dedupe via
	 *  `_lastVisibleOldest`/`_lastVisibleNewest` keeps either site idempotent. */
	private _maybeEmitVisibleRange(): void {
		const oldest = this._zoomRange?.oldest ?? this._viewModel?.oldest;
		const newest = this._zoomRange?.newest ?? this._viewModel?.newest;
		if (oldest == null || newest == null) return;
		if (oldest === this._lastVisibleOldest && newest === this._lastVisibleNewest) return;

		this._lastVisibleOldest = oldest;
		this._lastVisibleNewest = newest;
		this.emit('gl-visible-range-changed', { oldest: oldest, newest: newest });
	}

	/** Older data exists to the left of the current viewport — i.e., panning back would reveal
	 *  more commits. Drives the left-edge chevron and the "before" half of `_hasHorizontalOverflow`.
	 *  Uses `this._data` (always defined when this is read) instead of `_viewModel` so the check
	 *  is correct mid-drag, when vm is `undefined` between RAFs. The producer sorts the dataset
	 *  newest-first (`dataset.sort((a, b) => b.sort - a.sort)`), so `data.at(-1)` is the oldest.
	 *  Tolerant against float-precision drift (see `_hasHistoryAfter` for the equivalent rationale). */
	private get _hasHistoryBefore(): boolean {
		const data = this._data;
		const zr = this._zoomRange;
		if (data == null || data.length === 0 || zr == null) return false;

		const tolerance = Math.max(1, (zr.newest - zr.oldest) * 0.005);
		return zr.oldest > data.at(-1)!.sort + tolerance;
	}

	/** Newer data exists to the right of the current viewport — i.e., panning forward would reveal
	 *  more commits. Rare in default windowed mode (the right edge anchors to the newest commit),
	 *  but real when the user has zoomed in mid-history. Drives the right-edge chevron.
	 *
	 *  Tolerance (0.5% of viewport span, min 1ms) absorbs two sources of false-positive at the
	 *  right edge: float precision when the scrollbar is dragged fully right, and WIP-timestamp
	 *  drift — `data[0]` is the WIP placeholder with `sort: Date.now()`, and a WIP refresh after
	 *  the user reached the right edge advances `data[0].sort` while `_zoomRange.newest` stays
	 *  snapshotted from the earlier draw, leaving a multi-second gap that would otherwise keep
	 *  the chevron visible forever. */
	private get _hasHistoryAfter(): boolean {
		const data = this._data;
		const zr = this._zoomRange;
		if (data == null || data.length === 0 || zr == null) return false;

		const tolerance = Math.max(1, (zr.newest - zr.oldest) * 0.005);
		return zr.newest < data[0].sort - tolerance;
	}

	/** Either direction has data outside the viewport. Drives scrollbar visibility AND guards the
	 *  track-click / thumb-drag handlers so they can't `newOldest + span` past `dataNewest` when
	 *  the viewport is already wider than the dataset. */
	private get _hasHorizontalOverflow(): boolean {
		return this._hasHistoryBefore || this._hasHistoryAfter;
	}

	private _ensureLayout(): TimelineLayout | undefined {
		const canvas = this._canvas;
		if (canvas == null) return undefined;

		const wrapper = canvas.parentElement;
		if (wrapper == null) return undefined;

		const rect = wrapper.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return undefined;

		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(rect.width * dpr);
		const targetH = Math.round(rect.height * dpr);
		// Assigning canvas.width/height resets the GPU buffer AND wipes canvas state — gate by
		// change so per-frame redraws don't trigger needless resets and reflows.
		if (canvas.width !== targetW || canvas.height !== targetH) {
			canvas.width = targetW;
			canvas.height = targetH;
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
			this._ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
		}

		const sliceCount = this._viewModel?.slices.length ?? 0;
		// Width-aware rail: branch mode ramps the rail column up to fit partial branch names when
		// the chart is wide enough to spare the pixels. Push the same value through to both the
		// canvas layout (`gutterLeft` shifts `chartLeft` so bubbles don't draw under the rail) and
		// the DOM rail (the `--rail-column-width` custom property drives the rail container width
		// and the branch-pill collapsed clip). They MUST stay in sync — any divergence puts the
		// canvas-drawn bubbles out of register with the DOM rail.
		const railColumnWidth = pickRailColumnWidth(rect.width, this.sliceBy);
		this.style.setProperty('--rail-column-width', `${railColumnWidth}px`);
		// Show the horizontal scrollbar only when the dataset actually extends past the current
		// viewport on either edge — when the viewport fully contains the data, the scrollbar is
		// non-functional (no shift possible) AND its track-click / thumb-drag handlers can't
		// produce a meaningful `_zoomRange` either, so showing it would be a UX foot-gun
		// (clicking a "full-thumb" scrollbar would silently future-pad the chart).
		this._layout = computeLayout(rect.width, rect.height, dpr, sliceCount, {
			gutterLeft: railLeftOffsetPx + railColumnWidth + bubbleEdgePaddingPx,
			showVolume: this._data != null && this._data.length > 0,
			showY2: this._data != null && this._data.length > 0,
			showHorizontalScrollbar: this._hasHorizontalOverflow,
		});
		this._layoutSliceCount = sliceCount;

		// Expose layout coordinates for DOM overlays (e.g. the load-more edge line) to pin
		// against the same Y values the canvas draws to. Both are expressed as the literal
		// `top:` / `bottom:` values for an absolutely-positioned overlay inside the wrapper:
		// `--load-more-top` is the chart-host-relative Y of the bottom of the breadcrumb header
		// (= chart canvas top = wrapper's `top: 0`). `--load-more-bottom` is the offset from the
		// wrapper's bottom to the X-axis baseline (= axisStripBottom).
		this.style.setProperty('--load-more-top', `0px`);
		// -2px overshoot so the indicator visually covers the X-axis baseline (a 2px-tall line
		// straddling axisStripBottom) entirely instead of ending in its middle.
		this.style.setProperty('--load-more-bottom', `${rect.height - this._layout.axisStripBottom - 2}px`);

		// Do NOT clamp `_scrollY` here. When `_viewModel` is cleared mid-flight (e.g. on a
		// horizontal scroll / zoom that triggers a viewModel rebuild), `sliceCount` reads as 0
		// and `virtualSwimlaneHeight` collapses to 0 — clamping at this point would zero out
		// `_scrollY` before the viewModel is rebuilt with the real slice count. `_draw` clamps
		// `_scrollY` later, AFTER the layout-recompute branch (line 1253) has run with the
		// correct slice count, so the user's vertical scroll position survives the rebuild.
		this._maxScrollY = Math.max(
			0,
			this._layout.virtualSwimlaneHeight - this._layout.swimlaneBottom + this._layout.swimlaneTop,
		);

		return this._layout;
	}

	private _ensureTheme(): TimelineTheme {
		if (this._theme) return this._theme;

		const style = window.getComputedStyle(this);

		const palette: string[] = [];
		for (let i = 0; i < 10; i++) {
			const v = getCssVariable(`--color-timeline-slice-${i}`, style);
			palette.push(v || defaultSlicePalette[i]);
		}

		this._theme = {
			background: getCssVariable('--vscode-editor-background', style) || '#1e1e1e',
			zebraOdd: getCssVariable('--vscode-list-hoverBackground', style) || 'rgba(255,255,255,0.03)',
			axisDomain: getCssVariable('--color-foreground--50', style) || '#888',
			axisLabel: getCssVariable('--color-foreground--75', style) || '#bbb',
			axisLabelMuted: getCssVariable('--color-foreground--50', style) || '#888',
			gridLine: getCssVariable('--color-foreground--85', style) || '#ccc',
			bubbleStroke: getCssVariable('--color-view-foreground', style) || '#fff',
			selectedRing: getCssVariable('--color-foreground', style) || '#fff',
			hoverRing: getCssVariable('--color-foreground--85', style) || '#ddd',
			additions: getCssVariable('--vscode-gitlens-timelineAdditionsColor', style) || 'rgba(73, 190, 71, 1)',
			deletions: getCssVariable('--vscode-gitlens-timelineDeletionsColor', style) || 'rgba(195, 32, 45, 1)',
			scrollThumb: getCssVariable('--vscode-scrollbarSlider-background', style) || 'rgba(121,121,121,0.4)',
			scrollThumbHover:
				getCssVariable('--vscode-scrollbarSlider-hoverBackground', style) || 'rgba(100,100,100,0.7)',
			tooltipBg: getCssVariable('--vscode-editorHoverWidget-background', style) || '#252526',
			tooltipFg: getCssVariable('--vscode-editorHoverWidget-foreground', style) || '#cccccc',
			tooltipBorder: getCssVariable('--vscode-editorHoverWidget-border', style) || '#454545',
			slicePalette: palette,
		};
		return this._theme;
	}

	private _ensureViewModel(): TimelineViewModel | undefined {
		if (this._data == null || this._data.length === 0) return undefined;
		if (this._viewModel) return this._viewModel;

		// Probe the dataset domain (oldest/newest/expanded count) without running the full pack
		// pipeline twice — earlier this called `buildViewModel` once just to pick a bin unit and
		// then ran it again with the chosen unit, paying for two O(n log n) sorts and two
		// typed-array allocations on every viewModel invalidation (every horizontal scroll/pan in
		// windowed mode).
		let binUnit: TimelineBinUnit = 'none';
		const layout = this._layout;
		if (layout && layout.chartWidth > 0) {
			const probe = probeViewModelDomain(this._data, this.sliceBy);
			const dataSpan = probe.newest - probe.oldest;
			if (dataSpan > 0 && probe.expandedCount > 0) {
				// Bin choice is driven by *visible* density, not total dataset size. In windowed mode
				// the user typically views a fixed window (e.g. last 90 days) regardless of how much
				// older history has been paged in — basing pxPerCommit on the global commit count
				// would coarsen the binning every time the user pages more, even though what they
				// see hasn't gotten any denser. Approximate visible commits by scaling the global
				// count by the visible-span / data-span ratio (assumes roughly uniform density,
				// which is fine for picking among 6 / 1.5 / 0.3 thresholds — exact counts aren't
				// needed). Falls back to the global density when nothing is windowed/zoomed.
				const visibleSpan =
					this.windowSpanMs != null
						? Math.min(this.windowSpanMs, dataSpan)
						: this._zoomRange != null
							? this._zoomRange.newest - this._zoomRange.oldest
							: dataSpan;
				const visibleCommits = Math.max(1, Math.round((probe.expandedCount * visibleSpan) / dataSpan));
				binUnit = chooseBinUnit(layout.chartWidth / visibleCommits);
			}
		}

		this._viewModel = buildViewModel({
			dataset: this._data,
			sliceBy: this.sliceBy,
			defaultBranch: this.head ?? 'HEAD',
			binUnit: binUnit === 'none' ? undefined : binUnit,
		});
		this._binUnit = binUnit;
		return this._viewModel;
	}

	private _requestDraw(): void {
		if (this._drawRAF != null) return;

		this._drawRAF = requestAnimationFrame(() => {
			this._drawRAF = undefined;
			this._draw();
		});
	}

	private _draw(): void {
		const ctx = this._ctx;
		if (ctx == null) return;

		const layout = this._ensureLayout();
		if (layout == null) return;

		const theme = this._ensureTheme();
		const viewModel = this._ensureViewModel();

		ctx.fillStyle = theme.background;
		ctx.fillRect(0, 0, layout.width, layout.height);

		if (viewModel == null) return;

		// Recompute layout only when slice count differs from what `_ensureLayout` used —
		// row height depends on it. On steady state the cached layout is reused. Carry the
		// already-resolved `chartLeft` through as `gutterLeft` so the width-aware branch-mode
		// rail isn't silently reset to its 36px default here (rect.width and sliceBy haven't
		// changed between `_ensureLayout` and now, so the prior chartLeft is still correct).
		let lo = layout;
		if (this._layoutSliceCount !== viewModel.slices.length) {
			lo = computeLayout(layout.width, layout.height, layout.dpr, viewModel.slices.length, {
				gutterLeft: layout.chartLeft,
				showVolume: true,
				showY2: true,
				showHorizontalScrollbar: this._hasHorizontalOverflow,
			});
			this._layout = lo;
			this._layoutSliceCount = viewModel.slices.length;
		}

		const visibleH = lo.swimlaneBottom - lo.swimlaneTop;
		this._maxScrollY = Math.max(0, lo.virtualSwimlaneHeight - visibleH);
		this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY));

		// DOM rail + axis overlay re-render only when their inputs actually change. Stamping a
		// signature instead of bumping every frame keeps Lit from running render() inside the RAF
		// loop on no-op redraws (hover tweens, mousemove on the same bubble, etc.).
		const sig = `${lo.width}|${lo.height}|${lo.rowHeight}|${lo.virtualSwimlaneHeight}|${this._scrollY}|${viewModel.slices.length}|${this._zoomRange?.oldest ?? 0}|${this._zoomRange?.newest ?? 0}`;
		if (sig !== this._lastRenderSig) {
			this._lastRenderSig = sig;
			this._renderTick++;
			// `_renderTick` is `@state`, so its setter calls `requestUpdate('_renderTick', …)` —
			// but that path occasionally races with the rAF / microtask boundary on the first paint
			// (and on dataset swaps that clear `_viewModel`), leaving the rail empty until a
			// pointer event mutates another `@state` field. An unconditional `requestUpdate()` (no
			// args) bypasses Lit's per-property change-detection and forces a fresh update cycle
			// regardless of whether `_renderTick`'s setter already queued one. Lit dedupes back-
			// to-back calls, so this is cheap when the @state path already fired.
			this.requestUpdate();
		}

		// Visible time range changed → notify the host so the breadcrumb pill can show the actual
		// span. The helper dedupes against the last-emitted range, so it's also safe to call from
		// `updated()` for empty-data states where `_draw` bails before reaching here.
		this._maybeEmitVisibleRange();

		// Map the active scrub sha onto the rebuilt viewModel's bin index BEFORE the hover tween
		// advances, so the slider drag drives the same eased halo + tooltip path as a real pointer
		// hover (and so the index lands in this frame's drawState, not the next one).
		this._resolveScrubHover();

		// Advance the hover-highlight tween. Eased toward the target intensity each frame so the
		// hover effect grows in over ~140ms rather than snapping to full size, and the previously
		// hovered bubble fades out smoothly instead of disappearing.
		const now = performance.now();
		const dt = Math.min(50, this._lastFrameTime > 0 ? now - this._lastFrameTime : 16);
		this._lastFrameTime = now;
		const step = dt / GlTimelineChart._hoverAnimDurationMs;
		const animating = this._stepHoverIntensity(step);

		const drawState: TimelineDrawState = {
			viewModel: viewModel,
			layout: lo,
			theme: theme,
			scrollY: this._scrollY,
			zoomRange: this._zoomRange,
			selectedSha: this._selectedSha,
			hoverIndex: this._hoverIndex,
			hoverIntensity: easeOutCubic(this._hoverIntensity),
			outgoingHoverIndex: this._outgoingHoverIndex,
			outgoingHoverIntensity: easeOutCubic(this._outgoingHoverIntensity),
			hoverSliceIndex: this._hoverSliceIndex,
			hoverVolumeIndex: this._hoverVolumeIndex,
			hiddenSlices: this._hiddenSlices.size > 0 ? this._hiddenSlices : undefined,
			brushRange: this._brushRange,
			historyBefore: this._hasHistoryBefore,
			historyAfter: this._hasHistoryAfter,
		};

		// Header strip (sticky top).
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, lo.width, lo.headerHeight);
		ctx.clip();
		drawHeader(ctx, drawState, (date, unit, opts) => formatTickLabel(date, unit, this.shortDateFormat, opts));
		ctx.restore();

		// Swimlane region — clip only vertically (extended to canvas y=0 so top-row bubbles can
		// extend up into the header padding and bottom-row bubbles can shine through the X-axis
		// glass). Horizontal clip is intentionally OPEN: bubbles near the chart edges bleed into
		// the rail and right-gutter columns, where the frosted-glass backdrop blurs them.
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, lo.width, lo.axisStripBottom);
		ctx.clip();
		ctx.translate(0, lo.swimlaneTop - this._scrollY);
		drawSwimlanes(ctx, drawState);
		ctx.restore();

		// Volume strip — bars rise downward from the X-axis baseline at the top of this region.
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, lo.volumeTop, lo.width, lo.volumeBottom - lo.volumeTop);
		ctx.clip();
		drawVolume(ctx, drawState);
		ctx.restore();

		// Overlay layer — focus line, rings, brush, vertical scrollbar. X-axis labels and the
		// horizontal scrollbar render as crisp DOM chrome above their frosted pane.
		drawOverlay(ctx, drawState);

		// Windowed-mode near-edge detector. When the user has scrolled within 25% of the loaded
		// dataset's left boundary, ask the host for more older history. Tracking the last fired
		// `oldest` keeps a stationary near-edge from spamming events every rAF — we re-fire only
		// when `_zoomRange.oldest` has moved further left since the last emission, or when the
		// host has acknowledged via `loadingMore` reset + dataset extension (clearing
		// `_loadMoreEmittedFor` in `_loadData`).
		if (this.hasMore && !this.loadingMore && this._zoomRange != null && viewModel.commits.length > 0) {
			const span = this._zoomRange.newest - this._zoomRange.oldest;
			const distanceFromLoadedOldest = this._zoomRange.oldest - viewModel.oldest;
			if (
				distanceFromLoadedOldest < 0.25 * span &&
				(this._loadMoreEmittedFor == null || this._zoomRange.oldest < this._loadMoreEmittedFor)
			) {
				this._loadMoreEmittedFor = this._zoomRange.oldest;
				this.emit('gl-load-more', { before: viewModel.oldest });
			}
		}

		// Keep ticking while the hover tween is in flight so the scale-up / fade-out animates
		// instead of snapping to its target on the next pointer event.
		if (animating) {
			this._requestDraw();
		} else {
			this._lastFrameTime = 0;
		}
	}

	/**
	 * Advances the hover intensities toward their targets. Returns true while either is still in
	 * flight; once both have settled the host can stop requesting new frames.
	 */
	private _stepHoverIntensity(step: number): boolean {
		let animating = false;

		if (this._hoverIntensity < this._hoverIntensityTarget) {
			this._hoverIntensity = Math.min(this._hoverIntensityTarget, this._hoverIntensity + step);
			if (this._hoverIntensity < this._hoverIntensityTarget) {
				animating = true;
			}
		} else if (this._hoverIntensity > this._hoverIntensityTarget) {
			this._hoverIntensity = Math.max(this._hoverIntensityTarget, this._hoverIntensity - step);
			if (this._hoverIntensity > this._hoverIntensityTarget) {
				animating = true;
			}
		}

		if (this._outgoingHoverIndex != null) {
			this._outgoingHoverIntensity = Math.max(0, this._outgoingHoverIntensity - step);
			if (this._outgoingHoverIntensity > 0) {
				animating = true;
			} else {
				this._outgoingHoverIndex = undefined;
			}
		}

		return animating;
	}

	private _setHover(index: number | undefined): void {
		if (index === this._hoverIndex) return;

		// Hand the previously-hovered bubble off to the outgoing slot so it fades out while the
		// new bubble fades in. Skipped when the prior intensity is already low (the user moved off
		// the chart and back again) so we don't spawn a phantom outgoing fade from nothing.
		if (this._hoverIndex != null && this._hoverIntensity > 0.05) {
			this._outgoingHoverIndex = this._hoverIndex;
			this._outgoingHoverIntensity = this._hoverIntensity;
		}
		this._hoverIndex = index;
		this._hoverIntensity = 0;
		this._hoverIntensityTarget = index != null ? 1 : 0;
		if (this._lastFrameTime === 0) {
			this._lastFrameTime = performance.now();
		}

		const newSha = index != null ? this._viewModel?.commits[index]?.sha : undefined;
		if (this._shaHovered !== newSha) {
			this._shaHovered = newSha;
		}
		this._requestDraw();
	}

	private _onPointerDown = (e: PointerEvent): void => {
		const lo = this._layout;
		if (lo == null) return;

		// Horizontal scrollbar (when zoomed)?
		if (this._zoomRange != null && this._viewModel != null) {
			const hbar = hitTestHorizontalScrollbar(
				e.offsetX,
				e.offsetY,
				lo,
				this._zoomRange,
				this._viewModel.oldest,
				this._viewModel.newest,
			);
			if (hbar?.kind === 'thumb') {
				this._isHThumbDragging = true;
				this._hThumbDragStartX = e.offsetX;
				this._hThumbDragStartZoomOldest = this._zoomRange.oldest;
				this._hThumbDragStartZoomNewest = this._zoomRange.newest;
				(e.target as HTMLElement).setPointerCapture(e.pointerId);
				e.preventDefault();
				return;
			}
			if (hbar?.kind === 'track') {
				const span = this._zoomRange.newest - this._zoomRange.oldest;
				const fullOldest = this._viewModel.oldest;
				const fullNewest = this._viewModel.newest;
				// Nothing to scroll: span >= dataSpan means the viewport already contains the
				// whole dataset, so any shift produces `newOldest + span > fullNewest` and pads
				// the chart's right edge with empty future space. The scrollbar visibility check
				// (`_hasHorizontalOverflow`) hides the bar in this case; this guard makes the
				// handler safe even when a stale layout still reports the bar as hittable.
				if (span >= fullNewest - fullOldest) return;

				const direction = hbar.side === 'before' ? -1 : 1;
				const shift = direction * span * 0.9;
				const newOldest = Math.max(fullOldest, Math.min(fullNewest - span, this._zoomRange.oldest + shift));
				const newNewest = newOldest + span;
				this._zoomRange = { oldest: newOldest, newest: newNewest };
				this._viewModel = undefined;
				this._requestDraw();
				return;
			}
		}

		// Vertical scrollbar?
		const sbar = hitTestVerticalScrollbar(e.offsetX, e.offsetY, this._scrollY, lo);
		if (sbar?.kind === 'thumb') {
			this._isThumbDragging = true;
			this._thumbDragStartY = e.offsetY;
			this._thumbDragStartScrollY = this._scrollY;
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}
		if (sbar?.kind === 'track') {
			const visibleH = lo.swimlaneBottom - lo.swimlaneTop;
			const direction = sbar.side === 'up' ? -1 : 1;
			this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY + direction * visibleH * 0.9));
			this._requestDraw();
			return;
		}

		// Volume-bar click → zoom into a window around that timestamp. Gives the user a one-click
		// way to drill into a busy day without manually drag-selecting on the swimlane.
		if (
			this._viewModel != null &&
			e.offsetY >= lo.volumeTop &&
			e.offsetY <= lo.volumeBottom &&
			e.offsetX >= lo.chartLeft &&
			e.offsetX <= lo.chartRight
		) {
			const oldest = this._zoomRange?.oldest ?? this._viewModel.oldest;
			const newest = this._zoomRange?.newest ?? this._viewModel.newest;
			const hiddenForHit = this._hiddenSlices.size > 0 ? this._hiddenSlices : undefined;
			const hit = hitTestVolumeBar(e.offsetX, e.offsetY, this._viewModel, oldest, newest, lo, hiddenForHit);
			if (hit != null) {
				this._zoomToVolumeBar(hit);
				e.preventDefault();
				return;
			}
		}

		// Brush start (anywhere within the swimlane region).
		if (e.offsetY >= lo.swimlaneTop && e.offsetY <= lo.swimlaneBottom) {
			this._isBrushing = true;
			this._brushRange = { startX: e.offsetX, endX: e.offsetX };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			this._requestDraw();
		}
	};

	private _onPointerMove = (e: PointerEvent): void => {
		const lo = this._layout;
		const viewModel = this._viewModel;
		if (lo == null || viewModel == null) return;

		// Slider scrub owns hover for the duration of the drag — ignore pointer movement over the
		// canvas so the user doesn't get a competing bubble/volume spotlight when their cursor
		// drifts off the slider thumb. Released by `_onSliderChanged` on `interim: false`.
		if (this._scrubSha != null) return;

		if (this._isHThumbDragging && this._viewModel != null) {
			const span = this._hThumbDragStartZoomNewest - this._hThumbDragStartZoomOldest;
			const fullOldest = this._viewModel.oldest;
			const fullNewest = this._viewModel.newest;
			// Same guard as the track-click handler — when the viewport is wider than the data,
			// any thumb drag would produce `newOldest + span > fullNewest` and future-pad the
			// chart. The visibility check should keep the thumb un-grabbable, but stale layouts
			// can leak through; bail rather than mutate `_zoomRange` past the dataset.
			if (span >= fullNewest - fullOldest) return;

			const deltaX = e.offsetX - this._hThumbDragStartX;
			const shift = horizontalScrollbarDeltaToTimestampShift(deltaX, lo, fullOldest, fullNewest);
			const newOldest = Math.max(
				fullOldest,
				Math.min(fullNewest - span, this._hThumbDragStartZoomOldest + shift),
			);
			this._zoomRange = { oldest: newOldest, newest: newOldest + span };
			this._viewModel = undefined;
			this._requestDraw();
			return;
		}

		if (this._isThumbDragging) {
			const delta = e.offsetY - this._thumbDragStartY;
			const scrollDelta = verticalScrollbarDeltaToScrollY(delta, lo);
			this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._thumbDragStartScrollY + scrollDelta));
			this._requestDraw();
			return;
		}

		if (this._isBrushing && this._brushRange) {
			this._brushRange = { startX: this._brushRange.startX, endX: e.offsetX };
			this._requestDraw();
			return;
		}

		// Hover hit-test.
		const oldest = this._zoomRange?.oldest ?? viewModel.oldest;
		const newest = this._zoomRange?.newest ?? viewModel.newest;
		const bubbleHit = hitTestBubble(e.offsetX, e.offsetY, this._scrollY, viewModel, oldest, newest, lo);

		// Volume-strip scrub — when the pointer is anywhere inside the volume strip (and not on a
		// bubble), snap to the nearest visible bar regardless of distance. Continuous tracking keeps
		// the linked spotlight locked onto a focused commit while scrubbing, instead of flashing off
		// as the cursor passes through gaps between bars.
		const hiddenForHit = this._hiddenSlices.size > 0 ? this._hiddenSlices : undefined;
		const volumeHit =
			bubbleHit == null
				? findNearestVolumeBar(e.offsetX, e.offsetY, viewModel, oldest, newest, lo, hiddenForHit)
				: undefined;
		if (volumeHit !== this._hoverVolumeIndex) {
			this._hoverVolumeIndex = volumeHit;
			this._requestDraw();
		}

		// Focused commit = bubble hit when over a bubble, otherwise the largest commit at the
		// hovered volume bar. The same `_hoverIndex` drives the bubble glow + the tooltip, so the
		// linked spotlight reads as "you're focused on THIS commit" rather than just dimming.
		const focused = bubbleHit ?? volumeHit;
		this._setHover(focused);

		// Scrollbar cursor is `default` (not `zoom-in` or `pointer`) so the user reads it as a
		// system scrollbar, not a clickable bubble. Bubble hits override (so a bubble overlapping
		// the scrollbar zone still gets the pointer cursor).
		const onScrollbar =
			(this._zoomed &&
				hitTestHorizontalScrollbar(
					e.offsetX,
					e.offsetY,
					lo,
					this._zoomRange ?? viewModel,
					viewModel.oldest,
					viewModel.newest,
				) != null) ||
			hitTestVerticalScrollbar(e.offsetX, e.offsetY, this._scrollY, lo) != null;

		const canvas = this._canvas;
		if (canvas) {
			let cursor: 'pointer' | 'zoom-in' | 'default';
			if (bubbleHit != null) {
				cursor = 'pointer';
			} else if (onScrollbar) {
				cursor = 'default';
			} else if (volumeHit != null) {
				cursor = 'zoom-in';
			} else {
				cursor = 'default';
			}
			if (canvas.style.cursor !== cursor) {
				canvas.style.cursor = cursor;
			}
		}
		this._showTooltip(focused, e.offsetX, e.offsetY);
	};

	private _onPointerUp = (e: PointerEvent): void => {
		(e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

		if (this._isHThumbDragging) {
			this._isHThumbDragging = false;
			return;
		}

		if (this._isThumbDragging) {
			this._isThumbDragging = false;
			return;
		}

		if (this._isBrushing && this._brushRange) {
			const { startX, endX } = this._brushRange;
			const width = Math.abs(endX - startX);
			this._isBrushing = false;
			this._brushRange = undefined;

			if (width >= brushThresholdPx) {
				// Commit zoom to the brushed range — center on the brush midpoint, span = brush
				// width. Same `_applyZoom` helper as buttons/wheel handles the `minVisibleSpanMs`
				// floor + vm-bounds clamping consistently.
				const lo = this._layout;
				const viewModel = this._viewModel;
				if (lo && viewModel) {
					const oldest = this._zoomRange?.oldest ?? viewModel.oldest;
					const newest = this._zoomRange?.newest ?? viewModel.newest;
					const ts1 = xToTs(Math.min(startX, endX), oldest, newest, lo);
					const ts2 = xToTs(Math.max(startX, endX), oldest, newest, lo);
					if (!Number.isNaN(ts1) && !Number.isNaN(ts2) && ts2 > ts1) {
						this._applyZoom((ts1 + ts2) / 2, ts2 - ts1);
					} else {
						this._requestDraw();
					}
				} else {
					this._requestDraw();
				}
				return;
			}

			// Treat as a click — hit-test for a bubble.
			const lo = this._layout;
			const viewModel = this._viewModel;
			if (lo && viewModel) {
				const oldest = this._zoomRange?.oldest ?? viewModel.oldest;
				const newest = this._zoomRange?.newest ?? viewModel.newest;
				const hit = hitTestBubble(endX, e.offsetY, this._scrollY, viewModel, oldest, newest, lo);
				if (hit != null) {
					const sha = viewModel.commits[hit].sha;
					this._selectedSha = sha;
					this._slider?.select(sha);
					this.emit('gl-commit-select', { id: sha, shift: e.shiftKey });
				}
			}
			this._requestDraw();
		}
	};

	private _onPointerLeave = (): void => {
		// Don't tear down hover state mid-scrub — the slider owns it until release.
		if (this._scrubSha != null) return;

		this._setHover(undefined);
		this._shaHovered = undefined;
		if (this._hoverVolumeIndex != null) {
			this._hoverVolumeIndex = undefined;
			this._requestDraw();
		}
		const canvas = this._canvas;
		if (canvas) {
			canvas.style.cursor = 'default';
		}
		this._hideTooltip();
	};

	private _onWheel = (e: WheelEvent): void => {
		const lo = this._layout;
		const viewModel = this._viewModel;
		if (lo == null || viewModel == null) return;

		// Ctrl/Cmd + wheel: zoom around the selected commit (same anchor as the zoom buttons,
		// just continuous instead of stepped). Funnels through `_applyZoom` so every zoom path
		// shares the same span clamping, drift snap-back, vm-bounds clamping, and `_zoomed` flag.
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const oldest = this._zoomRange?.oldest ?? viewModel.oldest;
			const newest = this._zoomRange?.newest ?? viewModel.newest;
			const span = newest - oldest;
			if (span <= 0) return;

			const factor = Math.exp(e.deltaY * wheelZoomFactor);
			this._applyZoom(this._zoomAnchorTs(), span * factor);
			return;
		}

		// Trackpad horizontal pan (or shift+wheel): pan the timeline left/right. No-op when the
		// current view already shows the whole dataset (or more) — there's nothing to pan to, and
		// without this guard the clamp below would push `_zoomRange.newest` past `viewModel.newest`
		// and leave dead space at the right edge.
		const horizontalDelta = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
		if (horizontalDelta !== 0) {
			const oldest = this._zoomRange?.oldest ?? viewModel.oldest;
			const newest = this._zoomRange?.newest ?? viewModel.newest;
			const span = newest - oldest;
			const dataSpan = viewModel.newest - viewModel.oldest;
			if (span > 0 && span < dataSpan) {
				e.preventDefault();
				const shift = horizontalScrollbarDeltaToTimestampShift(
					horizontalDelta,
					lo,
					viewModel.oldest,
					viewModel.newest,
				);
				const newOldest = Math.max(viewModel.oldest, Math.min(viewModel.newest - span, oldest + shift));
				const newNewest = newOldest + span;
				this._zoomRange = { oldest: newOldest, newest: newNewest };
				this._zoomed = true;
				this._viewModel = undefined;
				this._requestDraw();
			}
			return;
		}

		// Default wheel: vertical scroll the swimlane region (V8).
		if (this._maxScrollY > 0) {
			e.preventDefault();
			this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY + e.deltaY));
			this._requestDraw();
		}
	};

	private _onKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') {
			if (this._zoomRange != null) {
				this._zoomRange = undefined;
				this._zoomed = false;
				this._viewModel = undefined;
				this._requestDraw();
			}
			return;
		}

		const viewModel = this._viewModel;
		if (viewModel == null || viewModel.commits.length === 0) return;

		const lastIdx = viewModel.commits.length - 1;
		let nextIdx: number | undefined;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			const direction = e.key === 'ArrowLeft' ? -1 : 1;
			const currentIdx = this._selectedSha != null ? (viewModel.shaToIndex.get(this._selectedSha) ?? 0) : 0;
			nextIdx = Math.max(0, Math.min(lastIdx, currentIdx + direction));
		} else if (e.key === 'Home') {
			nextIdx = 0;
		} else if (e.key === 'End') {
			nextIdx = lastIdx;
		} else {
			return;
		}

		const sha = viewModel.commits[nextIdx].sha;
		this._selectedSha = sha;
		this._scrollSelectedIntoView(nextIdx);
		this.emit('gl-commit-select', { id: sha, shift: e.shiftKey });
		e.preventDefault();
		this._requestDraw();
	};

	/**
	 * Scrolls the swimlane region vertically so the selected commit's row is in view, and pans the
	 * zoom window horizontally if the commit falls outside the current zoom range. Only fires for
	 * keyboard-driven selection — pointer-driven selection is already in view by definition.
	 */
	private _scrollSelectedIntoView(idx: number): void {
		const viewModel = this._viewModel;
		const lo = this._layout;
		if (viewModel == null || lo == null) return;

		// Vertical: bring the row into the visible swimlane region. All Y math is in virtual
		// coords, which include the swimlane's top buffer.
		const sliceIdx = viewModel.sliceIndex[idx];
		const rowTop = lo.swimlaneTopBufferPx + sliceIdx * lo.rowHeight;
		const rowCenterY = rowTop + lo.rowHeight / 2;
		const visibleH = lo.swimlaneBottom - lo.swimlaneTop;
		if (rowCenterY < this._scrollY) {
			this._scrollY = Math.max(0, rowTop);
		} else if (rowCenterY > this._scrollY + visibleH) {
			this._scrollY = Math.min(this._maxScrollY, rowTop + lo.rowHeight - visibleH);
		}

		// Horizontal: pan the zoom window so the commit's timestamp is visible. Preserves the
		// current zoom factor so the user's level of detail isn't lost on a keyboard step.
		// Final clamp to vm bounds matches the scrollbar/pan handlers — without it, `newOldest +
		// span` can exceed `vm.newest` (or `newNewest - span` go below `vm.oldest`) and leave
		// the chart with future-padding / past-padding off the data.
		const ts = viewModel.timestamps[idx];
		if (this._zoomRange != null) {
			const span = this._zoomRange.newest - this._zoomRange.oldest;
			if (ts < this._zoomRange.oldest) {
				let newOldest = Math.max(viewModel.oldest, ts - span * 0.1);
				let newNewest = newOldest + span;
				if (newNewest > viewModel.newest) {
					newOldest -= newNewest - viewModel.newest;
					newNewest = viewModel.newest;
				}
				this._zoomRange = { oldest: newOldest, newest: newNewest };
				this._viewModel = undefined;
			} else if (ts > this._zoomRange.newest) {
				let newNewest = Math.min(viewModel.newest, ts + span * 0.1);
				let newOldest = newNewest - span;
				if (newOldest < viewModel.oldest) {
					newNewest += viewModel.oldest - newOldest;
					newOldest = viewModel.oldest;
				}
				this._zoomRange = { oldest: newOldest, newest: newNewest };
				this._viewModel = undefined;
			}
		}
	}

	private _tooltipSha?: string;
	private _tooltipW = 0;
	private _tooltipH = 0;

	private _showTooltip(index: number | undefined, x: number, y: number): void {
		const tooltip = this._tooltipEl;
		if (tooltip == null) return;

		if (index == null || this._viewModel == null) {
			this._hideTooltip();
			return;
		}

		const commit = this._viewModel.commits[index];
		if (commit == null) {
			this._hideTooltip();
			return;
		}

		// Rebuild content only when the focused commit changes — moving the cursor across the same
		// bubble keeps the rendered DOM and only repositions, avoiding the per-mousemove
		// `replaceChildren` + forced `getBoundingClientRect` reflow. Keyed by sha so a viewModel
		// rebuild that shifts indices doesn't serve a stale tooltip.
		if (commit.sha !== this._tooltipSha) {
			// Safe DOM construction — never interpolate user-controlled strings into innerHTML.
			const author = document.createElement('div');
			author.className = 'tooltip__author';
			author.textContent = formatIdentityDisplayName(
				{ name: commit.author, current: commit.current },
				this.currentUserNameStyle,
			);

			const detailsRow = document.createElement('div');
			detailsRow.className = 'tooltip__row';
			const shaSpan = document.createElement('span');
			shaSpan.textContent = shortenRevision(commit.sha);
			detailsRow.appendChild(shaSpan);

			if (commit.additions != null) {
				const addSpan = document.createElement('span');
				addSpan.className = 'tooltip__additions';
				addSpan.textContent = `+${pluralize('line', commit.additions)}`;
				detailsRow.appendChild(addSpan);
			}
			if (commit.deletions != null) {
				const delSpan = document.createElement('span');
				delSpan.className = 'tooltip__deletions';
				delSpan.textContent = `-${pluralize('line', commit.deletions)}`;
				detailsRow.appendChild(delSpan);
			}

			const dateRow = document.createElement('div');
			dateRow.className = 'tooltip__row';
			const date = new Date(commit.date);
			dateRow.textContent = `${capitalize(fromNow(date))} (${formatDate(date, this.dateFormat)})`;

			const message = document.createElement('div');
			message.className = 'tooltip__message';
			message.textContent = commit.message;

			const binCount = this._viewModel.binCount?.[index];
			const children: HTMLElement[] = [author, detailsRow, dateRow, message];
			if (binCount != null && binCount > 1) {
				const binRow = document.createElement('div');
				binRow.className = 'tooltip__row';
				binRow.textContent = `+${binCount - 1} more in this ${this._binUnit}`;
				children.push(binRow);
			}

			tooltip.replaceChildren(...children);
			tooltip.dataset.visible = 'true';

			const tipRect = tooltip.getBoundingClientRect();
			this._tooltipW = tipRect.width || 320;
			this._tooltipH = tipRect.height || 100;
			this._tooltipSha = commit.sha;
		} else {
			tooltip.dataset.visible = 'true';
		}

		// Side-swap when the cursor is far enough right that the default right-side anchor would
		// run the tooltip off the canvas — measured tooltip dimensions are cached so the swap point
		// adapts to the actual content (sometimes a long author name pushes the tooltip wider
		// than the CSS max-width estimate).
		const lo = this._layout;
		const viewportW = lo?.width ?? 0;
		const viewportH = lo?.height ?? 0;
		const tipW = this._tooltipW;
		const tipH = this._tooltipH;
		const padding = 12;

		let left = x + padding;
		if (left + tipW > viewportW) {
			// Doesn't fit on the right of the cursor — flip to the left side. If it still doesn't
			// fit (very narrow placements), clamp to the right edge so it stays on screen.
			left = x - padding - tipW;
			if (left < 0) {
				left = Math.max(0, viewportW - tipW);
			}
		}

		let top = y + padding;
		if (top + tipH > viewportH) {
			top = y - padding - tipH;
			if (top < 0) {
				top = Math.max(0, viewportH - tipH);
			}
		}

		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	}

	private _hideTooltip(): void {
		const tooltip = this._tooltipEl;
		if (tooltip == null) return;

		tooltip.dataset.visible = 'false';
		this._tooltipSha = undefined;
	}

	resetZoom(): void {
		// "Reset" returns to the canonical default:
		// - With `windowSpanMs`: timeframe anchored at the newest commit
		// - Without (legacy): full dataset (`_zoomRange = undefined`)
		let nextRange: { oldest: number; newest: number } | undefined;
		if (this.windowSpanMs != null) {
			const newest = this._viewModel?.newest ?? this._data?.[0]?.sort;
			if (newest == null) return;

			nextRange = { oldest: newest - this.windowSpanMs, newest: newest };
			// Already at the default? No-op so we don't churn a draw cycle for nothing.
			if (
				this._zoomRange?.oldest === nextRange.oldest &&
				this._zoomRange?.newest === nextRange.newest &&
				!this._zoomed
			) {
				return;
			}
		} else if (this._zoomRange == null) {
			return;
		}

		this._zoomRange = nextRange;
		this._zoomed = false;
		this._viewModel = undefined;
		// Rebuild the view-model synchronously when the canvas is ready so the next Lit render
		// (triggered by the @state mutations above) sees a populated `_viewModel` — otherwise
		// `_renderRail` and `_renderAxisOverlay` early-return `nothing` for one frame and the
		// chart's chrome flashes off. Same pattern `_loadData()` uses on fresh datasets.
		if (this._ctx != null) {
			this._draw();
		} else {
			this._requestDraw();
		}
	}
}

function formatTickLabel(
	date: Date,
	unit: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year',
	shortFmt: string,
	opts: { showYear: boolean },
): string {
	switch (unit) {
		case 'hour':
			return formatDate(date, 'h a');
		case 'year':
			return formatDate(date, 'YYYY');
		case 'quarter':
		case 'month':
			return opts.showYear ? formatDate(date, 'MMM YYYY') : formatDate(date, 'MMM');
		default:
			return formatDate(date, opts.showYear ? shortFmt || 'MMM D, YYYY' : shortFmt || 'MMM D');
	}
}

function capitalize(s: string): string {
	return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Cubic ease-out — fast at the start, gentle at the end. Gives the hover scale-up that "pop"
 * feel without overshoot, and matches the curve a system motion toolkit would use by default. */
function easeOutCubic(t: number): number {
	const clamped = Math.max(0, Math.min(1, t));
	return 1 - (1 - clamped) ** 3;
}

/**
 * Compute a 1- or 2-character initials string from an author / branch name. Splits on whitespace
 * and most punctuation; falls back to the first 2 characters when the name has no separator
 * (e.g. usernames like `wolfsilver`) or to "?" when empty. Mirrors the heuristic VS Code uses for
 * its own avatar fallbacks.
 */
function computeInitials(name: string | undefined): string {
	if (!name) return '?';

	const parts = name
		.split(/[\s_\-/.@]+/)
		.map(p => p.trim())
		.filter(p => p.length > 0);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2);
	return parts[0][0] + (parts.at(-1) ?? '')[0];
}

export interface CommitEventDetail {
	id: string | undefined;
	shift: boolean;
	/** True when the selection is mid-drag (slider scrub) and the diff should be previewed but
	 * not committed — `actions.selectDataPoint` skips the host RPC for interim events so the
	 * editor doesn't churn through a diff per slider tick. */
	interim?: boolean;
	/** True when the chart auto-selected the newest commit on a fresh dataset's first paint
	 * (not a user action). The standalone host skips the diff-editor RPC for these; the embedded
	 * graph timeline forwards them so its details panel reflects the initial selection. */
	auto?: boolean;
}

/** Emitted in `windowed` mode when the user scrolls within 25% of the loaded dataset's left edge.
 * The host should fetch commits older than `before` (anchored at the dataset's loaded `oldest`),
 * extend the dataset, and reset `loadingMore` to `false` once the new chunk arrives. */
export interface LoadMoreEventDetail {
	before: number;
}

/** Emitted when the visible time range changes — driven by zoom, pan, chevron clicks, period
 *  changes, or initial-data seeding. Consumers (header pill) show the current visible span. */
export interface VisibleRangeEventDetail {
	oldest: number;
	newest: number;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-timeline-chart': GlTimelineChart;
	}

	interface GlobalEventHandlersEventMap {
		'gl-commit-select': CustomEvent<CommitEventDetail>;
		'gl-loading': CustomEvent<Promise<void>>;
		'gl-load-more': CustomEvent<LoadMoreEventDetail>;
		'gl-visible-range-changed': CustomEvent<VisibleRangeEventDetail>;
	}
}
