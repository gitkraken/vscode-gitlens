import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { PastAgentSessionsResult, PastAgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import type { AgentSessionCategory, StickyDetailResolver } from '../../../shared/agentUtils.js';
import {
	agentPhaseToCategory,
	createStickyDetailResolver,
	describeAgentSession,
	formatAgentElapsed,
	fpField,
	getAgentPhaseLabel,
	permissionFingerprint,
} from '../../../shared/agentUtils.js';
import { renderRunningTool } from '../../../shared/components/agents/agent-status-render.js';
import { agentPhaseElapsedStyles, agentToolStyles } from '../../../shared/components/agents/agent-status-styles.css.js';
import { elementBase, metadataBarVarsBase } from '../../../shared/components/styles/lit/base.css.js';
import '../../../shared/components/agents/gl-agent-prompt-detail.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/button.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

/** User-facing modes are `collapsed` (bar only) and `expanded` (all cards) — toggled by the
 *  chevron. `partial` is a panel-driven derived state: when the user is collapsed and a session
 *  transitions into `needs-input` (or its pending payload changes), the panel sets this so only
 *  needs-input cards surface. A chevron click from `partial` or `expanded` lands on `collapsed`;
 *  from `collapsed` it lands on `expanded`. */
export type ExpandState = 'collapsed' | 'partial' | 'expanded';

/** Cap on cluster dots in the section heading. Beyond this, an `+N` overflow chip takes the slot
 *  so the heading width stays bounded. */
const maxClusterDots = 5;

/** Periodic re-render driver matching the kanban's tick. Without this, the component's
 *  `shouldUpdate` short-circuit would freeze elapsed labels (`Working · 5m`) and prevent the
 *  sticky-tool cache from observing its own TTL expiry whenever the host falls silent. 30s is
 *  fine-grained enough for minute-resolution elapsed labels while staying coarse vs. push churn. */
const liveTickIntervalMs = 30 * 1000;

/** Note: the chevron uses two glyphs — `chevron-right` for collapsed/partial (rotated 0deg /
 *  45deg via the `data-expand` attribute) and `chevron-down` for expanded (no rotation). The
 *  glyph swap happens in the template; the rotation rules live in this file's styles. Keep
 *  the template's `icon=…` branch in lock-step with the CSS rules. */

export const expandVisibleCategories: Record<ExpandState, ReadonlySet<AgentSessionCategory>> = {
	collapsed: new Set<AgentSessionCategory>(),
	partial: new Set<AgentSessionCategory>(['needs-input']),
	expanded: new Set<AgentSessionCategory>(['needs-input', 'working', 'idle']),
};

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-agent-status': GlDetailsAgentStatus;
	}

	interface GlobalEventHandlersEventMap {
		/** Fired when the user clicks the chevron — the consumer (panel) owns the expand state
		 *  and decides the next mode. The component renders from the `expand` property only,
		 *  never from internal state. No payload — the panel knows its current user choice. */
		'gl-agent-status-expand-request': CustomEvent<void>;
	}
}

/**
 * Branch-scoped agent status display for the graph details panel. Renders a heading
 * (chevron + label + dot cluster + counts, with a hover popover for per-session detail) above
 * a cards list. The heading button toggles between collapsed (bar only) and expanded (all
 * cards). The panel can also project `partial` automatically — only needs-input cards visible —
 * when an agent surfaces a new request while the user has the section collapsed. Needs-input
 * and working cards adopt a gradient + icon-circle treatment so each surfaces as actionable at
 * a glance.
 */
@customElement('gl-details-agent-status')
export class GlDetailsAgentStatus extends LitElement {
	static override styles = [
		elementBase,
		metadataBarVarsBase,
		agentToolStyles,
		agentPhaseElapsedStyles,
		css`
			:host {
				display: block;

				/* No local agent-phase color overrides — inherits the unified palette from
		   theme.scss (--gl-agent-working-color / --gl-agent-waiting-color /
		   --gl-agent-idle-color) so this card, the sidebar leaf, the tooltip, the
		   status pill, and the WIP file decoration all share one set of phase colors. */

				/* Cap tooltips in the agents pane so long content (Bash command strings, agent
		   prompts) wraps inside a bounded box instead of escaping the narrow webview
		   panel's right edge. */
				--gl-tooltip-max-width: 28rem;
			}

			:host([hidden]) {
				display: none;
			}

			@keyframes gl-agent-pulse {
				0%,
				100% {
					opacity: 1;
				}

				50% {
					opacity: 0.45;
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.card--working .card__dot {
					animation: none;
				}

				/* Outer-tree rule wins over code-icon's own :host([modifier='spin']) animation. */
				.card__icon code-icon[modifier='spin'] {
					animation: none;
				}
			}

			/* ---------- Section (heading + cards list) ---------- */

			.section {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);

				/* Tight bottom padding (vs. 0.6rem top) avoids a dead gap above the next
		   section's intrinsic padding. Background inherits from the WIP details panel;
		   the sticky heading paints its own opaque background to obscure scrolling cards. */
				padding: 0.6rem var(--gl-panel-padding-right, 1rem) 0.3rem var(--gl-panel-padding-left, 1.2rem);
			}

			/* Divider between this section and the WIP section lives on the split-panel sash
	   (see .agent-status-split::part(divider) in graph.scss), not as a border here. */
			.section[data-expand='expanded'] {
				padding-bottom: var(--gl-space-8);
			}

			/* Heading doubles as the collapse toggle AND the at-a-glance phase summary —
	   chevron + label on the left, dot cluster + counts on the right. The dots and counts
	   remain visible in every state so the summary still informs at a glance even when
	   most cards are filtered out.

	   Sticky to the top of the scroll container ('.agent-status-split__top') so it stays
	   visible while the cards list scrolls behind it. Negative horizontal margins +
	   matching padding extend the heading's background over the section's horizontal
	   padding so cards don't peek through the sides as they scroll past. Negative top
	   margin + matching padding-top similarly covers the section's 'padding-top' zone. */
			.section__heading {
				position: sticky;
				top: 0;
				z-index: 1;
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: 0.6rem var(--gl-panel-padding-right, 1rem) 0.2rem var(--gl-panel-padding-left, 1.2rem);
				margin: -0.6rem calc(-1 * var(--gl-panel-padding-right, 1rem)) 0
					calc(-1 * var(--gl-panel-padding-left, 1.2rem));
				font: inherit;
				font-size: 0.85em;
				font-weight: 600;
				line-height: 1.2;
				color: var(--vscode-descriptionForeground);
				text-align: left;
				text-transform: uppercase;
				letter-spacing: 0.04em;

				/* Match the WIP details panel background (same token the commit-box uses) so the
		   sticky heading reads as continuous with the surrounding panel instead of as a
		   tinted metadata-bar strip. */
				background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
			}

			/* Only the toggle is the button; the resume action is its sibling at the far right. */
			.section__heading-toggle {
				display: flex;
				flex: 1;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
				padding: 0;
				font: inherit;
				color: inherit;
				text-align: left;
				text-transform: inherit;
				letter-spacing: inherit;
				appearance: none;
				cursor: pointer;
				background: none;
				border: none;
			}

			.section__heading-action {
				flex: none;
			}

			.section__heading-chevron {
				/* Pin the glyph to a fixed inline-flex square so the codicon's intrinsic em-box
		   offsets center predictably against the text. */
				display: inline-flex;
				flex: none;
				align-items: center;
				justify-content: center;
				width: 1.6rem;
				height: 1.6rem;
				font-size: 1.6rem;
				line-height: 1;

				/* Inherit so .section__heading:hover brightens chevron + text together. */
				color: inherit;

				/* Chevron-right for collapsed/partial (rotated via data-expand below); chevron-down
		   for expanded (no rotation — set in the template). The shared transition animates
		   the rotation cycle for collapsed↔partial. Default at 0deg in case the attribute
		   is briefly missing. */
				transform: rotate(0deg);
				transition: transform var(--gl-duration-medium) ease;
			}

			.section__heading-chevron[data-expand='collapsed'] {
				transform: rotate(0deg);
			}

			.section__heading-chevron[data-expand='partial'] {
				transform: rotate(45deg);
			}

			/* No [data-expand='expanded'] rule — expanded uses the chevron-down glyph (set in
	   the template), so the default 0deg from .section__heading-chevron keeps it
	   upright without an explicit override. */

			@media (prefers-reduced-motion: reduce) {
				.section__heading-chevron {
					transition: none;
				}
			}

			.section__heading-label {
				flex: 1;
				min-width: 0;
			}

			.section__heading:hover {
				color: var(--vscode-foreground);
			}

			.section__heading:focus-visible {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: 2px;
				border-radius: var(--gl-radius-xs);
			}

			/* Branch-sheet variant — the sheet's own .hub already supplies outer padding and
	   scrolls the whole pane (no inner scroller for the heading to stick within), so the
	   split-panel-scroller chrome below is wrong here and gets neutralized. */
			:host([flat]) .section {
				padding: 0;
			}

			:host([flat]) .section[data-expand='expanded'] {
				padding-bottom: 0;
			}

			:host([flat]) .section__heading {
				position: static;
				margin: 0;
				padding: 0;
				background-color: transparent;
			}

			/* Cluster — dots + textual summary inside the heading row. */
			.section__cluster {
				display: inline-flex;
				flex: none;
				gap: var(--gl-space-6);
				align-items: center;
				font-size: 0.95em;
				color: var(--vscode-foreground);
				text-transform: none;
				letter-spacing: 0;
				white-space: nowrap;
			}

			.section__cluster-dots {
				display: inline-flex;
				align-items: center;
			}

			.section__cluster-dot {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 1rem;
				height: 1rem;
				margin-left: -0.4rem;
				font-size: 0.7em;
				color: var(--vscode-foreground);
				border: 2px solid var(--gl-metadata-bar-bg, var(--vscode-editor-background));
				border-radius: 50%;
			}

			.section__cluster-dot:first-child {
				margin-left: 0;
			}

			.section__cluster-dot--working {
				background-color: var(--gl-agent-working-color);
			}

			.section__cluster-dot--needs-input {
				background-color: var(--gl-agent-waiting-color);

				/* Subtle attention nudge so a waiting dot reads as the priority signal */
				box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--gl-agent-waiting-color) 28%, transparent);
			}

			.section__cluster-dot--idle {
				background-color: var(--gl-agent-idle-color);
			}

			.section__cluster-dot--overflow {
				color: var(--vscode-descriptionForeground);
				background-color: var(--vscode-editor-background);
				border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 40%, transparent);
			}

			.section__cluster-summary strong {
				font-weight: 600;
				color: var(--gl-agent-waiting-color);
			}

			.section__list {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
			}

			/* ---------- Past sessions ---------- */

			.section__past {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				padding-top: var(--gl-space-4);
				margin-top: var(--gl-space-4);
				border-top: var(--gl-border-width) solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
			}

			.section__past-row {
				display: flex;
				gap: var(--gl-space-6);

				/* Top-align so the dot centers on the first line (matching the live cards' idle dots),
		   not on the whole title+prompt block. */
				align-items: flex-start;

				/* Cards inset their rail by their 0.3rem left border plus their padding; match it (and their
		   column gap) so the rails line up down the column even though a past row has no card chrome. */
				padding-left: calc(0.3rem + var(--gl-space-8));

				/* One step dimmer than .card--idle's 0.85 — reads as "not running" rather than idle. */
				opacity: 0.7;
			}

			/* Hollow ring (vs. the live cards' filled .card__dot disc) so a past row reads as
	   "no process" at a glance, reusing the same idle phase color. Sits in a .card__rail so the
	   body column lines up with the live cards above it. */
			.section__past-dot {
				flex: none;
				width: 0.8rem;
				height: 0.8rem;
				background-color: transparent;
				border: var(--gl-border-width) solid var(--gl-agent-idle-color);
				border-radius: 50%;
			}

			.section__past-body {
				display: flex;
				flex: 1;
				flex-direction: column;
				gap: var(--gl-space-2);
				min-width: 0;
			}

			.section__past-title-row {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;

				/* Match the rail's box so the hollow dot centers on the name line. Without a chip in
		   this row (unlike live cards) the bare text is shorter than the rail, leaving the dot low. */
				min-height: 1.6em;
			}

			.section__past-name {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
				white-space: nowrap;
			}

			.section__past-prompt {
				display: -webkit-box;
				overflow: hidden;
				-webkit-line-clamp: 2;
				font-size: 0.9em;
				font-style: italic;
				color: var(--vscode-descriptionForeground);
				-webkit-box-orient: vertical;
			}

			.section__past-footer {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				justify-content: flex-end;
			}

			.section__past-count {
				margin-right: auto;
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
			}

			.section__hover {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				min-width: 24rem;

				/* Bound the popover so long detail strings (errors, multi-line prompts) truncate
		   via ellipsis instead of stretching the popover to the viewport edge. */
				max-width: min(44rem, 60vw);
				padding: var(--gl-space-2);
			}

			.section__hover-row {
				display: grid;

				/* minmax(0, 1fr) lets the column shrink below its min-content size, which is
		   what allows text-overflow: ellipsis on the name/detail spans to engage. */
				grid-template-columns: auto minmax(0, 1fr) auto;
				gap: 0.1rem 0.6rem;
				align-items: center;
			}

			.section__hover-row + .section__hover-row {
				padding-top: var(--gl-space-6);
				border-top: var(--gl-border-width) solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
			}

			.section__hover-dot {
				flex: none;
				width: 0.7rem;
				height: 0.7rem;
				border-radius: 50%;
			}

			.section__hover-dot--working {
				background-color: var(--gl-agent-working-color);
			}

			.section__hover-dot--needs-input {
				background-color: var(--gl-agent-waiting-color);
			}

			.section__hover-dot--idle {
				background-color: var(--gl-agent-idle-color);
			}

			.section__hover-name {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
				white-space: nowrap;
			}

			.section__hover-phase {
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				white-space: nowrap;
			}

			.section__hover-phase--needs-input {
				font-weight: 600;
				color: var(--gl-agent-waiting-color);
			}

			.section__hover-detail {
				grid-column: 2 / -1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
			}

			/* Hover-row tool detail places the shared .agent-tool composite into the row's
	   second grid cell — visual styling lives in the shared agentToolStyles. */
			.section__hover-tool {
				grid-column: 2 / -1;
			}

			/* ---------- Card ----------
	   Two-row grid: rail + body on top, action row spans the full body column on bottom.
	   The actions always sit at the bottom of the card regardless of panel width.
	   needs-input and working cards adopt the prior banner treatment (gradient bg +
	   icon-circle in the rail) so each surfaces as actionable on its own. */
			.card {
				display: grid;
				grid-template-rows: auto auto;
				grid-template-columns: auto 1fr;
				gap: var(--gl-space-4) var(--gl-space-6);
				align-items: start;
				padding: var(--gl-space-6) var(--gl-space-8);
				background-color: var(--vscode-editor-background);
				border: var(--gl-border-width) solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
				border-left: 3px solid var(--card-accent, var(--gl-agent-idle-color));
				border-radius: var(--gl-radius-sm);
				transition:
					background var(--gl-duration-slow) ease,
					border-left-color var(--gl-duration-slow) ease;
			}

			.card--needs-input {
				--card-accent: var(--gl-agent-waiting-color);

				background: linear-gradient(
					to right,
					color-mix(in srgb, var(--card-accent) 14%, var(--vscode-editor-background)),
					color-mix(in srgb, var(--card-accent) 4%, var(--vscode-editor-background))
				);
			}

			.card--working {
				--card-accent: var(--gl-agent-working-color);

				background: linear-gradient(
					to right,
					color-mix(in srgb, var(--card-accent) 14%, var(--vscode-editor-background)),
					color-mix(in srgb, var(--card-accent) 4%, var(--vscode-editor-background))
				);
			}

			.card--idle {
				--card-accent: var(--gl-agent-idle-color);

				opacity: 0.85;
			}

			/* Highlighted by an external trigger (e.g., sidebar agent leaf click). A subtle 1px
	   inset outline reads as "you picked this one" without overwhelming the card's
	   own gradient/accent treatment — the prior halo+border combo was too loud against
	   needs-input/working cards that already carry a colored gradient. outline-offset
	   -1px tucks the ring just inside the card border so the card's footprint stays
	   stable. opacity: 1 reasserts idle cards (which are dimmed by default) on selection.
	   forced-colors mode substitutes Highlight for the focusBorder token automatically. */
			.card--selected {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: -1px;
				opacity: 1;
			}

			.card__rail {
				display: flex;
				grid-row: 1;
				grid-column: 1;
				align-items: center;
				justify-content: center;

				/* Fixed rail width so the body column lines up across cards regardless of which
		   indicator (icon-circle vs small dot) sits inside. */
				width: 2.4rem;
				min-height: 1.6em;
			}

			/* Idle cards keep a small dot — the icon-circle treatment is reserved for actionable phases. */
			.card__dot {
				flex: none;
				width: 0.8rem;
				height: 0.8rem;
				aspect-ratio: 1;
				background-color: var(--card-accent);
				border-radius: 50%;
			}

			/* Icon-circle for needs-input/working cards. Carries the banner's prior visual weight. */
			.card__icon {
				display: inline-flex;
				flex: none;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 2.4rem;
				font-size: 1.6em;
				color: var(--card-accent);
				background-color: color-mix(in srgb, var(--card-accent) 18%, transparent);
				border-radius: 50%;
				transition:
					color var(--gl-duration-slow) ease,
					background-color var(--gl-duration-slow) ease;
			}

			.card__body {
				display: flex;
				flex-direction: column;
				grid-row: 1;
				grid-column: 2;
				gap: var(--gl-space-2);
				min-width: 0;
			}

			.card__title-row {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}

			.card__name {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
				white-space: nowrap;
			}

			.card__phase {
				flex: none;
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.card__phase--needs-input {
				font-weight: 600;
				color: var(--gl-agent-waiting-color);
			}

			.card__detail {
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
			}

			.card__prompt {
				display: -webkit-box;
				margin-top: var(--gl-space-2);
				overflow: hidden;
				-webkit-line-clamp: 2;
				font-size: 0.9em;
				font-style: italic;
				color: var(--vscode-descriptionForeground);
				-webkit-box-orient: vertical;
			}

			.card__actions {
				display: flex;
				flex: none;
				flex-direction: row;
				grid-row: 2;
				grid-column: 2;
				gap: 0.3rem;
				align-items: center;
				justify-content: flex-end;
			}
		`,
	];

	@property({ type: Array })
	sessions?: AgentSessionState[];

	/** Controlled by the consumer (panel). The component is a pure projection of this property
	 *  — no internal expand state, no mirror-via-event dance. User chevron clicks emit a
	 *  `gl-agent-status-expand-request` event; the panel decides whether to honor it by
	 *  writing back to this property. */
	@property({ type: String })
	expand: ExpandState = 'collapsed';

	/* Note: when the section is `collapsed` we render no cards at all — the heading bar stands
	 *  alone. The panel flips us to `partial` automatically when a new needs-input event fires
	 *  while the user is collapsed (or has just collapsed away from a needs-input set), so the
	 *  user is re-notified without losing the "I've acknowledged this" gesture. */

	/** When set, the card matching this id receives a `card--selected` modifier (highlighted
	 *  border, brighter accent). Set by external callers (e.g., sidebar agent leaf click) to
	 *  surface a specific session in this section. Cleared by the consumer when no longer relevant. */
	@property({ type: String, attribute: 'selected-session-id' })
	selectedSessionId?: string;

	/** Sticky "current tool call" resolver shared with the kanban — see
	 *  {@link createStickyDetailResolver}. Hides the brief inter-tool-call flicker where
	 *  `session.statusDetail` empties before the next tool latches, so the running-tool composite
	 *  stays visible across the gap. Permission detail (`<gl-agent-prompt-detail>`) is not
	 *  stickified — it reflects a steady state rather than a stream of events. */
	private readonly _stickyResolver: StickyDetailResolver = createStickyDetailResolver();

	/** Cached render fingerprint — see {@link computeFingerprint}. Compared in `shouldUpdate` to
	 *  skip renders for no-op parent passes (same sessions content, same expand, same selection).
	 *  The parent (`gl-graph-details-panel`) is a SignalWatcher and rebuilds `worktreeAgentSessions`
	 *  via `.filter()` on every signal push, so we'd otherwise receive a fresh array reference and
	 *  re-render even when no rendered field changed. */
	private _lastFingerprint?: string;

	/** Live-tick counter mixed into {@link computeFingerprint} so the periodic tick deterministically
	 *  invalidates the fingerprint once per interval — without it, `shouldUpdate` would short-circuit
	 *  the tick when session content is unchanged, and elapsed labels / sticky-cache TTL expiry
	 *  would freeze whenever the host falls silent. */
	private _tickGeneration = 0;

	private _liveTickHandle?: ReturnType<typeof setInterval>;

	/** Returns the rendered card element for `sessionId`, or `null` if no matching card is in
	 *  this component's shadow tree (session not rendered yet, filtered out by expand state,
	 *  etc.). Exposed so the consumer can drive its own scroll math against an outer scroller
	 *  without piercing this component's shadow root. */
	getSessionCard(sessionId: string): HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(sessionId)}"]`) ?? null;
	}

	/** When true, render only the dot-cluster + counts popover anchor — drop the chevron, "Agents"
	 *  label, and the cards body. Used by surfaces (e.g. the treemap's Activity toolbar) that
	 *  want the live-status glance but don't need the inline expanded view; per-session detail is
	 *  still available via hover on the cluster. Past sessions never factor into this mode — see
	 *  {@link render}. */
	@property({ type: Boolean, reflect: true })
	compact = false;

	/** Past (resumable) sessions for the worktree — top few, most-recent first, plus the total
	 *  count for the "Showing N of M" footer. Rendered as a `.section__past` list, visible only
	 *  while {@link expand} is `'expanded'` (past is never urgent enough to auto-surface). */
	@property({ attribute: false })
	pastSessions?: PastAgentSessionsResult;

	/** The worktree the past sessions belong to — threaded into the "Resume Session…" footer
	 *  button's `showResumeSessionPicker` command link. */
	@property({ attribute: false })
	worktreePath?: string;

	/** Branch-sheet variant: neutralizes the panel-scroller-specific chrome (sticky heading,
	 *  hardcoded panel padding) that's wrong inside the sheet's `.hub`. See the `:host([flat])`
	 *  overrides below. */
	@property({ type: Boolean, reflect: true })
	flat = false;

	/** Build a stable string capturing every input the component renders against. Identical
	 *  fingerprint between two parent passes → skip the render entirely via {@link shouldUpdate}.
	 *
	 *  Fields included reflect what `renderCard`, `renderHoverRow`, `tally`, and the heading
	 *  cluster consume:
	 *  - `expand`, `selectedSessionId`, `flat`, `compact` — all shape the rendered tree (`compact`
	 *    is reflected via `update()`, which never runs when `shouldUpdate` returns false).
	 *  - Per session: `id`, `phase`, `status`, `statusDetail` (running-tool surface), `displayName`,
	 *    `lastPrompt` (card prompt + fallback line), `phaseSince` (ms, drives elapsed labels).
	 *  - `pendingPermission` — encoded by {@link permissionFingerprint} so every needs-input
	 *    variant's renderable fields contribute, not just kind/toolName.
	 *  - `pastSessions.total` plus, per past row, `id`/`displayName`/`lastPrompt`/`lastActivity`.
	 *
	 *  Adding a new rendered field requires extending this fingerprint (or
	 *  {@link permissionFingerprint}) or the component will silently fail to update when only
	 *  that field changes. */
	private computeFingerprint(): string {
		// Mix `_tickGeneration` so the periodic tick deterministically advances the fingerprint
		// even when session content is unchanged. Every user-typed string field goes through
		// `fpField` so embedded `|` (shell pipes in statusDetail, free-form descriptions) and
		// `\n` (multi-line prompts) can't collide via delimiter accidents.
		const parts: string[] = [
			`t${this._tickGeneration}`,
			`e${this.expand}`,
			`s${fpField(this.selectedSessionId)}`,
			`f${this.flat ? 1 : 0}`,
			`c${this.compact ? 1 : 0}`,
		];
		const sessions = this.sessions ?? [];
		for (const s of sessions) {
			parts.push(
				`${s.id}|${s.phase}|${fpField(s.status)}|${fpField(s.statusDetail)}|${fpField(s.displayName)}|${fpField(s.lastPrompt)}|${s.phaseSince.getTime()}|${permissionFingerprint(s.pendingPermission)}`,
			);
		}
		const past = this.pastSessions;
		parts.push(`p${past?.total ?? 0}`);
		for (const p of past?.sessions ?? []) {
			parts.push(`${p.id}|${fpField(p.displayName)}|${fpField(p.lastPrompt)}|${p.lastActivity}`);
		}
		return parts.join('\n');
	}

	override shouldUpdate(_changedProps: PropertyValues): boolean {
		const fingerprint = this.computeFingerprint();
		if (this._lastFingerprint === fingerprint) {
			return false;
		}

		return true;
	}

	override update(changedProps: PropertyValues): void {
		// Capture the fingerprint AFTER `super.update()` (which runs `render()`). If render throws
		// — bad session shape, template binding error — the next parent push should retry rather
		// than be silently de-duped against the failed fingerprint. Also prune the sticky cache
		// here so removed sessions don't accumulate entries across session lifecycles.
		super.update(changedProps);
		const sessions = this.sessions ?? [];
		this._lastFingerprint = this.computeFingerprint();
		if (this._stickyResolver.size > 0) {
			this._stickyResolver.prune(sessions.map(s => s.id));
		}
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._liveTickHandle = setInterval(() => {
			// See {@link _tickGeneration} doc — must increment BEFORE requesting update so the
			// fingerprint reads the new value and shouldUpdate doesn't short-circuit the tick.
			this._tickGeneration++;
			this.requestUpdate();
		}, liveTickIntervalMs);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		if (this._liveTickHandle != null) {
			clearInterval(this._liveTickHandle);
			this._liveTickHandle = undefined;
		}
	}

	override render(): unknown {
		const sessions = this.sessions;

		// Compact stays past-agnostic — the treemap toolbar passes no `pastSessions`, and this
		// mode's cluster-only glance has no room for a past list anyway.
		if (this.compact) {
			if (sessions == null || sessions.length === 0) return nothing;
			return this.renderClusterOnly(sessions);
		}

		const live = sessions ?? [];
		// De-dup against live at render time: the host excludes live ids at fetch time, but after a
		// resume the cached past list goes stale until the next fetch, and would otherwise paint twice.
		const liveIds = new Set(live.map(s => s.id));
		const past = this.pastSessions?.sessions.filter(p => !liveIds.has(p.id));
		if (live.length === 0 && (past?.length ?? 0) === 0) return nothing;

		return this.renderSection(live, this.tally(live), past);
	}

	/** Compact render: just the cluster + counts popover, no surrounding heading button or cards.
	 *  Hover still surfaces the per-session detail via the same shared popover body. */
	private renderClusterOnly(sessions: AgentSessionState[]): unknown {
		const counts = this.tally(sessions);
		const visibleDots = sessions.slice(0, maxClusterDots);
		const overflow = sessions.length - visibleDots.length;
		return html`
			<gl-popover placement="bottom">
				<span slot="anchor" class="section__cluster" tabindex="0" role="button" aria-label="Agent sessions">
					<span class="section__cluster-dots">
						${visibleDots.map(
							s =>
								html`<span
									class=${`section__cluster-dot section__cluster-dot--${agentPhaseToCategory[s.phase]}`}
								></span>`,
						)}
						${overflow > 0
							? html`<span
									class="section__cluster-dot section__cluster-dot--idle section__cluster-dot--overflow"
								>
									+${overflow}
								</span>`
							: nothing}
					</span>
					<span class="section__cluster-summary">${this.renderCountsSummary(counts)}</span>
				</span>
				<div slot="content" class="section__hover">${sessions.map(s => this.renderHoverRow(s))}</div>
			</gl-popover>
		`;
	}

	/* ---------- Section (heading + cards list) ---------- */

	private renderSection(
		sessions: AgentSessionState[],
		counts: Record<AgentSessionCategory, number>,
		past: PastAgentSessionState[] | undefined,
	): unknown {
		const visibleCats = expandVisibleCategories[this.expand];
		const visible = sessions.filter(s => visibleCats.has(agentPhaseToCategory[s.phase]));
		// Past is never urgent — only surfaced once the user has explicitly expanded the section.
		const showPast = this.expand === 'expanded';

		return html`
			<div class="section" data-expand=${this.expand}>
				${this.renderSectionHeading(sessions, counts)}
				${visible.length > 0
					? html`<div id="section__list" class="section__list">${visible.map(s => this.renderCard(s))}</div>`
					: nothing}
				${showPast ? this.renderPastSection(past) : nothing}
			</div>
		`;
	}

	/** "Past sessions" list — resumable sessions recovered from the worktree's transcript store,
	 *  rendered only in `expanded` mode. Each row links its resume chip at `gitlens.agents.resumeSession`
	 *  (the default extension-if-available-else-terminal resume); the footer's "Resume Session…"
	 *  button opens the full searchable picker over the worktree's 100 most-recent sessions. */
	private renderPastSection(past: PastAgentSessionState[] | undefined): unknown {
		if (!past?.length) return nothing;

		const total = this.pastSessions?.total ?? past.length;
		return html`
			<div class="section__past">
				${past.map(p => this.renderPastRow(p))} ${this.renderPastFooter(total, past.length)}
			</div>
		`;
	}

	private renderPastRow(session: PastAgentSessionState): unknown {
		const elapsed = formatAgentElapsed(new Date(session.lastActivity));
		const resumeHref = createCommandLink('gitlens.agents.resumeSession', {
			sessionId: session.id,
			cwd: session.cwd,
		});
		// Mirrors a live card's `{phase} · {elapsed}`. "Ended" is all we can honestly say — the store
		// keeps no exit reason, only that nothing is running.
		const stateContent = html`Ended${elapsed != null
			? html` · <span class="agent-phase-elapsed">${elapsed}</span>`
			: nothing}`;

		return html`
			<div class="section__past-row" data-session-id=${session.id}>
				<div class="card__rail"><span class="section__past-dot"></span></div>
				<div class="section__past-body">
					<div class="section__past-title-row">
						<gl-tooltip content=${session.displayName} placement="bottom">
							<span class="section__past-name">${session.displayName}</span>
						</gl-tooltip>
						${elapsed != null
							? html`<gl-tooltip content=${`Last active ${elapsed} ago`} placement="bottom">
									<span class="card__phase">${stateContent}</span>
								</gl-tooltip>`
							: html`<span class="card__phase">${stateContent}</span>`}
					</div>
					${session.lastPrompt
						? html`<gl-tooltip content=${session.lastPrompt} placement="bottom">
								<span class="section__past-prompt">${session.lastPrompt}</span>
							</gl-tooltip>`
						: nothing}
				</div>
				<gl-action-chip
					icon="debug-restart"
					label="Resume Session"
					overlay="tooltip"
					href=${resumeHref}
				></gl-action-chip>
			</div>
		`;
	}

	/** Just the count — the picker that shows the rest lives on the heading. */
	private renderPastFooter(total: number, shown: number): unknown {
		if (total <= shown) return nothing;

		return html`
			<div class="section__past-footer">
				<span class="section__past-count">Showing ${shown} of ${total}</span>
			</div>
		`;
	}

	private renderSectionHeading(sessions: AgentSessionState[], counts: Record<AgentSessionCategory, number>): unknown {
		const state = this.expand;
		const visibleDots = sessions.slice(0, maxClusterDots);
		const overflow = sessions.length - visibleDots.length;

		// The row is a container, not the button: the resume action sits inside it, and a control
		// nested in a <button> is invalid and unreachable by keyboard.
		return html`
			<div class="section__heading">
				<button
					type="button"
					class="section__heading-toggle"
					aria-controls="section__list"
					aria-expanded=${state === 'expanded' ? 'true' : 'false'}
					aria-label=${this.expandAriaLabel(state)}
					@click=${this.onChevronClick}
				>
					<code-icon
						class="section__heading-chevron"
						icon=${state === 'expanded' ? 'chevron-down' : 'chevron-right'}
						data-expand=${state}
					></code-icon>
					<span class="section__heading-label">Agents</span>
					<gl-popover placement="bottom" ?disabled=${state === 'expanded'}>
						<span slot="anchor" class="section__cluster">
							<span class="section__cluster-dots">
								${visibleDots.map(
									s =>
										html`<span
											class=${`section__cluster-dot section__cluster-dot--${agentPhaseToCategory[s.phase]}`}
										></span>`,
								)}
								${overflow > 0
									? html`<span
											class="section__cluster-dot section__cluster-dot--idle section__cluster-dot--overflow"
										>
											+${overflow}
										</span>`
									: nothing}
							</span>
							<span class="section__cluster-summary">${this.renderCountsSummary(counts)}</span>
						</span>
						<div slot="content" class="section__hover">${sessions.map(s => this.renderHoverRow(s))}</div>
					</gl-popover>
				</button>
				${this.renderResumePickerAction()}
			</div>
		`;
	}

	/** Opens the picker over every session the worktree can resume — available whatever the section
	 *  shows, so it hangs off the heading rather than the past list. */
	private renderResumePickerAction(): unknown {
		if (this.worktreePath == null) return nothing;

		return html`<gl-action-chip
			class="section__heading-action"
			icon="history"
			label="Resume Session…"
			overlay="tooltip"
			href=${createCommandLink('gitlens.agents.showResumeSessionPicker', { worktreePath: this.worktreePath })}
		></gl-action-chip>`;
	}

	/** Chevron click — emits a `gl-agent-status-expand-request` with the next state in the
	 *  collapsed ↔ expanded toggle. The consumer (panel) owns `expand` and decides the next
	 *  mode (partial folds back to collapsed). The component is a pure projection of the
	 *  property. */
	private onChevronClick = (): void => {
		this.dispatchEvent(
			new CustomEvent('gl-agent-status-expand-request', {
				bubbles: true,
				composed: true,
			}),
		);
	};

	private expandAriaLabel(state: ExpandState): string {
		switch (state) {
			case 'collapsed':
				return 'Show all sessions';
			case 'partial':
				return 'Showing sessions needing input — collapse';
			case 'expanded':
				return 'Showing all sessions — collapse';
		}
	}

	private renderCountsSummary(counts: Record<AgentSessionCategory, number>): unknown {
		const parts: unknown[] = [];
		if (counts['needs-input'] > 0) {
			parts.push(html`<strong>${counts['needs-input']} need input</strong>`);
		}
		if (counts.working > 0) {
			parts.push(html`<span>${counts.working} working</span>`);
		}
		if (counts.idle > 0) {
			parts.push(html`<span>${counts.idle} idle</span>`);
		}

		const out: unknown[] = [];
		parts.forEach((p, i) => {
			if (i > 0) {
				out.push(' · ');
			}
			out.push(p);
		});
		return out;
	}

	private renderHoverRow(session: AgentSessionState): unknown {
		const category = agentPhaseToCategory[session.phase];
		const elapsed = formatAgentElapsed(session.phaseSince);
		const phaseLabel = getAgentPhaseLabel(category, session.pendingPermission);
		// Route the running-tool surface through the sticky resolver so brief gaps between tool
		// calls (when `session.status` leaves `tool_use` and `statusDetail` empties) don't flicker
		// the row's `[tools] X(...)` block back to the generic detail line. `stickyTool` returns
		// the cached descriptor for up to ~3s after the live one drops away.
		const stickyTool = this._stickyResolver.resolveLiveTool(session);
		const detail =
			stickyTool != null
				? undefined
				: describeAgentSession(session, category, elapsed, {
						awaitingPrefix: 'short',
						idleFallback: 'lastPrompt',
					});

		return html`
			<div class="section__hover-row">
				<span class=${`section__hover-dot section__hover-dot--${category}`}></span>
				<gl-tooltip content=${session.displayName} placement="bottom">
					<span class="section__hover-name">${session.displayName}</span>
				</gl-tooltip>
				<span class=${`section__hover-phase section__hover-phase--${category}`}>
					${phaseLabel}${elapsed != null ? html` · <span class="agent-phase-elapsed">${elapsed}</span>` : ''}
				</span>
				${this.renderHoverRowDetail(stickyTool, detail)}
			</div>
		`;
	}

	private renderHoverRowDetail(stickyTool: string | undefined, detail: string | undefined): unknown {
		if (stickyTool != null) {
			return html`<span class="section__hover-tool">${renderRunningTool(stickyTool)}</span>`;
		}
		if (detail) {
			return html`<gl-tooltip content=${detail} placement="bottom">
				<span class="section__hover-detail">${detail}</span>
			</gl-tooltip>`;
		}
		return nothing;
	}

	private renderCard(session: AgentSessionState): unknown {
		const category = agentPhaseToCategory[session.phase];
		const elapsed = formatAgentElapsed(session.phaseSince);
		const permission = session.pendingPermission;
		const phaseLabel = getAgentPhaseLabel(category, permission);
		const phaseContent = html`${phaseLabel}${elapsed != null
			? html` · <span class="agent-phase-elapsed">${elapsed}</span>`
			: nothing}`;
		const phaseTooltip = elapsed != null ? `Last active ${elapsed} ago` : undefined;
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id));
		// Resolve actions surface whenever a pending permission exists. Peer-discovered sessions
		// (owned by another GitLens window) reach the host's `resolvePermission`, which surfaces
		// a notification rather than silently no-opping when the route is unavailable.
		const canResolve = category === 'needs-input' && permission != null;
		const isSelected = this.selectedSessionId != null && this.selectedSessionId === session.id;

		return html`
			<div
				class=${`card card--${category}${isSelected ? ' card--selected' : ''}`}
				data-session-id=${session.id}
				aria-current=${isSelected ? 'true' : nothing}
			>
				<div class="card__rail">${this.renderCardRail(category)}</div>
				<div class="card__body">
					<div class="card__title-row">
						<gl-tooltip content=${session.displayName} placement="bottom">
							<span class="card__name">${session.displayName}</span>
						</gl-tooltip>
						${phaseTooltip != null
							? html`<gl-tooltip content=${phaseTooltip} placement="bottom">
									<span class=${`card__phase card__phase--${category}`}>${phaseContent}</span>
								</gl-tooltip>`
							: html`<span class=${`card__phase card__phase--${category}`}>${phaseContent}</span>`}
						<gl-action-chip
							class="card__open"
							icon="link-external"
							label="Open Session"
							overlay="tooltip"
							href=${openHref}
						></gl-action-chip>
					</div>
					${this.renderCardDetail(session, category, elapsed)}
					${session.lastPrompt
						? html`<gl-tooltip content=${session.lastPrompt} placement="bottom">
								<span class="card__prompt">${session.lastPrompt}</span>
							</gl-tooltip>`
						: nothing}
				</div>
				${canResolve ? html`<div class="card__actions">${this.renderCardActions(session)}</div>` : nothing}
			</div>
		`;
	}

	/** Detail block for the card body — three mutually exclusive shapes:
	 *  - needs-input + permission → shared `<gl-agent-prompt-detail>` composite
	 *  - working + tool_use (live OR sticky-cached) → `[tools icon] <statusDetail>` composite
	 *  - everything else → single-line `describeAgentSession` string in `card__detail`
	 *
	 *  The middle branch goes through `_stickyResolver` so the composite stays visible across the
	 *  brief inter-tool-call gap where `session.statusDetail` empties — without it the running-
	 *  tool row would flicker out for hundreds of ms before the next tool call latches.
	 */
	private renderCardDetail(
		session: AgentSessionState,
		category: AgentSessionCategory,
		elapsed: string | undefined,
	): unknown {
		const permission = session.pendingPermission;
		if (category === 'needs-input' && permission != null) {
			// Evict any prior working-phase sticky entry — see {@link createStickyDetailResolver}
			// for why bypassing `resolveLiveTool` would otherwise leak the pre-permission tool
			// detail across the permission round-trip.
			this._stickyResolver.evict(session.id);
			return html`<gl-agent-prompt-detail .permission=${permission}></gl-agent-prompt-detail>`;
		}

		const stickyTool = this._stickyResolver.resolveLiveTool(session);
		if (stickyTool != null) {
			return renderRunningTool(stickyTool);
		}

		const detailLine = describeAgentSession(session, category, elapsed, {
			awaitingPrefix: 'long',
			idleFallback: 'none',
		});
		if (!detailLine) return nothing;

		return html`<gl-tooltip content=${detailLine} placement="bottom">
			<span class="card__detail">${detailLine}</span>
		</gl-tooltip>`;
	}

	/** Rail content for the card. needs-input gets a warning glyph; working gets a spinning sync —
	 *  matches the prior banner icon-circle treatment. Idle keeps the small dot. */
	private renderCardRail(category: AgentSessionCategory): unknown {
		if (category === 'needs-input') {
			return html`<span class="card__icon"><code-icon icon="warning"></code-icon></span>`;
		}
		if (category === 'working') {
			return html`<span class="card__icon"><code-icon icon="sync" modifier="spin"></code-icon></span>`;
		}
		return html`<span class="card__dot"></span>`;
	}

	/** Renders the needs-input action row. Open is hoisted into the card title row as an action
	 *  chip; Always Allow is promoted out of any overflow menu so all three permission resolutions
	 *  are visible inline. Only called when `canResolve` is true, so the no-detail branch is
	 *  unreachable. */
	private renderCardActions(session: AgentSessionState): unknown {
		const permission = session.pendingPermission;
		if (permission == null) return nothing;

		const allowHref = createCommandLink('gitlens.agents.resolvePermission', {
			sessionId: session.id,
			decision: 'allow' as const,
		});
		const denyHref = createCommandLink('gitlens.agents.resolvePermission', {
			sessionId: session.id,
			decision: 'deny' as const,
		});
		// Always-Allow only applies to regular tool permissions — plan / question / elicitation
		// have no recurring rule to install.
		const showAlwaysAllow =
			permission.kind === 'tool' && permission.suggestions != null && permission.suggestions.length > 0;
		const alwaysAllowHref = showAlwaysAllow
			? createCommandLink('gitlens.agents.resolvePermission', {
					sessionId: session.id,
					decision: 'allow' as const,
					alwaysAllow: true,
				})
			: undefined;
		const allowLabel = permission.kind === 'plan' ? 'Approve Plan' : 'Allow';
		const denyLabel = permission.kind === 'plan' ? 'Reject Plan' : 'Deny';

		// View Plan / Copy Plan affordances live in the prompt-detail composite (as chips in the
		// caption row), so they don't get duplicated here. This row carries only resolution actions.
		return html`
			<gl-button density="compact" href=${allowHref}>
				<code-icon icon="check" slot="prefix"></code-icon>
				${allowLabel}
			</gl-button>
			${showAlwaysAllow && alwaysAllowHref != null
				? html`<gl-button appearance="secondary" density="compact" href=${alwaysAllowHref}>
						<code-icon icon="check-all" slot="prefix"></code-icon>
						Always Allow
					</gl-button>`
				: nothing}
			<gl-button appearance="secondary" density="compact" href=${denyHref}>
				<code-icon icon="x" slot="prefix"></code-icon>
				${denyLabel}
			</gl-button>
		`;
	}

	private tally(sessions: AgentSessionState[]): Record<AgentSessionCategory, number> {
		const counts: Record<AgentSessionCategory, number> = { working: 0, 'needs-input': 0, idle: 0 };
		for (const s of sessions) {
			counts[agentPhaseToCategory[s.phase]]++;
		}
		return counts;
	}
}
