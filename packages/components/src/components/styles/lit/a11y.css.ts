import type { CSSResult } from 'lit';
import { css } from 'lit';

export const srOnlyStyles: CSSResult = css`
	clip-path: inset(50%);
	width: 1px;
	height: 1px;
	overflow: hidden;
	position: absolute;
	white-space: nowrap;
`;

export const srOnly: CSSResult = css`
	.sr-only,
	.sr-only-focusable:not(:active, :focus-visible, :focus-within) {
		${srOnlyStyles}
	}
`;

export const focusOutline: CSSResult = css`
	outline: var(--gl-border-width) solid var(--color-focus-border);
	outline-offset: -1px;
`;

export const focusOutlineButton: CSSResult = css`
	outline: var(--gl-border-width) solid var(--color-focus-border);
	outline-offset: 2px;
`;

export const focusableBaseStyles: CSSResult = css`
	:focus-visible {
		${focusOutline}
	}
`;
