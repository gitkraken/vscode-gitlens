import { css } from 'lit';
import { elevatedSurface } from '../../../shared/components/styles/lit/elevation.css.js';

export const graphJumpToastStyles = css`
	:host {
		/* Top-center over the rows area, just below the graph header — see the parent's
		   .graph__graph-column (position: relative). */
		position: absolute;
		top: 1rem;
		left: 50%;
		translate: -50% 0;
		z-index: var(--gl-z-popover);
		display: block;
		/* Percentages resolve against the positioned rows column, so the card never overflows a narrow
		   (sidebar) graph — the message ellipsizes instead while the action stays whole. */
		max-inline-size: min(64rem, calc(100% - 1.6rem));
		pointer-events: none;

		animation: gl-graph-jump-toast-in 180ms ease-out;
	}

	@keyframes gl-graph-jump-toast-in {
		from {
			opacity: 0;
			translate: -50% -0.4rem;
		}
		to {
			opacity: 1;
			translate: -50% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
		}
	}

	.toast {
		--gl-elevation: var(--gl-shadow-popover);
		--gl-elevation-border-color: var(--vscode-editorWidget-border, var(--vscode-widget-border));

		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 1rem 0.7rem 1.2rem;
		background: var(--vscode-editorWidget-background);
		border-radius: var(--gl-radius-md);
		font-size: var(--gl-font-md);
		color: var(--vscode-descriptionForeground);
		pointer-events: auto;
		${elevatedSurface}
	}

	.toast__icon {
		display: flex;
		flex: none;
		align-items: center;
		color: var(--color-foreground--65);
	}

	.toast__message {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* The message TemplateResult marks the target with <strong> (a ref name) or <code> (a sha). */
	.toast__message strong {
		color: var(--vscode-foreground);
		font-weight: 600;
	}

	.toast__message code {
		color: var(--vscode-foreground);
		font-family: var(--vscode-editor-font-family);
	}

	.toast__action {
		flex: none;
		padding: 0.2rem 0.5rem;
		font: inherit;
		font-size: var(--gl-font-md);
		color: var(--vscode-textLink-foreground);
		background: none;
		border: var(--gl-border-width) solid transparent;
		border-radius: var(--gl-radius-sm);
		cursor: pointer;
		transition: color var(--gl-duration-medium) ease;
	}

	.toast__action:hover {
		color: var(--vscode-textLink-activeForeground);
		border-color: var(--vscode-textLink-activeForeground);
	}

	.toast__action:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: 0;
		border-color: var(--vscode-focusBorder);
	}

	.toast__dismiss {
		flex: none;
	}
`;
