import { css } from 'lit';

export const baseStyles = css`
	:host {
		box-sizing: border-box;
		display: inline-block;
		vertical-align: text-bottom;
	}

	.pill {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--gl-pill-min-height, auto);
		padding: var(--gl-pill-padding, 0.2rem 0.5rem);
		font-size: var(--gl-pill-font-size, 1rem);
		font-weight: 500;
		line-height: var(--gl-pill-line-height, 1);
		color: var(--gl-pill-foreground, var(--vscode-foreground));
		text-transform: uppercase;
		white-space: nowrap;
		background-color: var(--gl-pill-background, var(--vscode-editorWidget-background));
		border-radius: var(--gl-pill-border-radius, 0.5rem);
	}

	.pill--outlined {
		padding: var(--gl-pill-padding, 0.2rem 0.4rem);
		background-color: transparent;
		border: 1px solid var(--gl-pill-border, var(--vscode-foreground));
	}
`;
