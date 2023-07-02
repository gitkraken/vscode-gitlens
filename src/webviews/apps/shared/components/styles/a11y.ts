import { css, cssPartial } from '@microsoft/fast-element';

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

export const focusOutline = cssPartial`
	outline: 1px solid var(--focus-color);
	outline-offset: -1px;
`;
