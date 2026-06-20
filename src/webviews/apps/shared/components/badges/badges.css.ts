import { css } from 'lit';

export const badgeBase = css`
	.badge {
		display: inline-flex;
		padding: 0 0.8rem 0.1rem;
		font-size: var(--gl-badge-font-size, x-small);
		font-weight: 600;
		font-variant: all-small-caps;
		color: var(--gl-badge-color, var(--color-foreground--50));
		white-space: nowrap;
		border: currentcolor 1px solid;
		border-radius: 1rem;
	}

	:host([appearance='filled']) .badge {
		justify-content: center;
		min-width: 1.6rem;
		padding: var(--gl-space-2) var(--gl-space-4);
		font-weight: 500;
		line-height: 1;
		color: var(--vscode-badge-foreground);
		background-color: var(--vscode-badge-background);
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	:host([appearance='warning']) .badge {
		justify-content: center;
		min-width: 1.6rem;
		padding: var(--gl-space-2) var(--gl-space-4);
		font-weight: 500;
		line-height: 1;
		color: var(--vscode-button-foreground, #fff);
		background-color: var(--vscode-gitDecoration-conflictingResourceForeground);
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	/* Recessed sub-segment meant to nest INSIDE a filled badge (e.g. "+N Mixed" inside
	 * "x of y Staged"). Translucent foreground tint reads as a chip carved into the accent fill,
	 * while text keeps the badge foreground so it stays legible across themes. */
	:host([appearance='muted']) .badge {
		justify-content: center;
		padding: 0.1rem 0.4rem;
		font-weight: 500;
		line-height: 1;
		color: var(--vscode-badge-foreground);
		background-color: color-mix(in srgb, var(--vscode-badge-foreground) 20%, transparent);
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	/* "Experimental" stamp used by features still gated behind a config flag (e.g. Agent Kanban,
	 * Visualizations treemap). Uses the editor-warning tone with color-mix so the badge reads as
	 * a heads-up without overwhelming the surrounding chrome. */
	:host([appearance='experimental']) {
		display: inline-flex;
	}

	:host([appearance='experimental']) .badge {
		align-items: center;
		justify-content: center;
		padding: 0.1rem 0.6rem;
		font-weight: 600;
		font-variant: normal;
		color: var(--vscode-editorWarning-foreground, var(--color-foreground--65));
		letter-spacing: 0.06em;
		background-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, currentColor) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, currentColor) 60%, transparent);
		border-radius: var(--gl-radius-sm);
	}
`;
