import { css, unsafeCSS } from 'lit';

/* State colors: uncommitted=yellow, unpushed=green, pushed=grey */
const uncommittedColor = unsafeCSS('var(--vscode-gitlens-decorations-worktreeUncommittedForeground, #e2c08d)');
const unpushedColor = unsafeCSS('var(--vscode-gitlens-decorations-addedForeground, #73c991)');
const pushedColor = unsafeCSS('var(--vscode-descriptionForeground, #888)');
const bgColor = unsafeCSS('var(--vscode-sideBar-background, var(--color-background, #1e1e1e))');

export const detailsScopePaneStyles = css`
	:host {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.details-scope-pane {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.details-scope-pane--dragging {
		user-select: none;
	}

	/* Scope rows — no vertical padding so connectors can span the full row height seamlessly */
	.scope-row {
		display: flex;
		align-items: center;
		min-height: 2.4rem;
		padding: 0 1rem 0 1.2rem;
		gap: 0.6rem;
		font-size: var(--gl-font-base);
		transition: opacity 0.15s ease;
	}

	.scope-row--included {
		background: var(--vscode-list-inactiveSelectionBackground, rgba(86, 156, 214, 0.06));
	}

	.scope-row--excluded {
		opacity: 0.4;
	}

	.scope-row--loading {
		opacity: 0.6;
	}

	.scope-row__label--dimmed {
		color: var(--vscode-descriptionForeground);
		font-style: italic;
	}

	.scope-row__dot-col {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		flex-shrink: 0;
		align-self: stretch;
	}

	/* Connector lines — span full row height, color matches state */
	.scope-row__connector {
		position: absolute;
		left: 50%;
		width: 2px;
		transform: translateX(-50%);
		background: ${pushedColor};
	}

	.scope-row[data-state='uncommitted'] .scope-row__connector {
		background: ${uncommittedColor};
	}

	.scope-row[data-state='unpushed'] .scope-row__connector {
		background: ${unpushedColor};
	}

	/* Connectors go edge-to-edge so they meet across rows */
	.scope-row__connector--above {
		top: 0;
		bottom: 50%;
	}

	.scope-row__connector--below {
		top: 50%;
		bottom: 0;
	}

	.scope-row__label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scope-row__date {
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
		flex-shrink: 0;
	}

	.scope-row__avatar {
		--gl-avatar-size: 1.6rem;
		flex-shrink: 0;
	}

	.scope-row__stats {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
	}

	/* Drag handle — sits between rows */
	.scope-handle {
		position: relative;
		z-index: 2;
		cursor: ns-resize;
		padding: 0.3rem 0;
		touch-action: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Connector line through the drag handle gap */
	.scope-handle::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(1.2rem + 7px);
		width: 2px;
		transform: translateX(-50%);
		background: ${pushedColor};
	}

	.scope-handle__bar {
		position: relative;
		width: 5rem;
		height: 0.5rem;
		border-radius: 0.25rem;
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
		opacity: 0.7;
		transition: opacity 0.15s ease;
	}

	.scope-handle:hover .scope-handle__bar,
	.scope-handle--active .scope-handle__bar {
		opacity: 0.85;
	}

	/*
	 * Dot state indicators
	 * All dots render at the same outer diameter (12px) using box-sizing: border-box
	 * so border-based dots don't grow larger than filled ones.
	 */
	.dot-uncommitted,
	.dot-unpushed,
	.dot-pushed,
	.dot-merge-base {
		position: relative;
		z-index: 1;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		flex-shrink: 0;
		box-sizing: border-box;
	}

	/* Uncommitted: dotted hollow circle (yellow) */
	.dot-uncommitted {
		border: 2px dotted ${uncommittedColor};
		background: ${bgColor};
	}

	/* Unpushed: solid hollow circle (green) */
	.dot-unpushed {
		border: 2px solid ${unpushedColor};
		background: ${bgColor};
	}

	/* Pushed: filled circle (gray) */
	.dot-pushed {
		background: ${pushedColor};
	}

	/* Merge base: filled circle (gray, same as pushed) */
	.dot-merge-base {
		background: ${pushedColor};
	}

	/* Merge base row */
	.scope-row--merge-base {
		opacity: 0.5;
		font-style: italic;
	}
`;
