import type { PropertyValueMap } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import {
	agentPhaseToCategory,
	describeAgentSession,
	formatAgentElapsed,
	getAgentCategoryLabel,
} from '../../../shared/agentUtils.js';
import { elementBase } from '../../../shared/components/styles/lit/base.css.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/button.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

type ExpandState = 'closed' | 'partial' | 'expanded';

/** Cap on cluster dots in the section heading. Beyond this, an `+N` overflow chip takes the slot
 *  so the heading width stays bounded. */
const maxClusterDots = 5;

/** Tri-state cycle for the heading collapse toggle: closed (needs-input only) → partial
 *  (needs-input + working) → expanded (all) → closed. */
const expandNext: Record<ExpandState, ExpandState> = {
	closed: 'partial',
	partial: 'expanded',
	expanded: 'closed',
};

const expandIcon: Record<ExpandState, string> = {
	closed: 'chevron-right',
	partial: 'unfold',
	expanded: 'chevron-down',
};

const expandVisibleCategories: Record<ExpandState, ReadonlySet<AgentSessionCategory>> = {
	closed: new Set<AgentSessionCategory>(['needs-input']),
	partial: new Set<AgentSessionCategory>(['needs-input', 'working']),
	expanded: new Set<AgentSessionCategory>(['needs-input', 'working', 'idle']),
};

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-agent-status': GlDetailsAgentStatus;
	}

	interface GlobalEventHandlersEventMap {
		'gl-agent-status-cards-visibility-change': CustomEvent<{ hasCards: boolean }>;
	}
}

/**
 * Branch-scoped agent status display for the graph details panel. Renders a heading
 * (chevron + label + dot cluster + counts, with a hover popover for per-session detail) above
 * a cards list. The heading button cycles a tri-state filter: closed (needs-input only),
 * partial (needs-input + working), expanded (all). Needs-input and working cards adopt a
 * gradient + icon-circle treatment so each surfaces as actionable at a glance.
 */
@customElement('gl-details-agent-status')
export class GlDetailsAgentStatus extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
				/* No local agent-phase color overrides — inherits the unified palette from
				   theme.scss (--gl-agent-working-color / --gl-agent-waiting-color /
				   --gl-agent-idle-color) so this card, the sidebar leaf, the tooltip, the
				   status pill, and the WIP file decoration all share one set of phase colors. */
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
				padding: 0.6rem var(--gl-panel-padding-right, 1rem) 0.8rem var(--gl-panel-padding-left, 1.2rem);
				background-color: var(--gl-metadata-bar-bg);
				border-bottom: 1px solid var(--gl-metadata-bar-border);
			}

			/* Heading doubles as the tri-state collapse toggle AND the at-a-glance phase summary —
			   chevron + label on the left, dot cluster + counts on the right. The dots and counts
			   remain visible in every state so the summary still informs at a glance even when
			   most cards are filtered out. */
			.section__heading {
				appearance: none;
				display: flex;
				align-items: center;
				gap: 0.6rem;
				width: 100%;
				padding: 0.2rem 0;
				background: transparent;
				border: none;
				font: inherit;
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				cursor: pointer;
				text-align: left;
				line-height: 1.2;
			}

			.section__heading-chevron {
				font-size: 1em;
				line-height: 1;
				color: var(--vscode-descriptionForeground);
				flex: none;
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

	@state() private _expand: ExpandState = 'closed';

	private _lastHasVisibleCards: boolean | undefined;

	override render(): unknown {
		const sessions = this.sessions;
		if (sessions == null || sessions.length === 0) return nothing;

		return this.renderSection(sessions, this.tally(sessions));
	}

	protected override updated(changedProperties: PropertyValueMap<unknown> | Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		const hasCards = this.computeVisibleCardCount() > 0;
		if (hasCards === this._lastHasVisibleCards) return;

		this._lastHasVisibleCards = hasCards;
		this.dispatchEvent(
			new CustomEvent('gl-agent-status-cards-visibility-change', {
				detail: { hasCards: hasCards },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private computeVisibleCardCount(): number {
		const sessions = this.sessions;
		if (sessions == null || sessions.length === 0) return 0;

		const visibleCats = expandVisibleCategories[this._expand];
		let count = 0;
		for (const s of sessions) {
			if (visibleCats.has(agentPhaseToCategory[s.phase])) {
				count++;
			}
		}
		return count;
	}

	/* ---------- Section (heading + cards list) ---------- */

	private renderSection(sessions: AgentSessionState[], counts: Record<AgentSessionCategory, number>): unknown {
		const visibleCats = expandVisibleCategories[this._expand];
		const visible = sessions.filter(s => visibleCats.has(agentPhaseToCategory[s.phase]));

		return html`
			<div class="section">
				${this.renderSectionHeading(sessions, counts)}
				${visible.length > 0
					? html`<div id="section__list" class="section__list">${visible.map(s => this.renderCard(s))}</div>`
					: nothing}
			</div>
		`;
	}

	private renderSectionHeading(sessions: AgentSessionState[], counts: Record<AgentSessionCategory, number>): unknown {
		const state = this._expand;
		const visibleDots = sessions.slice(0, maxClusterDots);
		const overflow = sessions.length - visibleDots.length;

		return html`
			<button
				type="button"
				class="section__heading"
				aria-controls="section__list"
				aria-label=${this.expandAriaLabel(state)}
				@click=${this.cycleExpand}
			>
				<code-icon class="section__heading-chevron" icon=${expandIcon[state]}></code-icon>
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

	private cycleExpand = (): void => {
		this._expand = expandNext[this._expand];
	};

	private expandAriaLabel(state: ExpandState): string {
		switch (state) {
			case 'closed':
				return 'Show working sessions';
			case 'partial':
				return 'Show all sessions';
			case 'expanded':
				return 'Collapse to needs-input only';
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
		const phaseLabel = getAgentCategoryLabel(category);
		const detail = describeAgentSession(session, category, elapsed, {
			awaitingPrefix: 'short',
			idleFallback: 'lastPrompt',
		});

		return html`
			<div class="section__hover-row">
				<span class=${`section__hover-dot section__hover-dot--${category}`}></span>
				<span class="section__hover-name" title=${session.displayName}>${session.displayName}</span>
				<span class=${`section__hover-phase section__hover-phase--${category}`}>
					${phaseLabel}${elapsed != null ? ` · ${elapsed}` : ''}
				</span>
				${detail ? html`<span class="section__hover-detail" title=${detail}>${detail}</span>` : nothing}
			</div>
		`;
	}

	private renderCard(session: AgentSessionState): unknown {
		const category = agentPhaseToCategory[session.phase];
		const elapsed = formatAgentElapsed(session.phaseSince);
		const phaseLabel = getAgentCategoryLabel(category);
		// Cards drop the "Last active" / lastPrompt fallback — elapsed surfaces in the phase
		// tooltip, and lastPrompt has its own dedicated `card__prompt` row below.
		const detailLine = describeAgentSession(session, category, elapsed, {
			awaitingPrefix: 'long',
			idleFallback: 'none',
		});
		const phaseContent = html`${phaseLabel}${elapsed != null ? html` · ${elapsed}` : nothing}`;
		const phaseTooltip = elapsed != null ? `Last active ${elapsed} ago` : undefined;
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id));
		const canResolve = category === 'needs-input' && session.isInWorkspace && session.pendingPermission != null;

		return html`
			<div class=${`card card--${category}`}>
				<div class="card__rail">${this.renderCardRail(category)}</div>
				<div class="card__body">
					<div class="card__title-row">
						<span class="card__name" title=${session.displayName}>${session.displayName}</span>
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
					${detailLine ? html`<span class="card__detail" title=${detailLine}>${detailLine}</span>` : nothing}
					${session.lastPrompt
						? html`<span class="card__prompt" title=${session.lastPrompt}>${session.lastPrompt}</span>`
						: nothing}
				</div>
				${canResolve ? html`<div class="card__actions">${this.renderCardActions(session)}</div>` : nothing}
			</div>
		`;
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
		const showAlwaysAllow = permission.suggestions != null && permission.suggestions.length > 0;
		const alwaysAllowHref = showAlwaysAllow
			? createCommandLink('gitlens.agents.resolvePermission', {
					sessionId: session.id,
					decision: 'allow' as const,
					alwaysAllow: true,
				})
			: undefined;

		return html`
			<gl-button density="compact" href=${allowHref}>
				<code-icon icon="check" slot="prefix"></code-icon>
				Allow
			</gl-button>
			${showAlwaysAllow && alwaysAllowHref != null
				? html`<gl-button appearance="secondary" density="compact" href=${alwaysAllowHref}>
						<code-icon icon="check-all" slot="prefix"></code-icon>
						Always Allow
					</gl-button>`
				: nothing}
			<gl-button appearance="secondary" density="compact" href=${denyHref}>
				<code-icon icon="x" slot="prefix"></code-icon>
				Deny
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
