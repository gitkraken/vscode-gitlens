import { css } from 'lit';
import { focusOutline } from './a11y.css.js';

/** Chromeless button reset — transparent background, no border, inherit font. */
export const chromelessButton = css`
	.chromeless-btn {
		padding: 0;
		font-family: inherit;
		font-size: inherit;
		color: inherit;
		text-align: left;
		appearance: none;
		cursor: pointer;
		background: transparent;
		border: none;
	}

	.chromeless-btn:focus-visible {
		${focusOutline}
	}
`;

/** Interactive row — cursor pointer + hover background + focus outline. */
export const interactiveRow = css`
	.interactive-row {
		cursor: pointer;
	}

	.interactive-row:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.interactive-row:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
`;
