import { css } from 'lit';

export const baseStyles = css`
	:host {
		display: inline-block;
		vertical-align: text-bottom;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.2rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 500;
		line-height: 1;
		text-transform: uppercase;
		color: var(--vscode-foreground);
		background-color: var(--vscode-editorWidget-background);
	}
`;
