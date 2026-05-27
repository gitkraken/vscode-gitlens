import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import type { AgentSessionCategory, StickyDetailResolver } from '../../agentUtils.js';
import {
	agentPhaseToCategory,
	createStickyDetailResolver,
	describeAgentSession,
	formatAgentElapsed,
	getAgentCategoryLabel,
	getAgentPhaseLabel,
} from '../../agentUtils.js';
import { renderRunningTool } from '../agents/agent-status-render.js';
import { agentPhaseElapsedStyles, agentToolStyles } from '../agents/agent-status-styles.css.js';
import { elementBase, linkBase } from '../styles/lit/base.css.js';
import '../actions/action-item.js';
import '../actions/action-nav.js';
import '../agents/gl-agent-prompt-detail.js';
import '../button.js';
import '../code-icon.js';
import '../overlays/popover.js';
import '../overlays/tooltip.js';

interface AgentPillSummary {
	category: AgentSessionCategory;
	sessions: readonly AgentSessionState[];
}

function formatElapsed(value: Date | number | undefined): string | undefined {
	if (value == null) return undefined;

	const timestamp = typeof value === 'number' ? value : value.getTime();
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-agent-status-pill': GlAgentStatusPill;
	}
}

@customElement('gl-agent-status-pill')
export class GlAgentStatusPill extends LitElement {
	static override styles = [
		elementBase,
		linkBase,
		agentToolStyles,
		agentPhaseElapsedStyles,
		css`
			:host {
				display: inline-block;
				--max-width: 30rem;

				/* Phase colors — pulled from the unified --gl-agent-working-color /
				   --gl-agent-waiting-color / --gl-agent-idle-color palette in theme.scss so the
				   pill, card, sidebar leaf, tooltip, and WIP file decoration all share one
				   source of truth. Local *-bg / *-border derivations stay because the pill
				   applies different opacity envelopes than other surfaces. */
				--gl-agent-pill-working-color: var(--gl-agent-working-color);
				--gl-agent-pill-working-bg: color-mix(in srgb, var(--gl-agent-pill-working-color) 10%, transparent);
				--gl-agent-pill-working-border: color-mix(in srgb, var(--gl-agent-pill-working-color) 50%, transparent);

				/* Needs Input border is brighter than the other categories (75% vs. 50%/35%) so the
				   static state already communicates "this one's different" before the breathing
				   animation kicks in. */
				--gl-agent-pill-attention-color: var(--gl-agent-waiting-color);
				--gl-agent-pill-attention-bg: color-mix(in srgb, var(--gl-agent-pill-attention-color) 10%, transparent);
				--gl-agent-pill-attention-bg-peak: color-mix(
					in srgb,
					var(--gl-agent-pill-attention-color) 22%,
					transparent
				);
				--gl-agent-pill-attention-border: color-mix(
					in srgb,
					var(--gl-agent-pill-attention-color) 75%,
					transparent
				);

				/* Idle (muted) */
				--gl-agent-pill-idle-color: var(--gl-agent-idle-color);
				--gl-agent-pill-idle-bg: color-mix(in srgb, var(--gl-agent-pill-idle-color) 10%, transparent);
				--gl-agent-pill-idle-border: color-mix(in srgb, var(--gl-agent-pill-idle-color) 35%, transparent);
			}

			/* Pill badge */
			.pill {
				/* border-box so the 1px border counts inside the 100% width — without it the pill
				   bleeds 2px past its container in full mode. */
				box-sizing: border-box;
				display: inline-flex;
				align-items: center;
				padding: 0.1rem 0.6rem;
				border-radius: 0.4rem;
				border: 1px solid transparent;
				font-size: 0.85em;
				font-weight: 500;
				line-height: normal;
				white-space: nowrap;
				cursor: default;
				transition:
					background-color 250ms ease,
					border-color 250ms ease,
					color 250ms ease;
			}

			.pill__label {
				display: inline-flex;
				align-items: center;
				gap: 0.4rem;
				min-width: 0;
			}

			.pill__dot {
				width: 5px;
				height: 5px;
				border-radius: 50%;
				flex: none;
				transition: background-color 250ms ease;
			}

			/* Full mode — pill grows to fill its container and surfaces inline actions on the
			   right of the label. The popover anchor still wraps the whole pill so hover/focus
			   keeps surfacing the rich detail (without duplicating the action row).
			   full-active is a host-managed attribute, distinct from the public full prop, so the
			   needs-input + !canResolve fallback can still render compact even when the consumer
			   requested full. */
			:host([full-active]) {
				display: block;
				width: 100%;
			}

			:host([full-active]) gl-popover {
				display: block;
				--gl-popover-anchor-width: 100%;
			}

			:host([full-active]) .pill {
				display: flex;
				width: 100%;
				justify-content: space-between;
				padding: 0.3rem 0.6rem;
			}

			.pill__actions {
				flex: none;
				/* Tighten the inline action row so it sits flush with the pill's right padding
				   instead of stretching the pill height. action-nav is a flex container itself —
				   we just nudge gap and offset here. */
				gap: 0.1rem;
				margin-inline-end: -0.3rem;
			}

			.pill__actions action-item {
				width: 1.8rem;
				height: 1.8rem;
				border-radius: 0.4rem;
				color: inherit;
			}

			/* Background-only animation (no box-shadow) so it doesn't get clipped by ancestors
			   with overflow: hidden. */
			.pill--working .pill__dot {
				animation: gl-agent-pill-pulse 1.5s ease 0s infinite;
			}

			@keyframes gl-agent-pill-pulse {
				0% {
					box-shadow: 0 0 0 0 var(--pill-pulse-color, transparent);
				}
				70% {
					box-shadow: 0 0 0 5px transparent;
				}
				100% {
					box-shadow: 0 0 0 0 transparent;
				}
			}

			.pill--needs-input {
				animation: gl-agent-pill-breathing 3.5s ease-in-out 0s infinite;
			}

			@keyframes gl-agent-pill-breathing {
				0%,
				100% {
					background-color: var(--gl-agent-pill-attention-bg);
				}
				50% {
					background-color: var(--gl-agent-pill-attention-bg-peak);
				}
			}

			/* Working */
			.pill--working {
				background-color: var(--gl-agent-pill-working-bg);
				border-color: var(--gl-agent-pill-working-border);
				color: var(--gl-agent-pill-working-color);
			}
			.pill--working .pill__dot {
				background-color: var(--gl-agent-pill-working-color);
				--pill-pulse-color: color-mix(in srgb, var(--gl-agent-pill-working-color) 50%, transparent);
			}

			/* Needs Input */
			.pill--needs-input {
				background-color: var(--gl-agent-pill-attention-bg);
				border-color: var(--gl-agent-pill-attention-border);
				color: var(--gl-agent-pill-attention-color);
			}
			.pill--needs-input .pill__dot {
				background-color: var(--gl-agent-pill-attention-color);
			}

			/* Idle */
			.pill--idle {
				background-color: var(--gl-agent-pill-idle-bg);
				border-color: var(--gl-agent-pill-idle-border);
				color: var(--gl-agent-pill-idle-color);
			}
			.pill--idle .pill__dot {
				background-color: var(--gl-agent-pill-idle-color);
			}

			@media (prefers-reduced-motion: reduce) {
				.pill,
				.pill__dot {
					transition: none;
				}

				.pill--working .pill__dot,
				.pill--needs-input {
					animation: none;
				}
			}

			/* Popover content */
			.hover-card {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
				white-space: normal;
				min-width: 16rem;
			}

			.hover-header {
				display: flex;
				align-items: center;
				gap: 0.5rem;
			}

			.hover-header__dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex: none;
			}

			.hover-header__dot--working {
				background-color: var(--gl-agent-pill-working-color);
			}
			.hover-header__dot--needs-input {
				background-color: var(--gl-agent-pill-attention-color);
			}
			.hover-header__dot--idle {
				background-color: var(--gl-agent-pill-idle-color);
			}

			.hover-header__text {
				flex: 1;
				min-width: 0;
				font-weight: 500;
			}

			.hover-header__elapsed {
				flex: none;
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
			}

			.hover-section {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.hover-section__label {
				text-transform: uppercase;
				font-size: 0.8em;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
			}

			.hover-section__value {
			}

			.hover-prompt {
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				word-break: break-word;
				display: -webkit-box;
				-webkit-line-clamp: 3;
				-webkit-box-orient: vertical;
				overflow: hidden;
			}

			.hover-actions {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
				margin-top: 0.2rem;
			}

			.hover-actions__row {
				display: flex;
				flex-direction: row;
				gap: 0.4rem;
			}

			.hover-actions__row > gl-button {
				/* min-width: max-content keeps Allow / Deny from shrinking below their icon+label
				   content when the popover is anchored in a narrow sidebar — the popover body
				   grows horizontally to fit instead. flex: 1 1 0 keeps the row evenly distributed
				   when there's slack. */
				flex: 1 1 0;
				min-width: max-content;
			}

			.hover-actions__row > gl-popover {
				flex: 0 0 auto;
			}

			/* "…" overflow menu — anchored off the third action button. */
			.more-menu {
				display: flex;
				flex-direction: column;
				min-width: 14rem;
				padding: 0.2rem;
			}

			.more-menu__item {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				padding: 0.4rem 0.6rem;
				border-radius: 0.3rem;
				color: var(--vscode-foreground);
				text-decoration: none;
				cursor: pointer;
				font-size: 0.95em;
			}

			.more-menu__item:hover {
				background-color: var(--vscode-list-hoverBackground);
				color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
				text-decoration: none;
			}

			.more-menu__item code-icon {
				color: var(--vscode-descriptionForeground);
				flex: none;
			}

			.hover-summary {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
				min-width: 24rem;
				max-width: min(44rem, 60vw);
				max-height: 28rem;
				overflow-y: auto;
			}

			.hover-summary-row {
				display: grid;
				/* minmax(0, 1fr) lets the name column shrink below its min-content size, enabling
				   ellipsis on long session names. Right column auto-sizes to the phase label. */
				grid-template-columns: auto minmax(0, 1fr) auto;
				column-gap: 0.6rem;
				row-gap: 0.1rem;
				align-items: center;
			}

			.hover-summary-row + .hover-summary-row {
				padding-top: 0.6rem;
				border-top: 1px solid
					var(--vscode-widget-border, color-mix(in srgb, var(--vscode-foreground) 15%, transparent));
			}

			.hover-summary-row__dot {
				width: 0.7rem;
				height: 0.7rem;
				border-radius: 50%;
				flex: none;
			}
			.hover-summary-row__dot--working {
				background-color: var(--gl-agent-pill-working-color);
			}
			.hover-summary-row__dot--needs-input {
				background-color: var(--gl-agent-pill-attention-color);
			}
			.hover-summary-row__dot--idle {
				background-color: var(--gl-agent-pill-idle-color);
			}

			.hover-summary-row__name {
				min-width: 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
			}

			.hover-summary-row__phase {
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				white-space: nowrap;
			}

			.hover-summary-row__phase--needs-input {
				color: var(--gl-agent-pill-attention-color);
				font-weight: 600;
			}

			.hover-summary-row__detail {
				grid-column: 2 / -1;
				min-width: 0;
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			/* Summary-row tool detail places the shared .agent-tool composite into the row's
			   second grid cell — visual styling lives in the shared agentToolStyles. */
			.hover-summary-row__tool {
				grid-column: 2 / -1;
			}
		`,
	];

	@property({ type: Object })
	session?: AgentSessionState;

	/** Aggregated rendering: one pill standing in for multiple sessions sharing a category. The
	 *  pill renders the category label with a count suffix (e.g. "Working · 3"), and the hover
	 *  popover lists the underlying sessions. Set this OR `session`, not both — `summary` wins
	 *  when both are provided. */
	@property({ attribute: false })
	summary?: AgentPillSummary;

	/** When set, the pill renders full-width with the category-aware action row inline on the
	 *  right of the label. The hover popover still surfaces the rich detail (header, last prompt,
	 *  tool context) but drops the action row to avoid duplicating the inline buttons.
	 *
	 *  Falls back to compact rendering when `needs-input` cannot resolve inline (`!isInWorkspace`
	 *  or no `pendingPermission`) — a full-width pill with no actions would be a dead-end.
	 *
	 *  Ignored in summary mode — summary pills never surface inline actions. */
	@property({ type: Boolean, reflect: true })
	full = false;

	/** Per-pill sticky "current tool call" resolver — see {@link createStickyDetailResolver}. The
	 *  pill renders the running-tool composite in two places (summary-mode rows and the single-
	 *  session hover-content "Current Tool" section); without stickiness both surfaces flicker
	 *  between tool calls when `session.status` momentarily leaves `'tool_use'`. Single-session
	 *  mode auto-evicts on phase change via the resolver itself; summary mode prunes orphan
	 *  entries in `updated()` so the cache stays bounded by the current sessions list. */
	private readonly _stickyResolver: StickyDetailResolver = createStickyDetailResolver();

	private onActionMouseDown(e: MouseEvent): void {
		// Stop mousedown from reaching the popover, which would hide it
		// before the click event fires on the <a> tag
		e.stopPropagation();
	}

	override willUpdate(_changed: PropertyValues<this>): void {
		// Reflect the consumer-requested mode via a private `full-active` attribute so the
		// `:host([full-active])` style block only applies when a session is actually mounted
		// (avoids a layout flash before `.session` arrives). Setting the attribute pre-render
		// keeps the styles in sync on the first paint without a one-frame `updated()` lag.
		// Summary mode never goes full — it has no per-session inline actions to surface.
		this.toggleAttribute('full-active', this.full && this.summary == null && this.session != null);
	}

	override updated(_changed: PropertyValues<this>): void {
		// Keep `_stickyResolver` bounded by the sessions the pill currently renders. Without this,
		// a parent that re-binds the pill from one session to another (or swaps the summary list)
		// would leave the prior session's cache entry behind for the resolver's lifetime. Single-
		// session mode prunes to `[this.session.id]`; summary mode prunes to its array; otherwise
		// no sessions are bound and the cache is emptied.
		if (this._stickyResolver.size === 0) return;

		if (this.summary != null) {
			this._stickyResolver.prune(this.summary.sessions.map(s => s.id));
		} else if (this.session != null) {
			this._stickyResolver.prune([this.session.id]);
		} else {
			this._stickyResolver.prune([]);
		}
	}

	override render(): unknown {
		if (this.summary != null) return this.renderSummary();

		const session = this.session;
		if (session == null) return nothing;

		const category = agentPhaseToCategory[session.phase];
		const permission = session.pendingPermission;
		const label = getAgentPhaseLabel(category, permission);
		const canResolve = category === 'needs-input' && permission != null;

		return html`
			<gl-popover placement="bottom" hoist>
				<span slot="anchor" class=${`pill ${category ? `pill--${category}` : ''}`.trim()} tabindex="0">
					<span class="pill__label">
						<span class="pill__dot"></span>
						${label}
					</span>
					${this.full ? this.renderInlineActions(session, category, canResolve) : nothing}
				</span>
				<div slot="content" class="hover-card" tabindex="-1">
					${this.renderHoverContent(session, category, this.full)}
				</div>
			</gl-popover>
		`;
	}

	private renderSummary(): unknown {
		const { category, sessions } = this.summary!;
		const baseLabel = getAgentCategoryLabel(category);
		const count = sessions.length;
		const label = count > 1 ? `${baseLabel} · ${count}` : baseLabel;

		return html`
			<gl-popover placement="bottom" hoist>
				<span slot="anchor" class=${`pill pill--${category}`} tabindex="0">
					<span class="pill__label">
						<span class="pill__dot"></span>
						${label}
					</span>
				</span>
				<div slot="content" class="hover-card" tabindex="-1">
					<div class="hover-summary">${sessions.map(s => this.renderSummaryRow(s, category))}</div>
				</div>
			</gl-popover>
		`;
	}

	/** Phase column is retained per row because the elapsed-time suffix is the per-session
	 *  signal — every row shares the category, but each carries its own "how long". */
	private renderSummaryRow(session: AgentSessionState, category: AgentSessionCategory): unknown {
		const elapsed = formatAgentElapsed(session.phaseSince);
		const phaseLabel = getAgentPhaseLabel(category, session.pendingPermission);
		// Route the running-tool surface through the sticky resolver so brief gaps between tool
		// calls (when `session.status` leaves `tool_use` and `statusDetail` empties) don't flicker
		// the row's `[tools] X(...)` block back to the generic detail line.
		const stickyTool = this._stickyResolver.resolveLiveTool(session);
		const detail =
			stickyTool != null
				? undefined
				: describeAgentSession(session, category, elapsed, {
						awaitingPrefix: 'short',
						idleFallback: 'lastPrompt',
					});

		return html`
			<div class="hover-summary-row">
				<span class=${`hover-summary-row__dot hover-summary-row__dot--${category}`}></span>
				<gl-tooltip content=${session.displayName} placement="bottom">
					<span class="hover-summary-row__name">${session.displayName}</span>
				</gl-tooltip>
				<span class=${`hover-summary-row__phase hover-summary-row__phase--${category}`}>
					${phaseLabel}${elapsed != null ? html` · <span class="agent-phase-elapsed">${elapsed}</span>` : ''}
				</span>
				${this.renderSummaryRowDetail(stickyTool, detail)}
			</div>
		`;
	}

	private renderSummaryRowDetail(stickyTool: string | undefined, detail: string | undefined): unknown {
		if (stickyTool != null) {
			return html`<span class="hover-summary-row__tool">${renderRunningTool(stickyTool)}</span>`;
		}
		if (detail) {
			return html`<gl-tooltip content=${detail} placement="bottom">
				<span class="hover-summary-row__detail">${detail}</span>
			</gl-tooltip>`;
		}
		return nothing;
	}

	private renderHoverContent(
		session: AgentSessionState,
		category: AgentSessionCategory,
		omitActions: boolean,
	): unknown {
		// Evict any sticky-tool entry for this session when the category is non-working —
		// `renderNeedsInputHover` and `renderIdleHover` bypass `resolveLiveTool` (only the working
		// hover path calls it), so without explicit eviction the entry survives a permission
		// round-trip and the next working+empty-statusDetail push would re-paint the pre-needs-
		// input tool name from the still-fresh cache. Matches the eviction-on-needs-input pattern
		// in gl-graph-kanban + gl-details-agent-status.
		if (category !== 'working') {
			this._stickyResolver.evict(session.id);
		}

		switch (category) {
			case 'working':
				return this.renderWorkingHover(session, omitActions);
			case 'needs-input':
				return this.renderNeedsInputHover(session, omitActions);
			case 'idle':
				return this.renderIdleHover(session, omitActions);
		}
	}

	/** Inline action surface for full mode. `needs-input` + canResolve renders the Allow / Deny / More
	 *  trio. Everything else — working, idle, and the `needs-input` + !canResolve case where the
	 *  permission can't be resolved inline — gets a single Open Session affordance so the pill is
	 *  never a full-width dead end. */
	private renderInlineActions(
		session: AgentSessionState,
		category: AgentSessionCategory,
		canResolve: boolean,
	): unknown {
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id));

		if (category === 'needs-input' && canResolve) {
			const permission = session.pendingPermission!;
			const allowHref = createCommandLink('gitlens.agents.resolvePermission', {
				sessionId: session.id,
				decision: 'allow' as const,
			});
			const denyHref = createCommandLink('gitlens.agents.resolvePermission', {
				sessionId: session.id,
				decision: 'deny' as const,
			});
			const alwaysAllowHref =
				permission.kind === 'tool' && permission.suggestions != null && permission.suggestions.length > 0
					? createCommandLink('gitlens.agents.resolvePermission', {
							sessionId: session.id,
							decision: 'allow' as const,
							alwaysAllow: true,
						})
					: undefined;
			const allowLabel = permission.kind === 'plan' ? 'Approve Plan' : 'Allow';
			const denyLabel = permission.kind === 'plan' ? 'Reject Plan' : 'Deny';

			return html`
				<action-nav class="pill__actions" @mousedown=${this.onActionMouseDown}>
					<action-item label=${allowLabel} icon="check" href=${allowHref}></action-item>
					<action-item label=${denyLabel} icon="x" href=${denyHref}></action-item>
					${this.renderMoreActionsMenu(openHref, alwaysAllowHref)}
				</action-nav>
			`;
		}

		return html`
			<action-nav class="pill__actions" @mousedown=${this.onActionMouseDown}>
				<action-item label="Open Session" icon="link-external" href=${openHref}></action-item>
			</action-nav>
		`;
	}

	private renderWorkingHover(session: AgentSessionState, omitActions: boolean): unknown {
		const elapsed = formatElapsed(session.phaseSince);
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id));
		// Route through the sticky resolver so the "Current Tool" section doesn't blink between
		// tool calls — matches the kanban + details-panel running-tool surfaces. `resolveLiveTool`
		// returns the live `statusDetail` when present and the cached one for ~3s after it drops
		// away; on phase change (working → idle/needs-input) the cache auto-evicts so the section
		// vanishes immediately.
		const stickyTool = this._stickyResolver.resolveLiveTool(session);

		return html`
			<div class="hover-header">
				<span class="hover-header__dot hover-header__dot--working"></span>
				<span class="hover-header__text">${session.displayName}</span>
				${elapsed != null ? html`<span class="hover-header__elapsed">${elapsed}</span>` : nothing}
			</div>
			${session.lastPrompt
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Last Prompt</span>
							<span class="hover-prompt">${session.lastPrompt}</span>
						</div>
					`
				: nothing}
			${stickyTool != null
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Current Tool</span>
							<span class="hover-section__value">${stickyTool}</span>
						</div>
					`
				: nothing}
			${omitActions
				? nothing
				: html`
						<div class="hover-actions" @mousedown=${this.onActionMouseDown}>
							<gl-button appearance="secondary" full density="compact" href=${openHref}>
								<code-icon icon="link-external" slot="prefix"></code-icon>
								Open Session
							</gl-button>
						</div>
					`}
		`;
	}

	private renderNeedsInputHover(session: AgentSessionState, omitActions: boolean): unknown {
		const elapsed = formatElapsed(session.phaseSince);
		const permission = session.pendingPermission;
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id));

		const canResolve = permission != null;
		const allowHref = canResolve
			? createCommandLink('gitlens.agents.resolvePermission', {
					sessionId: session.id,
					decision: 'allow' as const,
				})
			: undefined;
		const alwaysAllowHref =
			canResolve &&
			permission.kind === 'tool' &&
			permission.suggestions != null &&
			permission.suggestions.length > 0
				? createCommandLink('gitlens.agents.resolvePermission', {
						sessionId: session.id,
						decision: 'allow' as const,
						alwaysAllow: true,
					})
				: undefined;
		const denyHref = canResolve
			? createCommandLink('gitlens.agents.resolvePermission', {
					sessionId: session.id,
					decision: 'deny' as const,
				})
			: undefined;
		const allowLabel = canResolve && permission.kind === 'plan' ? 'Approve Plan' : 'Allow';
		const denyLabel = canResolve && permission.kind === 'plan' ? 'Reject Plan' : 'Deny';

		return html`
			<div class="hover-header">
				<span class="hover-header__dot hover-header__dot--needs-input"></span>
				<span class="hover-header__text">${session.displayName}</span>
				${elapsed != null ? html`<span class="hover-header__elapsed">${elapsed}</span>` : nothing}
			</div>
			${permission != null
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Request</span>
							<gl-agent-prompt-detail .permission=${permission}></gl-agent-prompt-detail>
						</div>
					`
				: nothing}
			${session.lastPrompt
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Last Prompt</span>
							<span class="hover-prompt">${session.lastPrompt}</span>
						</div>
					`
				: nothing}
			${omitActions
				? nothing
				: canResolve
					? html`
							<div class="hover-actions" @mousedown=${this.onActionMouseDown}>
								<div class="hover-actions__row">
									<gl-button full density="compact" href=${allowHref!}>
										<code-icon icon="check" slot="prefix"></code-icon>
										${allowLabel}
									</gl-button>
									<gl-button
										appearance="secondary"
										full
										density="compact"
										variant="danger"
										href=${denyHref!}
									>
										<code-icon icon="x" slot="prefix"></code-icon>
										${denyLabel}
									</gl-button>
									${this.renderMoreActionsMenu(openHref, alwaysAllowHref)}
								</div>
							</div>
						`
					: html`
							<div class="hover-actions" @mousedown=${this.onActionMouseDown}>
								<gl-button appearance="secondary" full density="compact" href=${openHref}>
									<code-icon icon="link-external" slot="prefix"></code-icon>
									Open Session
								</gl-button>
							</div>
						`}
		`;
	}

	/** Overflow menu anchored off the "…" action in the needs-input row. Always Allow only renders
	 *  when the agent supports it; Open Session is always available. The inner popover uses a click
	 *  trigger — the parent hover popover stays open while focus is on this anchor. */
	private renderMoreActionsMenu(openHref: string, alwaysAllowHref: string | undefined): unknown {
		return html`
			<gl-popover placement="bottom-end" trigger="click" hoist>
				<action-item slot="anchor" label="More actions" icon="ellipsis"></action-item>
				<div slot="content" class="more-menu" role="menu" @mousedown=${this.onActionMouseDown}>
					${alwaysAllowHref != null
						? html`<a class="more-menu__item" role="menuitem" href=${alwaysAllowHref}>
								<code-icon icon="check-all"></code-icon>
								<span>Always Allow</span>
							</a>`
						: nothing}
					<a class="more-menu__item" role="menuitem" href=${openHref}>
						<code-icon icon="link-external"></code-icon>
						<span>Open Session</span>
					</a>
				</div>
			</gl-popover>
		`;
	}

	private renderIdleHover(session: AgentSessionState, omitActions: boolean): unknown {
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id));

		return html`
			<div class="hover-header">
				<span class="hover-header__dot hover-header__dot--idle"></span>
				<span class="hover-header__text">${session.displayName}</span>
			</div>
			${session.lastPrompt
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Last Prompt</span>
							<span class="hover-prompt">${session.lastPrompt}</span>
						</div>
					`
				: nothing}
			${omitActions
				? nothing
				: html`
						<div class="hover-actions" @mousedown=${this.onActionMouseDown}>
							<gl-button appearance="secondary" full density="compact" href=${openHref}>
								<code-icon icon="link-external" slot="prefix"></code-icon>
								Open Session
							</gl-button>
						</div>
					`}
		`;
	}
}
