import { css } from 'lit';

export const segmentedStyles = css`
	:host {
		display: inline-flex;
	}

	.group {
		display: inline-flex;
		gap: var(--gl-space-2);
		padding: var(--gl-space-2);
		background-color: var(--vscode-input-background);
		border: var(--gl-border-width) solid var(--vscode-input-border, var(--vscode-contrastBorder, transparent));
		border-radius: 0.5rem;
	}

	.segment {
		padding: 0.3rem 1.2rem;
		font-family: var(--vscode-font-family);
		font-size: 1.2rem;
		line-height: 1.4;
		color: var(--color-foreground--75);
		white-space: nowrap;
		appearance: none;
		cursor: pointer;
		background-color: transparent;
		border: 1px solid transparent;
		border-radius: 0.3rem;
	}

	.segment:hover:not([aria-checked='true']) {
		color: var(--color-foreground);
		background-color: var(--vscode-toolbar-hoverBackground);
	}

	/* Fill + weight, not color alone, distinguish the selected segment;
	   the contrast border keeps it visible in high-contrast themes. */
	.segment[aria-checked='true'] {
		font-weight: 600;
		color: var(--vscode-button-foreground);
		background-color: var(--vscode-button-background);
		border-color: var(--vscode-contrastBorder, transparent);
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
