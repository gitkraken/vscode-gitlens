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
		margin: 0 auto;
		padding: 2rem;
	}

	header h1 {
		font-size: 2rem;
		font-weight: 600;
		margin: 0 0 0.4rem;
	}

	header p {
		margin: 0;
		color: var(--vscode-descriptionForeground);
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.8rem 1.2rem;
		border-radius: 0.4rem;
		background: var(--vscode-inputValidation-warningBackground, rgba(255, 191, 0, 0.1));
		border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
	}

	.notice--error {
		background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
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
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 0.3rem;
		font-family: var(--vscode-editor-font-family, monospace);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 1.6rem;
		align-items: center;
	}

	.options label {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		font-weight: 400;
		cursor: pointer;
	}

	.list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 0.4rem;
		overflow: hidden;
	}

	gl-signer-row:not(:last-child) {
		border-bottom: 1px solid var(--vscode-panel-border);
	}

	.list__group {
		padding: 0.6rem 1.2rem;
		font-size: 1.1rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
		border-bottom: 1px solid var(--vscode-panel-border);
	}

	.empty {
		padding: 2.4rem;
		text-align: center;
		color: var(--vscode-descriptionForeground);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 1.2rem;
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
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
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
		color: var(--vscode-descriptionForeground);
		font-variant-numeric: tabular-nums;
	}

	.verifying {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--vscode-descriptionForeground);
		font-size: 1.2rem;
	}
`;
