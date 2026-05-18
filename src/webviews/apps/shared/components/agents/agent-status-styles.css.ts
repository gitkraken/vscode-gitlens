import { css } from 'lit';

/** Working-state "[tools icon] Bash(grep …)" detail styling. Reused by the graph card,
 *  the popover hover row, and the status-pill summary row so all three render an active
 *  tool call identically. Each consumer applies the class on the outermost row span
 *  (e.g. `card__tool`, `section__hover-tool`) alongside this shared rule. */
export const agentToolStyles = css`
	.agent-tool {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}

	.agent-tool__icon {
		flex: none;
		transform: translateY(0.15em);
	}

	.agent-tool__text {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--vscode-editor-font-family, monospace);
	}
`;

/** Elapsed-time pill ("· 55s") inside phase labels that carry `text-transform: uppercase`.
 *  Strips the uppercase transform so digits don't read as multiple of the same character
 *  (e.g. `55S` looks like three fives), without losing the uppercase rhythm of the
 *  surrounding phase label. */
export const agentPhaseElapsedStyles = css`
	.agent-phase-elapsed {
		text-transform: none;
		letter-spacing: 0;
		font-weight: normal;
	}
`;
