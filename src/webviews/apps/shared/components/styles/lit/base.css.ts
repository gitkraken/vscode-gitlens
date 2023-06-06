import { css } from 'lit';
import { focusOutline } from './a11y.css';

export const elementBase = css`
	:host {
		box-sizing: border-box;
	}
	:host *,
	:host *::before,
	:host *::after {
		box-sizing: inherit;
	}
	[hidden] {
		display: none !important;
	}
`;

export const linkBase = css`
	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
	}
	a:focus {
		${focusOutline}
	}
	a:hover {
		text-decoration: underline;
	}
`;
