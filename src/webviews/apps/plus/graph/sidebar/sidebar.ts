import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GraphSidebarPanel } from '../../../../plus/graph/protocol.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphStateContext } from '../context.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';

interface Icon {
	type: IconTypes;
	icon: string;
	tooltip: string;
}
type IconTypes = 'branches' | 'overview' | 'remotes' | 'stashes' | 'tags' | 'worktrees';
const icons: Icon[] = [
	{ type: 'overview', icon: 'home', tooltip: 'Overview' },
	{ type: 'worktrees', icon: 'gl-worktrees-view', tooltip: 'Worktrees' },
	{ type: 'branches', icon: 'gl-branches-view', tooltip: 'Branches' },
	{ type: 'remotes', icon: 'gl-remotes-view', tooltip: 'Remotes' },
	{ type: 'stashes', icon: 'gl-stashes-view', tooltip: 'Stashes' },
	{ type: 'tags', icon: 'gl-tags-view', tooltip: 'Tags' },
];

export interface GraphSidebarToggleEventDetail {
	panel: GraphSidebarPanel;
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
			background-color: var(--titlebar-bg);
			color: var(--titlebar-fg);
			width: 2.6rem;
			font-size: 9px;
			font-weight: 600;
			height: 100%;
			padding: 0.5rem 0;
			z-index: 1040;
			border-right: 1px solid transparent;
			border-color: var(--vscode-activityBar-border, transparent);
		}

		gl-tooltip {
			width: 100%;
		}

		.item {
			position: relative;
			width: 100%;
			color: var(--vscode-activityBar-inactiveForeground, var(--titlebar-fg));
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
			color: var(--vscode-activityBar-foreground, var(--color-foreground));
			text-decoration: none;
		}

		.item.active {
			color: var(--vscode-activityBar-foreground, var(--color-foreground));
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
			background-color: var(
				--vscode-activityBar-activeBorder,
				var(--vscode-activityBar-foreground, var(--color-foreground))
			);
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
			color: var(--color-foreground--50);
			margin-top: 0.4rem;
		}

		.count.error {
			color: var(--vscode-errorForeground);
			opacity: 0.6;
		}
	`;

	get include(): undefined | IconTypes[] {
		const repo = this._state.repositories?.find(item => item.id === this._state.selectedRepository);
		return repo?.virtual
			? (['overview', 'branches', 'remotes', 'tags'] as const)
			: (['overview', 'branches', 'remotes', 'tags', 'stashes', 'worktrees'] as const);
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
		return html`<section class="sidebar">
			${this.sidebarVisible && this.activePanel != null
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
				i => this.renderIcon(i),
			)}
		</section>`;
	}

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

		const tooltipHost = activeButton.closest('gl-tooltip');
		const target = tooltipHost ?? activeButton;

		const sidebarRect = sidebar.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();

		indicator.style.setProperty('--indicator-top', `${targetRect.top - sidebarRect.top}px`);
		indicator.style.setProperty('--indicator-height', `${targetRect.height}px`);
	}

	private renderIcon(icon: Icon) {
		if (this.include != null && !this.include.includes(icon.type)) return;

		const isActive = this.sidebarVisible && this.activePanel === icon.type;

		return html`<gl-tooltip placement="right" content="${icon.tooltip}">
			<button
				class=${classMap({ item: true, active: isActive, overview: icon.type === 'overview' })}
				@click=${() => this.handleIconClick(icon)}
				aria-pressed=${isActive}
			>
				<code-icon icon="${icon.icon}"></code-icon>
				${icon.type !== 'overview'
					? this._actions?.state.countsLoading.get()
						? html`<span class="count"
								><code-icon icon="loading" modifier="spin" size="9"></code-icon
							></span>`
						: this._actions?.state.countsError.get()
							? html`<span class="count error"><code-icon icon="warning" size="9"></code-icon></span>`
							: renderCount(this._actions?.state.counts.get()?.[icon.type])
					: nothing}
			</button>
		</gl-tooltip>`;
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
