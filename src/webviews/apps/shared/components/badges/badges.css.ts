import { css } from 'lit';

export const badgeBase = css`
	.badge {
		display: inline-flex;
		font-size: var(--gl-badge-font-size, x-small);
		font-variant: all-small-caps;
		font-weight: 600;
		color: var(--gl-badge-color, var(--color-foreground--50));
		border: currentColor 1px solid;
		border-radius: 1rem;
		padding: 0 0.8rem 0.1rem;
		white-space: nowrap;
	}

	:host([appearance='filled']) .badge {
		background-color: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border: none;
		font-weight: 500;
		line-height: 1;
		min-width: 1.6rem;
		justify-content: center;
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
	}

	:host([appearance='warning']) .badge {
		background-color: var(--vscode-gitDecoration-conflictingResourceForeground);
		color: var(--vscode-button-foreground, #fff);
		border: none;
		font-weight: 500;
		line-height: 1;
		min-width: 1.6rem;
		justify-content: center;
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
	}

	/* "Experimental" stamp used by features still gated behind a config flag (e.g. Agent Kanban,
	 * Visualizations treemap). Uses the editor-warning tone with color-mix so the badge reads as
	 * a heads-up without overwhelming the surrounding chrome. */
	:host([appearance='experimental']) {
		display: inline-flex;
	}

	:host([appearance='experimental']) .badge {
		color: var(--vscode-editorWarning-foreground, var(--color-foreground--65));
		border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, currentColor) 60%, transparent);
		background-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, currentColor) 12%, transparent);
		font-variant: normal;
		font-weight: 600;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.6rem;
		border-radius: 0.3rem;
		align-items: center;
		justify-content: center;
	}
`;
