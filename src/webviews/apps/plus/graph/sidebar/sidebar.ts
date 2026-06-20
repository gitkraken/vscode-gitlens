import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GraphDisplayMode, GraphSidebarPanel } from '../../../../plus/graph/protocol.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphStateContext } from '../context.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

interface Icon {
	type: IconTypes;
	icon: string;
	tooltip: string;
}
type IconTypes = 'agents' | 'branches' | 'overview' | 'remotes' | 'stashes' | 'tags' | 'worktrees';
const icons: Icon[] = [
	{ type: 'overview', icon: 'home', tooltip: 'Overview' },
	{ type: 'agents', icon: 'robot', tooltip: 'Agents' },
	{ type: 'worktrees', icon: 'gl-worktrees-view', tooltip: 'Worktrees' },
	{ type: 'branches', icon: 'gl-branches-view', tooltip: 'Branches' },
	{ type: 'remotes', icon: 'gl-remotes-view', tooltip: 'Remotes' },
	{ type: 'stashes', icon: 'gl-stashes-view', tooltip: 'Stashes' },
	{ type: 'tags', icon: 'gl-tags-view', tooltip: 'Tags' },
];

// Bottom-rail display-mode toggles — each button stays on the same icon; the checked state on
// `<gl-button>` (driven by `aria-checked`) telegraphs "this mode is active" without the icon
// flipping. Tooltip flips per state so screen-reader users get the action verb.
interface DisplayModeToggle {
	mode: Exclude<GraphDisplayMode, 'graph'>;
	icon: string;
	activeTooltip: string;
	inactiveTooltip: string;
	/** When set, the toggle only renders if the named feature flag on `_state.config` is truthy.
	 *  Lets us gate experimental modes (kanban) behind a config setting without changing the
	 *  shape of the bottom-rail render path. */
	requiresConfigFlag?: 'experimentalKanbanEnabled';
}

const displayModeToggles: readonly DisplayModeToggle[] = [
	{
		mode: 'kanban',
		icon: 'gl-kanban-view',
		activeTooltip: 'Show Commit Graph',
		inactiveTooltip: 'Show Agent Kanban',
		requiresConfigFlag: 'experimentalKanbanEnabled',
	},
];

const visualizationsToggle: DisplayModeToggle = {
	mode: 'visualizations',
	icon: 'pulse',
	activeTooltip: 'Show Commit Graph',
	inactiveTooltip: 'Show Visualizations',
};

export interface GraphSidebarToggleEventDetail {
	panel: GraphSidebarPanel;
}

export interface GraphSidebarDisplayModeChangeEventDetail {
	mode: GraphDisplayMode;
}

@customElement('gl-graph-sidebar')
export class GlGraphSideBar extends SignalWatcher(LitElement) {
	static override styles = css`
		:focus,
		:focus-within,
		:focus-visible {
			outline-color: var(--vscode-focusBorder);
		}

		.sidebar {
			position: relative;

			/* Workspace-level pinned chrome — must stay below the feature gate's cover tier so the
		   rail can't paint over (or take clicks through) the Pro gate's scrim */
			z-index: var(--gl-z-sticky);
			box-sizing: border-box;
			display: flex;
			flex-direction: column;
			gap: 1.4rem;
			align-items: center;
			width: 2.6rem;
			height: 100%;
			padding: 0.5rem 0;
			font-size: 9px;
			font-weight: 600;
			color: var(--color-view-foreground--65);
			background-color: var(--color-view-background);
			border-color: var(--vscode-sideBar-border, transparent);
			border-right: var(--gl-border-width) solid transparent;
		}

		gl-tooltip {
			width: 100%;
		}

		/* Doubles the gap after the last group-1 icon (Agents) so the rail reads as two
   groups: Overview/Agents, then the view icons. 1.4rem here + the parent's 1.4rem
   flex gap = 2.8rem. (Applied on .item, not gl-tooltip, since gl-tooltip's host is
   display: contents and can't take margin.) */
		.item.group-end {
			margin-bottom: 1.4rem;
		}

		.item {
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			width: 100%;
			padding: 0;
			font: inherit;
			color: var(--color-view-foreground--65);
			text-decoration: none;
			cursor: pointer;
			background: none;
			border: none;
		}

		.item:hover {
			color: var(--color-view-foreground);
			text-decoration: none;
		}

		.item.active {
			color: var(--color-view-foreground);
		}

		.item.overview {
			padding: var(--gl-space-6) 0;
		}

		.indicator {
			position: absolute;
			top: 0;
			left: 0;
			width: 1px;
			height: var(--indicator-height, 0);
			pointer-events: none;
			background-color: var(--color-view-foreground);
			border-radius: 1px;
			transform: translateY(var(--indicator-top, 0));
			transition:
				transform var(--gl-duration-slow) var(--gl-ease-in-out),
				height var(--gl-duration-fast) var(--gl-ease-in-out);
		}

		.indicator.no-transition {
			transition: none;
		}

		@media (prefers-reduced-motion: reduce) {
			.indicator {
				transition: none;
			}
		}

		.count {
			margin-top: var(--gl-space-4);
			color: var(--color-view-foreground--50);
		}

		.count.error {
			color: var(--vscode-errorForeground);
			opacity: 0.6;
		}

		.spacer {
			flex: 1 1 auto;
		}

		.item.dimmed {
			opacity: 0.4;
		}

		/* Visualization toggle — uses <gl-button> for the checked/unchecked styling. Sits at the
   bottom of the rail; the parent's 1.4rem flex gap is enough to read it as its own group. */
		.display-mode-toggle {
			margin: 0 auto;
			--button-foreground: var(--color-view-foreground--65);
		}

		.display-mode-toggle:hover {
			--button-foreground: var(--color-view-foreground);
		}

		/* Tighten the spacing between consecutive display-mode toggles so they read as one
   bottom-rail group (e.g., kanban + visualizations) rather than two unrelated buttons.
   Parent .sidebar has flex gap 1.4rem; -1rem margin-top brings the effective gap to 0.4rem.
   The first toggle keeps the parent's 1.4rem separation from the spacer above. */
		.display-mode-toggle + .display-mode-toggle {
			margin-top: -1rem;
		}

		/* Keyboard-shortcuts action — shares the rail affordance with the display-mode toggles but
   opens a dialog rather than switching modes, so it carries no checked/active state. It lives in
   the always-visible bottom group (not a foldable icon), so compaction reserves space for it via
   the measured bottom block and folds nav icons into the … menu instead. */
		.rail-action {
			margin: 0 auto;
			--button-foreground: var(--color-view-foreground--65);
		}

		.rail-action:hover {
			--button-foreground: var(--color-view-foreground);
		}

		/* Sit the action tight against the display-mode toggles above it (same -1rem pull the
   toggles use between themselves) so the bottom of the rail reads as one group. */
		.display-mode-toggle + .rail-action {
			margin-top: -1rem;
		}

		/* Pre-interaction discovery callout: paints the toggle with the primary VS Code button
   colors so it reads as a "click me" affordance. Once the user clicks it, the host
   dismisses the onboarding key and the class drops, reverting to the toolbar appearance.
   Overrides the gl-button shadow-DOM custom properties — outer-tree author rules outrank
   inner-tree author rules for inherited properties on the host. */
		gl-button.display-mode-toggle.callout {
			--button-background: var(--vscode-button-background);
			--button-foreground: var(--vscode-button-foreground);
			--button-hover-background: var(--vscode-button-hoverBackground);
			--button-border: var(--vscode-button-background);
		}

		/* Responsive compaction (driven by recompute): hide counts and tighten spacing together. Scoped
   to rail items so the counts shown inside the … overflow menu (.overflow-menu-item) stay visible. */
		:host([compact]) .item .count {
			display: none;
		}

		:host([compact]) .sidebar {
			gap: var(--gl-space-8);
		}

		:host([compact]) .item.group-end {
			margin-bottom: var(--gl-space-6);
		}

		:host([compact]) .item.overview {
			padding: 0.3rem 0;
		}

		/* … overflow popover (last compaction step): trailing icons fold into a menu. */
		.overflow-popover {
			--gl-popover-anchor-width: 100%;
		}

		.overflow-menu {
			display: flex;
			flex-direction: column;
			min-width: 14rem;
			font-size: var(--vscode-font-size);
			font-weight: normal;
		}

		.overflow-menu-item {
			display: flex;
			flex-direction: row;
			gap: var(--gl-space-8);
			align-items: center;
			padding: var(--gl-space-4) var(--gl-space-8);
			font: inherit;
			color: var(--vscode-foreground);
			text-align: start;
			white-space: nowrap;
			cursor: pointer;
			background: none;
			border: none;
			border-radius: var(--gl-radius-sm);
		}

		.overflow-menu-item:hover,
		.overflow-menu-item:focus-visible {
			outline: none;
			background: var(--vscode-list-hoverBackground);
		}

		.overflow-menu-item[disabled] {
			cursor: default;
			opacity: 0.5;
		}

		.overflow-menu-item-label {
			flex: 1 1 auto;
		}

		.overflow-menu-item .count {
			margin: 0;
			color: var(--color-view-foreground--50);
		}
	`;

	get include(): undefined | IconTypes[] {
		const repo = this._state.repositories?.find(item => item.id === this._state.selectedRepository);
		const base: readonly IconTypes[] = repo?.virtual
			? (['overview', 'agents', 'branches', 'remotes', 'tags'] as const)
			: (['overview', 'agents', 'branches', 'remotes', 'tags', 'stashes', 'worktrees'] as const);

		return [...base];
	}

	/** The icons actually rendered, in rail order, after applying `include`. */
	private get visibleIcons(): Icon[] {
		const include = this.include;
		return include == null ? icons : icons.filter(i => include.includes(i.type));
	}

	@property({ type: String, attribute: 'active-panel' })
	activePanel: GraphSidebarPanel | undefined;

	@property({ type: Boolean, attribute: 'sidebar-visible' })
	sidebarVisible = false;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _actions!: SidebarActions;

	@consume({ context: graphStateContext, subscribe: true })
	private readonly _state!: typeof graphStateContext.__context__;

	private _suppressTransition = true;

	@query('.sidebar') private sidebarEl?: HTMLElement;

	/** When set, icons from this index onward are folded into the … overflow popover. */
	@state() private overflowFromIndex: number | undefined;

	private readonly resizeObserver = new ResizeObserver(() => this.scheduleRecompute());
	private rafId: number | undefined;
	private recomputing = false;
	private pendingRecompute = false;
	private lastIconCount = -1;
	// Geometry of the compact layout, captured while all icons are shown and the rail overflows (so the
	// flex spacer is collapsed and the positions are intrinsic). The fold count is then a pure function
	// of the available height — the same height always yields the same fold, so a resize tracks smoothly
	// instead of probing-and-reverting (the source of the jitter / disappearing … button).
	private iconBottoms: number[] = [];
	private compactContentHeight = 0;
	private compactBottomBlock = 0;
	private toggleReserve = 0;

	override render(): unknown {
		const displayMode: GraphDisplayMode = this._state.displayMode ?? 'graph';
		const isGraphMode = displayMode === 'graph';
		const visible = this.visibleIcons;
		const overflowAt = this.overflowFromIndex;
		return html`<section class="sidebar">
			${isGraphMode && this.sidebarVisible && this.activePanel != null
				? html`<div
						class=${classMap({
							indicator: true,
							'no-transition': this._suppressTransition,
						})}
					></div>`
				: nothing}
			${repeat(
				overflowAt == null ? visible : visible.slice(0, overflowAt),
				i => i.type,
				i => this.renderIcon(i, isGraphMode),
			)}
			${overflowAt == null ? nothing : this.renderOverflow(visible.slice(overflowAt), isGraphMode)}
			<div class="spacer"></div>
			${repeat(
				displayModeToggles.filter(
					t => t.requiresConfigFlag == null || this._state.config?.[t.requiresConfigFlag],
				),
				t => t.mode,
				t => this.renderDisplayModeToggle(t, displayMode, false),
			)}
			${this.renderDisplayModeToggle(visualizationsToggle, displayMode, true)} ${this.renderShortcutsButton()}
		</section>`;
	}

	private renderShortcutsButton(): unknown {
		return html`<gl-button
			class="rail-action"
			appearance="toolbar"
			aria-label="Keyboard Shortcuts"
			tooltip="Keyboard Shortcuts"
			tooltipPlacement="right"
			@click=${this.handleShowShortcuts}
		>
			<code-icon icon="keyboard"></code-icon>
		</gl-button>`;
	}

	private handleShowShortcuts(): void {
		this.dispatchEvent(new CustomEvent('gl-graph-sidebar-show-shortcuts', { bubbles: true, composed: true }));
	}

	private renderDisplayModeToggle(toggle: DisplayModeToggle, current: GraphDisplayMode, isVisualizations: boolean) {
		const isActive = current === toggle.mode;
		const tooltip = isActive ? toggle.activeTooltip : toggle.inactiveTooltip;
		// Onboarding callout is timeline-specific — only the visualizations toggle gets the painted
		// "click me" affordance until the user has interacted with it for the first time.
		const showCallout = isVisualizations && !this._state.visualizationsButtonCalloutDismissed;
		return html`<gl-button
			class=${classMap({ 'display-mode-toggle': true, callout: showCallout })}
			appearance="toolbar"
			role="switch"
			aria-checked=${isActive ? 'true' : 'false'}
			aria-label=${tooltip}
			tooltip=${tooltip}
			tooltipPlacement="right"
			@click=${() => this.handleDisplayModeToggle(toggle)}
		>
			<code-icon icon=${toggle.icon}></code-icon>
		</gl-button>`;
	}

	private handleDisplayModeToggle(toggle: DisplayModeToggle): void {
		const current = this._state.displayMode ?? 'graph';
		// Toggling the active mode returns to the graph; otherwise switch to this toggle's mode.
		// Each bottom-rail button is independent — clicking kanban while console is active swaps
		// modes directly without going through 'graph' first.
		const next: GraphDisplayMode = current === toggle.mode ? 'graph' : toggle.mode;

		this.dispatchEvent(
			new CustomEvent<GraphSidebarDisplayModeChangeEventDetail>('gl-graph-sidebar-display-mode-change', {
				detail: { mode: next },
				bubbles: true,
				composed: true,
			}),
		);

		// Any bottom-rail toggle click is enough evidence the user has discovered the group;
		// dismiss the visualizations onboarding callout regardless of which button they hit.
		// Previously only the visualizations toggle dismissed it, so a user who clicked kanban
		// first kept seeing the "click me" affordance even after interacting with the group.
		if (!this._state.visualizationsButtonCalloutDismissed) {
			this.dispatchEvent(
				new CustomEvent('gl-graph-sidebar-visualizations-callout-dismiss', {
					bubbles: true,
					composed: true,
				}),
			);
		}

		emitTelemetrySentEvent<'graph/action/sidebar'>(this, {
			name: 'graph/action/sidebar',
			data: { action: `displayMode:${next}` },
		});
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		// Observe the host (not the inner .sidebar) so the observer survives DOM moves: connectedCallback
		// re-runs on every reconnect, whereas firstUpdated runs only once. The host's height tracks the
		// rail's available height, which is all we need to trigger a re-measure.
		this.resizeObserver.observe(this);
	}

	override disconnectedCallback(): void {
		this.resizeObserver.disconnect();
		if (this.rafId != null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = undefined;
		}
		super.disconnectedCallback?.();
	}

	override firstUpdated(changedProperties: PropertyValues): void {
		super.firstUpdated(changedProperties);
		this._updateIndicator();
		requestAnimationFrame(() => {
			this._suppressTransition = false;
		});
		this.scheduleRecompute();
		// Codicon/glicon glyph metrics can shift when the icon fonts finish loading after first
		// paint, growing the rail's content height without a resize notification — re-measure then.
		void document.fonts?.ready.then(() => this.scheduleRecompute());
	}

	override updated(changedProperties: PropertyValues): void {
		super.updated(changedProperties);

		// Re-measure when inputs that can affect height change. Skip when our own overflow output
		// is the sole change (would loop); signal-driven count updates arrive with an empty set.
		if (!(changedProperties.size === 1 && changedProperties.has('overflowFromIndex'))) {
			this.scheduleRecompute();
		}

		if (changedProperties.has('activePanel') || changedProperties.has('sidebarVisible')) {
			const prevActive = changedProperties.has('activePanel')
				? (changedProperties.get('activePanel') as GraphSidebarPanel | undefined)
				: this.activePanel;
			const prevVisible = changedProperties.has('sidebarVisible')
				? ((changedProperties.get('sidebarVisible') as boolean | undefined) ?? false)
				: this.sidebarVisible;
			const wasShowing = prevVisible && prevActive != null;
			const isShowing = this.sidebarVisible && this.activePanel != null;
			if (!wasShowing && isShowing) {
				// Indicator was just created — suppress transition for one frame
				const indicator = this.renderRoot.querySelector<HTMLElement>('.indicator');
				if (indicator != null) {
					indicator.classList.add('no-transition');
					this._updateIndicator();
					requestAnimationFrame(() => indicator.classList.remove('no-transition'));
					return;
				}
			}
		}

		this._updateIndicator();
	}

	private _updateIndicator(): void {
		const indicator = this.renderRoot.querySelector<HTMLElement>('.indicator');
		if (indicator == null) return;

		const activeButton = this.renderRoot.querySelector<HTMLElement>('.item.active');
		if (activeButton == null) return;

		const sidebar = this.renderRoot.querySelector<HTMLElement>('.sidebar');
		if (sidebar == null) return;

		const sidebarRect = sidebar.getBoundingClientRect();
		const targetRect = activeButton.getBoundingClientRect();

		indicator.style.setProperty('--indicator-top', `${targetRect.top - sidebarRect.top}px`);
		indicator.style.setProperty('--indicator-height', `${targetRect.height}px`);
	}

	private scheduleRecompute(): void {
		if (this.rafId != null) return;

		this.rafId = requestAnimationFrame(() => {
			this.rafId = undefined;
			void this.recompute();
		});
	}

	private async recompute(): Promise<void> {
		if (!this.isConnected) return;

		const el = this.sidebarEl;
		if (el == null) return;
		if (this.recomputing) {
			this.pendingRecompute = true;
			return;
		}

		this.recomputing = true;
		try {
			const count = this.visibleIcons.length;
			// Icon set changed (virtual vs. normal repo): cached heights are stale, and any current
			// fold was computed for the old set — reset to re-derive cleanly (rare; repo switch only).
			if (count !== this.lastIconCount) {
				this.lastIconCount = count;
				this.iconBottoms = [];
				this.compactContentHeight = 0;
				if (this.overflowFromIndex !== undefined) {
					this.overflowFromIndex = undefined;
					await this.updateComplete;
				}
			}
			await this.adjust(el, count);
		} finally {
			this.recomputing = false;
			if (this.pendingRecompute) {
				this.pendingRecompute = false;
				this.scheduleRecompute();
			}
		}

		// Self-heal: if we read the available height mid-layout and wrongly concluded everything fits
		// (still showing all icons while overflowing), re-run next frame. Folded states are computed
		// deterministically from cached geometry, so this can't loop once the layout settles.
		if (this.overflowFromIndex == null && el.scrollHeight > el.clientHeight + 1) {
			this.scheduleRecompute();
		}
	}

	// Brings the rail to fit its available height. The fold count is computed deterministically from
	// cached geometry rather than discovered by probing, so a given height always resolves to the same
	// state — a resize tracks smoothly with no jitter. The compact level (counts hidden + tight gaps)
	// is a host attribute → CSS only, no Lit render → toggled synchronously to measure each level
	// without ever flashing. Only the fold count drives a render, and only when it actually changes.
	private async adjust(el: HTMLElement, count: number): Promise<void> {
		const avail = el.clientHeight;

		// If currently folded, recompute the fold deterministically from cached geometry. If it no
		// longer needs to fold, unfold to all icons and fall through to re-pick the compact/full level.
		if (this.overflowFromIndex != null) {
			if (!this.hasAttribute('compact')) {
				this.setAttribute('compact', '');
			}

			const folded = this.computeFold(avail, count);
			if (folded != null) {
				if (this.overflowFromIndex !== folded) {
					this.overflowFromIndex = folded;
					await this.updateComplete;
				}
				return;
			}

			this.overflowFromIndex = undefined;
			await this.updateComplete;
		}

		// Every icon is shown — pick the level with CSS-only toggles (no render, so no flash): full if
		// it fits, else compact; if compact still overflows, capture its geometry and fold.
		this.removeAttribute('compact');
		void el.offsetHeight;
		if (el.scrollHeight <= avail + 1) return; // full layout fits

		this.setAttribute('compact', '');
		void el.offsetHeight;
		if (el.scrollHeight <= avail + 1) return; // compact fits every icon

		const items = [...this.renderRoot.querySelectorAll<HTMLElement>('button.item:not(.overflow-toggle)')];
		if (items.length >= count) {
			// Positions are intrinsic (spacer collapsed while overflowing): icon bottoms, the block below
			// the icons (… button gap + bottom toggles + padding), and the … button's own slot (≈ the
			// trailing icon pitch, same icon size + tight gap).
			this.iconBottoms = items.map(b => b.offsetTop + b.offsetHeight);
			this.compactContentHeight = el.scrollHeight;
			this.compactBottomBlock = el.scrollHeight - this.iconBottoms[count - 1];
			this.toggleReserve =
				count >= 2 ? this.iconBottoms[count - 1] - this.iconBottoms[count - 2] : items[count - 1].offsetHeight;
		}

		const target = this.computeFold(avail, count);
		if (target != null && this.overflowFromIndex !== target) {
			this.overflowFromIndex = target;
			await this.updateComplete;
		}
	}

	// Deterministic fold count for the given available height, from the cached compact geometry.
	// `undefined` = every icon fits (no overflow). Pure function of `avail` → no oscillation.
	private computeFold(avail: number, count: number): number | undefined {
		if (this.iconBottoms.length < count) return this.overflowFromIndex; // no geometry yet — hold
		if (avail >= this.compactContentHeight) return undefined; // every icon fits at compact

		// Largest K where K icons + the … button + the block below them all fit.
		let k = 0;
		for (let i = 0; i < count; i++) {
			if (this.iconBottoms[i] + this.toggleReserve + this.compactBottomBlock > avail) break;

			k = i + 1;
		}
		// Fold ≥2 (the … button replaces what it folds) and keep ≥1 icon on the rail.
		return Math.min(Math.max(k, 1), count - 2);
	}

	private renderIcon(icon: Icon, enabled: boolean) {
		const isActive = enabled && this.sidebarVisible && this.activePanel === icon.type;

		return html`<gl-tooltip placement="right" content="${icon.tooltip}">
			<button
				class=${classMap({
					item: true,
					active: isActive,
					overview: icon.type === 'overview',
					dimmed: !enabled,
					'group-end': icon.type === 'agents',
				})}
				@click=${() => this.handleIconClick(icon)}
				?disabled=${!enabled}
				aria-pressed=${isActive}
			>
				<code-icon icon="${icon.icon}"></code-icon>
				${this.renderIconCount(icon)}
			</button>
		</gl-tooltip>`;
	}

	private renderIconCount(icon: Icon) {
		if (icon.type === 'overview') return nothing;
		// Agents flow through reactive state, not the host counts IPC — read directly so the
		// badge updates without paying the round-trip and skips the loading/error states.
		if (icon.type === 'agents') return renderCount(this._state.agentSessions?.length || undefined);

		if (this._actions?.state.countsLoading.get()) {
			return html`<span class="count"><code-icon icon="loading" modifier="spin" size="9"></code-icon> </span>`;
		}
		if (this._actions?.state.countsError.get()) {
			return html`<span class="count error"><code-icon icon="warning" size="9"></code-icon></span>`;
		}
		return renderCount(this._actions?.state.counts.get()?.[icon.type]);
	}

	private renderOverflow(overflowIcons: Icon[], enabled: boolean) {
		if (overflowIcons.length === 0) return nothing;

		// Surface the active state on the … toggle when the active panel is folded away, so the
		// rail indicator (which targets `.item.active`) lands on the toggle instead of going stale.
		const containsActive = enabled && this.sidebarVisible && overflowIcons.some(i => i.type === this.activePanel);
		return html`<gl-popover
			class="overflow-popover"
			appearance="menu"
			trigger="click focus"
			placement="right-start"
			distance="4"
			.arrow=${false}
		>
			<button
				slot="anchor"
				class=${classMap({ item: true, 'overflow-toggle': true, active: containsActive })}
				aria-label="More"
			>
				<code-icon icon="ellipsis"></code-icon>
			</button>
			<div slot="content" class="overflow-menu">
				${repeat(
					overflowIcons,
					i => i.type,
					i => this.renderOverflowItem(i, enabled),
				)}
			</div>
		</gl-popover>`;
	}

	private renderOverflowItem(icon: Icon, enabled: boolean) {
		const isActive = enabled && this.sidebarVisible && this.activePanel === icon.type;
		return html`<button
			class=${classMap({ 'overflow-menu-item': true, active: isActive })}
			?disabled=${!enabled}
			aria-pressed=${isActive}
			@click=${(e: Event) => this.handleOverflowItemClick(icon, e)}
		>
			<code-icon icon="${icon.icon}"></code-icon>
			<span class="overflow-menu-item-label">${icon.tooltip}</span>
			${this.renderIconCount(icon)}
		</button>`;
	}

	private handleOverflowItemClick(icon: Icon, e: Event) {
		// Stop the click from bubbling to the gl-popover host: its own click handler treats an
		// in-body click on a just-closed popover as a request to re-open it, which would fight hide().
		e.stopPropagation();
		this.handleIconClick(icon);
		void this.renderRoot.querySelector('gl-popover')?.hide();
	}

	private handleIconClick(icon: Icon) {
		this.dispatchEvent(
			new CustomEvent<GraphSidebarToggleEventDetail>('gl-graph-sidebar-toggle', {
				detail: { panel: icon.type },
				bubbles: true,
				composed: true,
			}),
		);

		emitTelemetrySentEvent<'graph/action/sidebar'>(this, {
			name: 'graph/action/sidebar',
			data: { action: icon.type },
		});
	}
}

function renderCount(count: number | undefined) {
	if (count == null) return nothing;

	return html`<span class="count">${count > 999 ? '1K+' : String(count)}</span>`;
}
