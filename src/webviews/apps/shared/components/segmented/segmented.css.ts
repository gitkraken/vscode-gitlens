import { css } from 'lit';

export const segmentedStyles = css`
	:host {
		display: inline-flex;
	}

	.group {
		display: inline-flex;
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 0.5rem;
		background-color: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder, transparent));
	}

	.segment {
		appearance: none;
		border: 1px solid transparent;
		border-radius: 0.3rem;
		padding: 0.3rem 1.2rem;
		font-family: var(--vscode-font-family);
		font-size: 1.2rem;
		line-height: 1.4;
		color: var(--color-foreground--75);
		background-color: transparent;
		cursor: pointer;
		white-space: nowrap;
	}

	.segment:hover:not([aria-checked='true']) {
		color: var(--color-foreground);
		background-color: var(--vscode-toolbar-hoverBackground);
	}

	/* Fill + weight, not color alone, distinguish the selected segment;
	   the contrast border keeps it visible in high-contrast themes. */
	.segment[aria-checked='true'] {
		background-color: var(--vscode-button-background);
		border-color: var(--vscode-contrastBorder, transparent);
		color: var(--vscode-button-foreground);
		font-weight: 600;
	}

	.segment:focus-visible {
		outline: 1px solid var(--color-focus-border);
		outline-offset: 2px;
	}

	:host([disabled]) .segment {
		cursor: not-allowed;
		opacity: 0.5;
	}

	@media (prefers-reduced-motion: no-preference) {
		.segment {
			transition:
				background-color 0.15s,
				color 0.15s;
		}
	}
`;
