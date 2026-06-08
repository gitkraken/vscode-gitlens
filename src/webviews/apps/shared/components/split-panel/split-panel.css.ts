import { css } from 'lit';

export const splitPanelStyles = css`
	:host {
		display: grid;
		grid-template-rows: 1fr;
		grid-template-columns:
			var(
				--gl-split-panel-start-size,
				min(var(--_start-size, 0%), calc(100% - var(--gl-split-panel-divider-width, 4px)))
			)
			var(--gl-split-panel-divider-width, 4px) 1fr;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	:host([orientation='vertical']) {
		grid-template-rows:
			var(
				--gl-split-panel-start-size,
				min(var(--_start-size, 0%), calc(100% - var(--gl-split-panel-divider-width, 4px)))
			)
			var(--gl-split-panel-divider-width, 4px) 1fr;
		grid-template-columns: 1fr;
	}

	/* :host { display: grid } overrides the UA [hidden] rule; re-assert it. */
	:host([hidden]) {
		display: none;
	}

	:host([dragging]) {
		user-select: none;
	}

	/*
	 * min-width / min-height must be 0 on the slotted grid items themselves.
	 * Grid items default to min-*: auto (intrinsic content size), which prevents
	 * them from shrinking in a single frame when the container narrows — causing
	 * visible multi-frame "catch-up" jank during parent panel resizes. Targeting
	 * the <slot> elements directly doesn't work because slots default to
	 * display: contents and have no box.
	 */
	::slotted(*) {
		min-width: 0;
		height: 100%;
		min-height: 0;
	}

	.divider {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: none;
		cursor: ew-resize;
		background-color: transparent;
		transition: background-color 0.1s ease-out;
	}

	:host([orientation='vertical']) .divider {
		cursor: ns-resize;
	}

	.divider:focus {
		outline: none;
	}

	.divider:focus-visible {
		background-color: var(--vscode-focusBorder);
	}

	.divider:hover {
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
		transition-delay: 0.2s;
	}

	:host([dragging]) .divider,
	.divider:active {
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
	}

	/* Invisible hit area extending beyond the divider for easier grabbing */
	.divider::after {
		position: absolute;
		left: calc(var(--gl-split-panel-divider-hit-area, 8px) / -2 + var(--gl-split-panel-divider-width, 4px) / 2);
		display: block;
		width: var(--gl-split-panel-divider-hit-area, 8px);
		height: 100%;
		content: '';
	}

	:host([orientation='vertical']) .divider::after {
		top: calc(var(--gl-split-panel-divider-hit-area, 8px) / -2 + var(--gl-split-panel-divider-width, 4px) / 2);
		left: 0;
		width: 100%;
		height: var(--gl-split-panel-divider-hit-area, 8px);
	}

	@media (forced-colors: active) {
		.divider {
			outline: solid 1px transparent;
		}
	}

	/*
	 * Overlay mode — start panel floats over the end panel instead of redistributing space.
	 * Drag/snap/percentage math is unchanged; only the layout switches from grid to absolute
	 * positioning. The end panel always fills the container; the start panel is sized via the
	 * same --_start-size custom property the grid track would have used.
	 */
	:host([mode='overlay']) {
		position: relative;
		display: block;
		grid-template-rows: unset;
		grid-template-columns: unset;
	}

	:host([mode='overlay']) ::slotted([slot='start']) {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 2;
		width: var(--_start-size, 0%);
		max-width: 100%;
		box-shadow: 0 0 0.5rem var(--vscode-widget-shadow, rgb(0 0 0 / 36%));
		transition: width 0.08s ease-out;
	}

	:host([mode='overlay'][dragging]) ::slotted([slot='start']) {
		transition: none;
	}

	:host([mode='overlay']) ::slotted([slot='end']) {
		position: absolute;
		inset: 0;
		width: 100%;
	}

	:host([mode='overlay']) .divider {
		position: absolute;
		top: 0;
		bottom: 0;

		/* Sit flush against the panel's right edge — not centered on the boundary like split
		   mode — so the visible divider stays entirely outside the floating panel.
		   The ::after hit area still extends 2px into the panel, keeping it grabbable. */
		left: var(--_start-size, 0%);
		z-index: 3;
		width: var(--gl-split-panel-divider-width, 4px);
		height: auto;
		transition:
			background-color 0.1s ease-out,
			left 0.08s ease-out;
	}

	:host([mode='overlay'][dragging]) .divider {
		transition: none;
	}
`;
