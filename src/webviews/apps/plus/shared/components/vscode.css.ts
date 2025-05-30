import { css } from 'lit';

export const linkStyles = css`
	a {
		border: 0;
		color: var(--link-foreground);
		font-weight: 400;
		outline: none;
		text-decoration: var(--link-decoration-default, none);
	}

	a:focus-visible {
		outline: 1px solid var(--color-focus-border);
		border-radius: 0.2rem;
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
