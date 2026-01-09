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

	.composer-item:not(.is-selected):is(:focus-visible, :hover) {
		--composer-item-background: var(--vscode-list-hoverBackground);
	}

	.composer-item.is-selected {
		--composer-item-background: var(--vscode-list-activeSelectionBackground, var(--color-background));
		--composer-item-icon-color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
		--composer-item-color: var(--vscode-list-activeSelectionForeground);
	}

	:host-context(.vscode-high-contrast) .composer-item.is-selected {
		--composer-item-border: var(
			--vscode-list-focusAndSelectionOutline,
			var(--vscode-contrastActiveBorder, var(--vscode-list-focusOutline))
		);
	}

	.composer-item.is-summary {
		--composer-item-border: var(--vscode-panel-border);
		--composer-item-radius: 0.4rem;
	}

	.composer-item.is-uncommitted {
		--composer-item-background: color-mix(
			in srgb,
			var(--vscode-notificationsWarningIcon-foreground) 8%,
			transparent
		);
		--composer-item-border: color-mix(in srgb, var(--vscode-notificationsWarningIcon-foreground) 20%, transparent);
		--composer-item-radius: 0.4rem;
		border-style: dashed;
	}

	.composer-item.is-uncommitted:not(.is-selected):is(:focus-visible, :hover) {
		--composer-item-background: color-mix(
			in srgb,
			var(--vscode-notificationsWarningIcon-foreground) 12%,
			transparent
		);
	}

	.composer-item.is-uncommitted.is-selected {
		--composer-item-background: color-mix(
			in srgb,
			var(--vscode-notificationsWarningIcon-foreground) 18%,
			transparent
		);
		--composer-item-border: color-mix(in srgb, var(--vscode-notificationsWarningIcon-foreground) 25%, transparent);
		--composer-item-color: var(--vscode-foreground);
	}

	.composer-item.is-base,
	.composer-item.is-base:focus-visible,
	.composer-item.is-base:hover {
		--composer-item-background: var(--color-background);
		--composer-item-icon-color: var(--color-foreground--65);
		--composer-item-color: var(--color-foreground--65);
		cursor: default;
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

	.composer-item__header.is-placeholder,
	.composer-item__header.is-empty-state {
		font-style: italic;
		opacity: 0.65;
	}

	.composer-item__header.is-empty-state {
		white-space: normal;
		text-overflow: initial;
		text-wrap: pretty;
	}

	.composer-item__body {
		font-size: 1.2rem;
	}

	.composer-item.is-base .composer-item__body {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
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

	.composer-item.is-last .composer-item__commit::before {
		display: none;
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

	.composer-item.is-recompose-locked .composer-item__commit::after {
		border-style: solid;
	}
	.composer-item.is-recompose-locked .composer-item__commit::before {
		border-left-style: solid;
	}

	.composer-item.is-locked {
		opacity: 0.6;
		cursor: default;
	}
	.composer-item.is-locked .drag-handle {
		display: none;
	}
	.composer-item.is-locked .composer-item__commit::after {
		border-style: solid;
	}
	.composer-item.is-locked .composer-item__commit::before {
		border-left-style: solid;
	}

	.composer-item__commit.is-empty::before,
	.composer-item__commit.is-empty::after {
		display: none;
	}
`;

export const composerItemContentStyles = css`
	.change-stats {
		display: flex;
		align-items: center;
		gap: 0.8rem;
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

	.diff-stats__additions {
		color: var(--vscode-gitDecoration-addedResourceForeground);
		color: light-dark(
			color-mix(in srgb, #fff 40%, var(--vscode-gitDecoration-addedResourceForeground)),
			var(--vscode-gitDecoration-addedResourceForeground)
		);
	}

	.diff-stats__deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
		color: light-dark(
			color-mix(in srgb, #fff 40%, var(--vscode-gitDecoration-deletedResourceForeground)),
			var(--vscode-gitDecoration-deletedResourceForeground)
		);
	}
`;
