import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
				gap: 0.4rem;
				/* Tight bottom padding (vs. 0.6rem top) avoids a dead gap above the next
				   section's intrinsic padding. Background inherits from the WIP details panel;
				   the sticky heading paints its own opaque background to obscure scrolling cards. */
				padding: 0.6rem var(--gl-panel-padding-right, 1rem) 0.3rem var(--gl-panel-padding-left, 1.2rem);
			}

			/* Divider between this section and the WIP section lives on the split-panel sash
			   (see .agent-status-split::part(divider) in graph.scss), not as a border here. */
			.section[data-expand='expanded'] {
				padding-bottom: 0.8rem;
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
				appearance: none;
				position: sticky;
				top: 0;
				z-index: 1;
				display: flex;
				align-items: center;
				gap: 0.6rem;
				margin: -0.6rem calc(-1 * var(--gl-panel-padding-right, 1rem)) 0
					calc(-1 * var(--gl-panel-padding-left, 1.2rem));
				padding: 0.6rem var(--gl-panel-padding-right, 1rem) 0.2rem var(--gl-panel-padding-left, 1.2rem);
				/* Match the WIP details panel background (same token the commit-box uses) so the
				   sticky heading reads as continuous with the surrounding panel instead of as a
				   tinted metadata-bar strip. */
				background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
				border: none;
				font: inherit;
				font-size: 0.85em;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				cursor: pointer;
				text-align: left;
				line-height: 1.2;
			}

			.section__heading-chevron {
				flex: none;
				/* Pin the glyph to a fixed inline-flex square so the codicon's intrinsic em-box
				   offsets center predictably against the text. */
				display: inline-flex;
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
				transition: transform 0.2s ease;
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
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
				border-radius: 0.2rem;
			}

			/* Cluster — dots + textual summary inside the heading row. */
			.section__cluster {
				display: inline-flex;
				align-items: center;
				gap: 0.6rem;
				flex: none;
				font-size: 0.95em;
				text-transform: none;
				letter-spacing: 0;
				color: var(--vscode-foreground);
				white-space: nowrap;
			}

			.section__cluster-dots {
				display: inline-flex;
				align-items: center;
			}

			.section__cluster-dot {
				width: 1rem;
				height: 1rem;
				border-radius: 50%;
				border: 2px solid var(--gl-metadata-bar-bg, var(--vscode-editor-background));
				margin-left: -0.4rem;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				font-size: 0.7em;
				color: var(--vscode-foreground);
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
				background-color: var(--vscode-editor-background);
				border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 40%, transparent);
				color: var(--vscode-descriptionForeground);
			}

			.section__cluster-summary strong {
				color: var(--gl-agent-waiting-color);
				font-weight: 600;
			}

			.section__list {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.section__hover {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
				padding: 0.2rem;
				min-width: 24rem;
				/* Bound the popover so long detail strings (errors, multi-line prompts) truncate
				   via ellipsis instead of stretching the popover to the viewport edge. */
				max-width: min(44rem, 60vw);
			}

			.section__hover-row {
				display: grid;
				/* minmax(0, 1fr) lets the column shrink below its min-content size, which is
				   what allows text-overflow: ellipsis on the name/detail spans to engage. */
				grid-template-columns: auto minmax(0, 1fr) auto;
				column-gap: 0.6rem;
				row-gap: 0.1rem;
				align-items: center;
			}

			.section__hover-row + .section__hover-row {
				padding-top: 0.6rem;
				border-top: 1px solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
			}

			.section__hover-dot {
				width: 0.7rem;
				height: 0.7rem;
				border-radius: 50%;
				flex: none;
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
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
			}

			.section__hover-phase {
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				white-space: nowrap;
			}

			.section__hover-phase--needs-input {
				color: var(--gl-agent-waiting-color);
				font-weight: 600;
			}

			.section__hover-detail {
				grid-column: 2 / -1;
				min-width: 0;
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
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
				grid-template-columns: auto 1fr;
				grid-template-rows: auto auto;
				column-gap: 0.6rem;
				row-gap: 0.4rem;
				align-items: start;
				padding: 0.6rem 0.8rem;
				border-radius: 0.4rem;
				background-color: var(--vscode-editor-background);
				border: 1px solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
				border-left: 3px solid var(--card-accent, var(--gl-agent-idle-color));
				transition:
					background 250ms ease,
					border-left-color 250ms ease;
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
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
				opacity: 1;
			}

			.card__rail {
				grid-row: 1;
				grid-column: 1;
				display: flex;
				align-items: center;
				justify-content: center;
				/* Fixed rail width so the body column lines up across cards regardless of which
				   indicator (icon-circle vs small dot) sits inside. */
				width: 2.4rem;
				min-height: 1.6em;
			}

			/* Idle cards keep a small dot — the icon-circle treatment is reserved for actionable phases. */
			.card__dot {
				width: 0.8rem;
				height: 0.8rem;
				border-radius: 50%;
				flex: none;
				aspect-ratio: 1;
				background-color: var(--card-accent);
			}

			/* Icon-circle for needs-input/working cards. Carries the banner's prior visual weight. */
			.card__icon {
				flex: none;
				color: var(--card-accent);
				font-size: 1.6em;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 2.4rem;
				border-radius: 50%;
				background-color: color-mix(in srgb, var(--card-accent) 18%, transparent);
				transition:
					color 250ms ease,
					background-color 250ms ease;
			}

			.card__body {
				grid-row: 1;
				grid-column: 2;
				min-width: 0;
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.card__title-row {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				min-width: 0;
			}

			.card__name {
				flex: 1;
				min-width: 0;
				font-weight: 600;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.card__phase {
				flex: none;
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.card__phase--needs-input {
				color: var(--gl-agent-waiting-color);
				font-weight: 600;
			}

			.card__detail {
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.card__prompt {
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				font-style: italic;
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				overflow: hidden;
				margin-top: 0.2rem;
			}

			.card__actions {
				grid-row: 2;
				grid-column: 2;
				display: flex;
				flex-direction: row;
				align-items: center;
				justify-content: flex-end;
				gap: 0.3rem;
				flex: none;
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
	 *  still available via hover on the cluster. */
	@property({ type: Boolean, reflect: true })
	compact = false;

	/** Build a stable string capturing every input the component renders against. Identical
	 *  fingerprint between two parent passes → skip the render entirely via {@link shouldUpdate}.
	 *
	 *  Fields included reflect what `renderCard`, `renderHoverRow`, `tally`, and the heading
	 *  cluster consume:
	 *  - `expand` and `selectedSessionId` — both shape the rendered tree.
	 *  - Per session: `id`, `phase`, `status`, `statusDetail` (running-tool surface), `displayName`,
	 *    `lastPrompt` (card prompt + fallback line), `phaseSince` (ms, drives elapsed labels).
	 *  - `pendingPermission` — encoded by {@link permissionFingerprint} so every needs-input
	 *    variant's renderable fields contribute, not just kind/toolName.
	 *
	 *  Adding a new rendered field requires extending this fingerprint (or
	 *  {@link permissionFingerprint}) or the component will silently fail to update when only
	 *  that field changes. */
	private computeFingerprint(): string {
		// Mix `_tickGeneration` so the periodic tick deterministically advances the fingerprint
		// even when session content is unchanged. Every user-typed string field goes through
		// `fpField` so embedded `|` (shell pipes in statusDetail, free-form descriptions) and
		// `\n` (multi-line prompts) can't collide via delimiter accidents.
		const parts: string[] = [`t${this._tickGeneration}`, `e${this.expand}`, `s${fpField(this.selectedSessionId)}`];
		const sessions = this.sessions ?? [];
		for (const s of sessions) {
			parts.push(
				`${s.id}|${s.phase}|${fpField(s.status)}|${fpField(s.statusDetail)}|${fpField(s.displayName)}|${fpField(s.lastPrompt)}|${s.phaseSince.getTime()}|${permissionFingerprint(s.pendingPermission)}`,
			);
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
		if (sessions == null || sessions.length === 0) return nothing;

		if (this.compact) {
			return this.renderClusterOnly(sessions);
		}
		return this.renderSection(sessions, this.tally(sessions));
	}

	/** Compact render: just the cluster + counts popover, no surrounding heading button or cards.
	 *  Hover still surfaces the per-session detail via the same shared popover body. */
	private renderClusterOnly(sessions: AgentSessionState[]): unknown {
		const counts = this.tally(sessions);
		const visibleDots = sessions.slice(0, maxClusterDots);
		const overflow = sessions.length - visibleDots.length;
		return html`
			<gl-popover placement="bottom" hoist>
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

	private renderSection(sessions: AgentSessionState[], counts: Record<AgentSessionCategory, number>): unknown {
		const visibleCats = expandVisibleCategories[this.expand];
		const visible = sessions.filter(s => visibleCats.has(agentPhaseToCategory[s.phase]));

		return html`
			<div class="section" data-expand=${this.expand}>
				${this.renderSectionHeading(sessions, counts)}
				${visible.length > 0
					? html`<div id="section__list" class="section__list">${visible.map(s => this.renderCard(s))}</div>`
					: nothing}
			</div>
		`;
	}

	private renderSectionHeading(sessions: AgentSessionState[], counts: Record<AgentSessionCategory, number>): unknown {
		const state = this.expand;
		const visibleDots = sessions.slice(0, maxClusterDots);
		const overflow = sessions.length - visibleDots.length;

		return html`
			<button
				type="button"
				class="section__heading"
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
				<gl-popover placement="bottom" hoist ?disabled=${state === 'expanded'}>
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
		`;
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
