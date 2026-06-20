import { css } from 'lit';

// `composerItemStyles` is to replace the following styles:
// `.commit-item` in `commit-item.ts`
// `.composition-summary-card` in `commits-panel.ts`
// `.unassigned-section` in `commits-panel.ts`

export const composerItemStyles = css`
	.composer-item {
		--composer-item-background: var(--composer-background-05);
		--composer-item-border: transparent;
		--composer-item-radius: var(--gl-radius-xl);
		--composer-item-color: var(--vscode-foreground);
		--composer-item-icon-color: var(--vscode-icon-foreground);

		display: flex;
		flex-direction: row;
		align-items: center;
		color: var(--composer-item-color);
		cursor: pointer;
		background: var(--composer-item-background);

		/* gap: 0.8rem; */
		border: 1px solid var(--composer-item-border);
		border-radius: var(--composer-item-radius);
		transition: background-color 0.2s ease;
	}

	.composer-item:not(.is-selected):is(:focus-visible, :hover) {
		--composer-item-background: var(--vscode-list-hoverBackground);
	}

	.composer-item.is-selected,
	.composer-item:focus-visible {
		--composer-item-background: var(--vscode-list-activeSelectionBackground, var(--color-background));
		--composer-item-icon-color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
		--composer-item-color: var(--vscode-list-activeSelectionForeground);

		transition: none;
	}

	:host-context(.vscode-high-contrast) .composer-item.is-selected,
	:host-context(.vscode-high-contrast) .composer-item:focus-visible {
		--composer-item-border: var(
			--vscode-list-focusAndSelectionOutline,
			var(--vscode-contrastActiveBorder, var(--vscode-list-focusOutline))
		);
	}

	.composer-item.is-summary {
		--composer-item-border: var(--vscode-panel-border);
		--composer-item-radius: var(--gl-radius-sm);
	}

	.composer-item.is-uncommitted {
		--composer-item-background: color-mix(
			in srgb,
			var(--vscode-notificationsWarningIcon-foreground) 8%,
			transparent
		);
		--composer-item-border: color-mix(in srgb, var(--vscode-notificationsWarningIcon-foreground) 20%, transparent);
		--composer-item-radius: var(--gl-radius-sm);

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
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
		padding: 0.8rem 1.2rem;
	}

	.composer-item__header {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 1.4rem;
		white-space: nowrap;
	}

	.composer-item__header.is-placeholder,
	.composer-item__header.is-empty-state {
		font-style: italic;
		opacity: 0.65;
	}

	.composer-item__header.is-empty-state {
		text-overflow: initial;
		text-wrap: pretty;
		white-space: normal;
	}

	.composer-item__body {
		font-size: 1.2rem;
	}

	.composer-item.is-base .composer-item__body {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`;

export const composerItemCommitStyles = css`
	.composer-item__commit {
		position: relative;
		flex: none;
		align-self: stretch;
		width: 2.2rem;
		margin-inline-start: 0.8rem;
	}

	.composer-item__commit::before {
		position: absolute;
		top: 0;
		left: 50%;
		width: 0;
		height: 100%;
		content: '';
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
		position: absolute;
		top: 50%;
		left: 0;
		z-index: 1;
		width: 1.8rem;
		aspect-ratio: 1;
		content: '';
		background: var(--composer-item-background);
		border: 2px dashed var(--composer-item-icon-color);
		border-radius: 50%;
		transform: translateY(-50%);
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
		cursor: default;
		opacity: 0.6;
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
		gap: 0.8rem;
		align-items: center;
	}

	.diff-stats {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;

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
