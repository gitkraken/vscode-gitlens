import { css } from 'lit';

export const srOnly = css`
	.sr-only,
	.sr-only-focusable:not(:active):not(:focus) {
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		width: 1px;
		height: 1px;
		overflow: hidden;
		position: absolute;
		white-space: nowrap;
	}
`;

export const focusOutline = css`
	outline: 1px solid var(--color-focus-border);
	outline-offset: -1px;
`;
