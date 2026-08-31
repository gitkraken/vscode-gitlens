import { css } from 'lit';

export const allowedSignersBaseStyles = css`
	* {
		box-sizing: border-box;
	}

	:not(:defined) {
		visibility: hidden;
	}

	[hidden] {
		display: none !important;
	}

	:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
`;

export const allowedSignersStyles = css`
	.container {
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
		max-width: 960px;
		padding: 2rem;
		margin: 0 auto;
	}

	header h1 {
		margin: 0 0 0.4rem;
		font-size: 2rem;
		font-weight: 600;
	}

	header p {
		margin: 0;
		color: var(--vscode-descriptionForeground);
	}

	.notice {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		padding: 0.8rem 1.2rem;
		background: var(--vscode-inputValidation-warningBackground, rgb(255 191 0 / 10%));
		border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
		border-radius: 0.4rem;
	}

	.notice--error {
		background: var(--vscode-inputValidation-errorBackground, rgb(255 0 0 / 10%));
		border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
	}

	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.2rem;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 0.4rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.field label {
		font-weight: 600;
	}

	.path-row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}

	.path-row input[type='text'] {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		font-family: var(--vscode-editor-font-family, monospace);
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 0.3rem;
	}

	/* Indents the scope radios so they read as sub-options of the "Point …" checkbox above them. */
	.options {
		display: flex;
		flex-direction: column;
		padding-inline-start: 2.6rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 0.4rem;
	}

	gl-signer-row:not(:last-child) {
		border-bottom: 1px solid var(--vscode-panel-border);
	}

	.list__group {
		padding: 0.6rem 1.2rem;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--vscode-descriptionForeground);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
		border-bottom: 1px solid var(--vscode-panel-border);
	}

	.empty {
		padding: 2.4rem;
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}

	.actions {
		display: flex;
		gap: 1.2rem;
		align-items: center;
	}

	.status {
		font-size: 1.2rem;
	}

	.status--success {
		color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
	}

	.status--error {
		color: var(--vscode-errorForeground);
	}

	.loading {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.loading__spinner {
		font-size: 2.8rem;
		color: var(--vscode-descriptionForeground);
	}

	.loading__message {
		margin: 0;
		font-size: 1.4rem;
	}

	.loading__detail {
		margin: 0;
		font-variant-numeric: tabular-nums;
		color: var(--vscode-descriptionForeground);
	}

	.verifying {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		font-size: 1.2rem;
		color: var(--vscode-descriptionForeground);
	}
`;
