import { css } from 'lit';
import { focusOutline } from './a11y.css.js';

/** Chromeless button reset — transparent background, no border, inherit font. */
export const chromelessButton = css`
	.chromeless-btn {
		appearance: none;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: inherit;
		font-size: inherit;
		text-align: left;
		padding: 0;
		color: inherit;
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
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
`;
