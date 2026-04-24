import { css } from 'lit';

export {
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	panelStaleBannerStyles,
} from './shared-panel.css.js';

export const composePanelStyles = css`
	/* Matches the fade+slide-up entrance used by other graph details sub-panels so compose
	   mode animates in instead of popping. @keyframes sub-panel-enter is provided by
	   subPanelEnterStyles in the component's styles array. */
	:host {
		animation: sub-panel-enter 0.2s ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
		}
	}

	.compose-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.stale-banner {
		margin: 0.4rem 1.2rem 0;
	}

	.compose-plan {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.compose-plan__header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 1.2rem;
		flex: none;
	}

	.compose-plan__back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-radius: 3px;
		background: transparent;
		color: var(--vscode-charts-purple, #7c3aed);
		cursor: pointer;
		--code-icon-size: 12px;
		flex-shrink: 0;
	}

	.compose-plan__back:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.compose-plan__title {
		font-size: var(--gl-font-base);
		font-weight: 500;
		color: var(--vscode-foreground);
	}

	.compose-plan__count {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		margin-left: auto;
	}

	.compose-plan__count > code-icon {
		font-size: 1.2rem;
		opacity: 0.85;
	}

	.compose-plan__list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* Split between proposed-commits list and selected-commit files. Only used when a commit
	   is selected — when no selection, the list takes full height (no splitter, no second pane). */
	.compose-plan__split {
		flex: 1;
		min-height: 0;
	}

	.compose-plan__split-start,
	.compose-plan__split-end {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.compose-plan__actions {
		flex: none;
		display: flex;
		gap: 0.4rem;
		padding: 0.6rem 1.2rem;
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.compose-commit {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.5rem 1.2rem;
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background 0.1s;
	}

	.compose-commit:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.compose-commit--selected {
		background: rgba(86, 156, 214, 0.08);
		border-left-color: var(--vscode-charts-purple, #7c3aed);
	}

	.compose-commit--committed {
		opacity: 0.4;
		pointer-events: none;
	}

	.compose-commit__num {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		font-weight: 700;
		color: var(--vscode-charts-green, #4ec9b0);
		min-width: 1.4rem;
		text-align: center;
	}

	.compose-commit__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.compose-commit__message {
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compose-commit__stats {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.compose-commit__additions {
		color: var(--vscode-gitDecoration-addedResourceForeground, #2ea043);
	}

	.compose-commit__deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
	}

	.compose-commit__action {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-radius: 3px;
		background: transparent;
		color: var(--vscode-charts-green, #4ec9b0);
		cursor: pointer;
		--code-icon-size: 14px;
	}

	.compose-commit__action:hover {
		background: var(--vscode-charts-green, #4ec9b0);
		color: #fff;
	}

	.compose-base {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 1.2rem 0.6rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		border-top: 1px dashed var(--vscode-sideBarSectionHeader-border);
		margin-top: 0.4rem;
	}

	.compose-base__marker {
		font-size: 1.4rem;
		min-width: 1.4rem;
		text-align: center;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.compose-base__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.compose-base__headline {
		color: var(--vscode-foreground);
		opacity: 0.75;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compose-base__meta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		font-size: var(--gl-font-micro);
	}

	.compose-base__sha {
		font-family: var(--vscode-editor-font-family, monospace);
	}

	.compose-base__author {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compose-base__date {
		flex-shrink: 0;
	}

	.compose-base__dot {
		opacity: 0.6;
	}

	.compose-base__tag {
		flex-shrink: 0;
		font-size: var(--gl-font-micro);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.4rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		color: var(--vscode-descriptionForeground);
	}

	gl-file-tree-pane {
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	/* When the splitter is in play, the file-tree-pane sits in a flex column inside the
	   split-end slot. Drop the standalone margin-top so the split divider sits flush against
	   the file-tree-pane's header (the divider IS the visual separator now). */
	.compose-plan__split-end > gl-file-tree-pane {
		border-top: none;
		margin-top: 0;
	}
`;
