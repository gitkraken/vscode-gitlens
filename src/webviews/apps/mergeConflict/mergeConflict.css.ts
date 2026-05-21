import { css } from 'lit';

/** Merge Conflict editor layout styles. Themed via VS Code CSS variables. */
export const mergeConflictStyles = css`
	:host {
		display: block;
		height: 100vh;
		color: var(--vscode-foreground);
		background-color: var(--vscode-editor-background);
		font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
		font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
	}

	.layout {
		display: grid;
		grid-template-rows: auto 1fr 1fr;
		height: 100%;
	}

	.toolbar {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--vscode-editorWidget-border);
		background-color: var(--vscode-editorWidget-background);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}

	.toolbar__title {
		font-weight: 600;
		flex: 0 0 auto;
		margin-right: 0.5rem;
	}

	.toolbar__spacer {
		flex: 1;
	}

	.toolbar__count {
		opacity: 0.75;
	}

	.toolbar__btn {
		background: transparent;
		color: inherit;
		border: 1px solid var(--vscode-button-border, transparent);
		padding: 0.25rem 0.65rem;
		border-radius: 2px;
		cursor: pointer;
		font: inherit;
	}

	.toolbar__btn:hover {
		background-color: var(--vscode-toolbar-hoverBackground);
	}

	.toolbar__btn--primary {
		background-color: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
	}

	.toolbar__btn--primary:hover {
		background-color: var(--vscode-button-hoverBackground);
	}

	.panes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1px;
		background-color: var(--vscode-editorWidget-border);
		min-height: 0;
	}

	.output {
		border-top: 1px solid var(--vscode-editorWidget-border);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.unsupported {
		padding: 1.5rem;
		text-align: center;
		color: var(--vscode-descriptionForeground);
	}

	.unsupported__title {
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--vscode-foreground);
	}
`;
