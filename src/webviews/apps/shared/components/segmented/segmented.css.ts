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
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
		appearance: none;
		cursor: pointer;
		background-color: transparent;
		border: 1px solid transparent;
		border-radius: 0.3rem;
	}

	.segment:hover:not([aria-checked='true']) {
		color: var(--color-foreground);
		background-color: var(--gl-color-action-quiet-bg-hover);
	}

	/* Fill + weight, not color alone, distinguish the selected segment;
	   the contrast border keeps it visible in high-contrast themes. */
	.segment[aria-checked='true'] {
		font-weight: var(--gl-font-weight-semibold);
		color: var(--vscode-button-foreground);
		background-color: var(--vscode-button-background);
		/* Keep the fallback: an unresolved var() leaves border-color at currentcolor, not .segment's transparent */
		border-color: var(--gl-color-border-contrast, transparent);
	}

	.segment:focus-visible {
		outline: 1px solid var(--gl-color-border-focus);
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
