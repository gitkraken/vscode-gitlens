import { css } from 'lit';

// `composerItemStyles` is to replace the following styles:
// `.commit-item` in `commit-item.ts`
// `.composition-summary-card` in `commits-panel.ts`
// `.unassigned-section` in `commits-panel.ts`

export const composerItemStyles = css`
	.composer-item {
		--composer-item-background: var(--composer-background-05);
		--composer-item-border: transparent;
		--composer-item-radius: 1.2rem;
		/* --composer-item-border: var(--vscode-contrastActiveBorder, var(--vscode-list-inactiveFocusOutline)); */
		--composer-item-color: var(--vscode-foreground);
		--composer-item-icon-color: var(--vscode-icon-foreground);

		display: flex;
		flex-direction: row;
		align-items: center;
		/* gap: 0.8rem; */
		border: 1px solid var(--composer-item-border);
		border-radius: var(--composer-item-radius);
		color: var(--composer-item-color);
		background: var(--composer-item-background);
		transition: background-color 0.2s ease;
		cursor: pointer;
	}

	.composer-item:not(.is-selected):focus-visible,
	.composer-item:not(.is-selected):hover {
		--composer-item-background: var(--vscode-list-hoverBackground);
	}

	.composer-item.is-selected {
		--composer-item-background: var(--vscode-list-activeSelectionBackground);
		--composer-item-icon-color: var(--vscode-list-activeSelectionForeground);
		--composer-item-color: var(--vscode-list-activeSelectionForeground);
		/* --composer-item-border: var(
			--vscode-list-focusAndSelectionOutline,
			var(--vscode-contrastActiveBorder, var(--vscode-list-focusOutline))
		); */
	}

	.composer-item.is-summary,
	.composer-item.is-uncommitted {
		--composer-item-border: var(--vscode-panel-border);
	}

	.composer-item.is-summary {
		--composer-item-radius: 0.4rem;
	}

	.composer-item.is-uncommitted {
		border-style: dashed;
	}

	.composer-item.is-base,
	.composer-item.is-base:focus-visible,
	.composer-item.is-base:hover {
		--composer-item-background: var(--color-background);
		--composer-item-icon-color: var(--color-foreground--65);
		--composer-item-color: var(--color-foreground--65);
	}

	.composer-item__content {
		flex: 1;
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.8rem 1.2rem;
	}

	.composer-item__header {
		font-size: 1.4rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}

	.composer-item__header.is-placeholder {
		font-style: italic;
		opacity: 0.65;
	}

	.composer-item__body {
		font-size: 1.2rem;
	}
`;

export const composerItemCommitStyles = css`
	.composer-item__commit {
		flex: none;
		position: relative;
		width: 2.2rem;
		align-self: stretch;
		margin-inline-start: 0.8rem;
	}
	.composer-item__commit::before {
		content: '';
		position: absolute;
		top: 0;
		left: 50%;
		width: 0;
		height: 100%;
		border-left: 2px dashed var(--composer-item-icon-color);
		transform: translateX(-50%);
	}

	.composer-item.is-first .composer-item__commit::before {
		top: 50%;
		height: 50%;
	}

	.composer-item__commit::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		width: 1.8rem;
		aspect-ratio: 1;
		transform: translateY(-50%);
		border-radius: 50%;
		background: var(--composer-item-background);
		border: 2px dashed var(--composer-item-icon-color);
		z-index: 1;
	}

	.composer-item.is-base .composer-item__commit::after {
		border-style: solid;
	}
	.composer-item.is-base .composer-item__commit::before {
		border-left-style: solid;
	}
`;

export const composerItemContentStyles = css`
	.change-stats {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		color: var(--color-foreground--85);
		/* font-size: 1.2rem; */
	}

	.file-count {
	}

	.diff-stats {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		/* font-size: 0.8rem; */
		font-weight: 500;
	}

	.diff-stats .additions {
		color: var(--vscode-gitDecoration-addedResourceForeground);
	}

	.diff-stats .deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
	}
`;
