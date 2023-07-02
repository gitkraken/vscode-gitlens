import { css } from 'lit';

export const svgBase = css`
	:host {
		display: block;
		max-width: 69.2rem;
		width: calc(100% - 2rem);
		margin: 0 1rem 1.3rem;
	}
	:host > svg {
		width: 100%;
		height: auto;
		border: 0.1rem solid var(--vscode-editorWidget-border);
		fill: var(--vscode-editor-background);
	}

	* {
		user-select: none;
	}
`;

export const icons = css`
	.codicon {
		font-family: codicon;
		cursor: default;
		user-select: none;
	}

	.glicon {
		font-family: glicons;
		cursor: default;
		user-select: none;
	}
`;
