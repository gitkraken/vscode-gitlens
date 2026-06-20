import { css } from 'lit';

export const linkStyles = css`
	a {
		font-weight: 400;
		color: var(--link-foreground);
		text-decoration: var(--link-decoration-default, none);
		outline: none;
		border: 0;
	}

	a:focus-visible {
		outline: 1px solid var(--color-focus-border);
		border-radius: var(--gl-radius-xs);
	}

	a:hover {
		color: var(--link-foreground-active);
		text-decoration: underline;
	}
`;

export const ruleStyles = css`
	hr {
		border: none;
		border-top: 1px solid var(--color-foreground--25);
	}
`;
