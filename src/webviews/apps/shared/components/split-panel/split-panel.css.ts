import { css } from 'lit';

export const splitPanelStyles = css`
	:host {
		display: grid;
		grid-template-columns: var(--_start-size, 0px) var(--gl-split-panel-divider-width, 4px) 1fr;
		grid-template-rows: 1fr;
		height: 100%;
		width: 100%;
		overflow: hidden;
	}

	:host([orientation='vertical']) {
		grid-template-columns: 1fr;
		grid-template-rows: var(--_start-size, 0px) var(--gl-split-panel-divider-width, 4px) 1fr;
	}

	:host([dragging]) {
		user-select: none;
	}

	.start,
	.end {
		overflow: visible;
	}

	::slotted(*) {
		height: 100%;
	}

	.divider {
		display: flex;
		position: relative;
		align-items: center;
		justify-content: center;
		cursor: ew-resize;
		touch-action: none;
		background-color: transparent;
		transition: background-color 0.1s ease-out;
		z-index: 1;
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
		transition-delay: 0.2s;
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
	}

	.divider:active {
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
	}

	/* Invisible hit area extending beyond the divider for easier grabbing */
	.divider::after {
		display: block;
		content: '';
		position: absolute;
		height: 100%;
		left: calc(var(--gl-split-panel-divider-hit-area, 8px) / -2 + var(--gl-split-panel-divider-width, 4px) / 2);
		width: var(--gl-split-panel-divider-hit-area, 8px);
	}

	:host([orientation='vertical']) .divider::after {
		width: 100%;
		height: var(--gl-split-panel-divider-hit-area, 8px);
		left: 0;
		top: calc(var(--gl-split-panel-divider-hit-area, 8px) / -2 + var(--gl-split-panel-divider-width, 4px) / 2);
	}

	@media (forced-colors: active) {
		.divider {
			outline: solid 1px transparent;
		}
	}
`;
