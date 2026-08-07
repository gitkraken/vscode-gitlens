import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../../../shared/components/chips/action-chip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-compare-pinned': GlGraphComparePinned;
	}

	interface GlobalEventHandlersEventMap {
		/** The flip-orientation action chip. */
		'gl-graph-compare-flip': CustomEvent<void>;
		/** The close action chip — bypasses the sheet stack; pinned compare was never pushed onto it. */
		'gl-graph-compare-close': CustomEvent<void>;
	}
}

/**
 * Chrome host for the pinned-panel form of compare — header (title + flip/close action chips) plus
 * a body slot for the compare content (slotted in by the panel — see
 * `GlGraphDetailsPanel.renderCompareMode`). Sits as the `end` side of the panel's own
 * `gl-split-panel`, so the host itself is the flex child rather than a wrapping div.
 *
 * Emits (bubbles + composed):
 * - `gl-graph-compare-flip` — the "Move Beside"/"Move Below" action chip
 * - `gl-graph-compare-close` — the close action chip
 */
@customElement('gl-graph-compare-pinned')
export class GlGraphComparePinned extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
				background: var(--vscode-sideBar-background, var(--color-background));
				border-left: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.compare-pinned-host__header {
				box-sizing: border-box;
				display: flex;
				flex: 0 0 auto;
				gap: var(--gl-space-8);
				align-items: center;
				justify-content: space-between;
				min-height: 4.2rem;
				padding: var(--gl-space-8) var(--gl-space-8) var(--gl-space-8) var(--gl-space-16);
				background: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.compare-pinned-host__title {
				flex: 1 1 auto;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: var(--gl-font-lg);
				font-weight: 600;
				color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
				white-space: nowrap;
			}

			.compare-pinned-host__actions {
				display: inline-flex;
				flex: 0 0 auto;
				gap: var(--gl-space-2);
				align-items: center;
			}

			.compare-pinned-host__body {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				min-height: 0;
				overflow: hidden;
			}
		`,
	];

	@property()
	orientation: 'horizontal' | 'vertical' = 'horizontal';

	override render(): unknown {
		return html`<header class="compare-pinned-host__header">
				<span class="compare-pinned-host__title">Comparing References</span>
				<div class="compare-pinned-host__actions">
					<gl-action-chip
						icon=${this.orientation === 'horizontal' ? 'layout-panel' : 'layout-sidebar-right'}
						label=${this.orientation === 'horizontal' ? 'Move Below' : 'Move Beside'}
						overlay="tooltip"
						@click=${this.handleFlipClick}
					></gl-action-chip>
					<slot name="actions"></slot>
					<gl-action-chip
						icon="close"
						label="Close"
						overlay="tooltip"
						@click=${this.handleCloseClick}
					></gl-action-chip>
				</div>
			</header>
			<div class="compare-pinned-host__body"><slot></slot></div>`;
	}

	private handleFlipClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-compare-flip', { bubbles: true, composed: true }));
	};

	private handleCloseClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-compare-close', { bubbles: true, composed: true }));
	};
}
