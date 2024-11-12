import { css } from 'lit';

export const linkStyles = css`
	a {
		border: 0;
		color: var(--color-link-foreground);
		font-weight: 400;
		outline: none;
		text-decoration: none;
	}
	a:not([href]):not([tabindex]):focus,
	a:not([href]):not([tabindex]):hover {
		color: inherit;
		text-decoration: none;
	}
	a:focus {
		outline-color: var(--color-focus-border);
	}
`;
