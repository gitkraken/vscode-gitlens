import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GraphDisplayMode, GraphSidebarPanel } from '../../../../plus/graph/protocol.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphStateContext } from '../context.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
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

// Single Visualizations toggle — always shows the chart icon. Selected/unselected state (driven by
// `aria-checked` on `<gl-button>`) telegraphs "Timeline mode is on" vs. off, so the icon stays
// consistent and the user doesn't have to learn that the icon flips.
const visualizationsTooltip: Record<GraphDisplayMode, string> = {
	graph: 'Show Visualizations',
	timeline: 'Show Commit Graph',
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
			box-sizing: border-box;
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 1.4rem;
			background-color: var(--color-view-background);
			color: var(--color-view-foreground--65);
			width: 2.6rem;
			font-size: 9px;
			font-weight: 600;
			height: 100%;
			padding: 0.5rem 0;
			z-index: 1040;
			border-right: 1px solid transparent;
			border-color: var(--vscode-sideBar-border, transparent);
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
			width: 100%;
			color: var(--color-view-foreground--65);
			text-decoration: none;
			display: flex;
			flex-direction: column;
			align-items: center;
			cursor: pointer;
			background: none;
			border: none;
			padding: 0;
			font: inherit;
		}

		.item:hover {
			color: var(--color-view-foreground);
			text-decoration: none;
		}

		.item.active {
			color: var(--color-view-foreground);
		}

		.item.overview {
			padding: 0.6rem 0;
		}

		.indicator {
			position: absolute;
			left: 0;
			top: 0;
			width: 1px;
			border-radius: 1px;
			background-color: var(--color-view-foreground);
			height: var(--indicator-height, 0px);
			transform: translateY(var(--indicator-top, 0px));
			transition:
				transform 0.25s ease-in-out,
				height 0.15s ease-in-out;
			pointer-events: none;
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
			color: var(--color-view-foreground--50);
			margin-top: 0.4rem;
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
	`;

	get include(): undefined | IconTypes[] {
		const repo = this._state.repositories?.find(item => item.id === this._state.selectedRepository);
		const base: readonly IconTypes[] = repo?.virtual
			? (['overview', 'agents', 'branches', 'remotes', 'tags'] as const)
			: (['overview', 'agents', 'branches', 'remotes', 'tags', 'stashes', 'worktrees'] as const);

		return [...base];
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

	override render(): unknown {
		const displayMode: GraphDisplayMode = this._state.displayMode ?? 'graph';
		const isGraphMode = displayMode === 'graph';
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
				icons,
				i => i.type,
				i => this.renderIcon(i, isGraphMode),
			)}
			<div class="spacer"></div>
			${this.renderVisualizationsToggle(displayMode)}
		</section>`;
	}

	private renderVisualizationsToggle(current: GraphDisplayMode) {
		const tooltip = visualizationsTooltip[current];
		const isTimeline = current === 'timeline';
		const showCallout = !this._state.visualizationsButtonCalloutDismissed;
		// `gl-button` ships its own checked/unchecked state via `aria-checked`. Keeping the icon
		// constant (always the chart icon) so the button's selected fill — not an icon swap — is
		// what telegraphs "Timeline mode is on".
		return html`<gl-button
			class=${classMap({ 'display-mode-toggle': true, callout: showCallout })}
			appearance="toolbar"
			role="switch"
			aria-checked=${isTimeline ? 'true' : 'false'}
			aria-label=${tooltip}
			tooltip=${tooltip}
			tooltipPlacement="right"
			@click=${this.handleVisualizationsToggle}
		>
			<code-icon icon="pulse"></code-icon>
		</gl-button>`;
	}

	private handleVisualizationsToggle = (): void => {
		const current = this._state.displayMode ?? 'graph';
		const next: GraphDisplayMode = current === 'graph' ? 'timeline' : 'graph';
		const wasCalloutVisible = !this._state.visualizationsButtonCalloutDismissed;

		this.dispatchEvent(
			new CustomEvent<GraphSidebarDisplayModeChangeEventDetail>('gl-graph-sidebar-display-mode-change', {
				detail: { mode: next },
				bubbles: true,
				composed: true,
			}),
		);

		if (wasCalloutVisible) {
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
	};

	override firstUpdated(changedProperties: PropertyValues): void {
		super.firstUpdated(changedProperties);
		this._updateIndicator();
		requestAnimationFrame(() => {
			this._suppressTransition = false;
		});
	}

	override updated(changedProperties: PropertyValues): void {
		super.updated(changedProperties);

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

	private renderIcon(icon: Icon, enabled: boolean) {
		if (this.include != null && !this.include.includes(icon.type)) return;

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
