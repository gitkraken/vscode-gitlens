import { css } from 'lit';

export const integrationRowStyles = css`
	:host-context(.vscode-dark),
	:host-context(.vscode-high-contrast) {
		--status-color--connected: #0d0;
	}

	:host-context(.vscode-light),
	:host-context(.vscode-high-contrast-light) {
		--status-color--connected: #0a0;
	}

	.status--connected:not(.is-locked) .status-indicator {
		color: var(--status-color--connected);
	}

	gl-tooltip.status-indicator {
		margin-right: var(--gl-space-4);
	}

	.integrations {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		width: 100%;
	}

	.integration-toggle {
		margin-block-end: calc(var(--gl-space-8) * -1);
		text-align: right;

		button {
			padding: 0;
			font-size: var(--gl-font-sm);
			color: var(--vscode-descriptionForeground);
			appearance: none;
			cursor: pointer;
			background: none;
			border: none;
		}

		strong {
			color: var(--color-foreground);
		}

		button:hover span {
			color: var(--color-link-foreground);
		}
	}

	.integration-row {
		display: flex;
		gap: var(--gl-space-10);
		align-items: center;
	}

	.status--disconnected .integration__icon {
		color: var(--color-foreground--25);
	}

	.integration__content {
		display: block;
		flex: 1 1 auto;
	}

	.integration__title {
		display: flex;
		justify-content: space-between;
	}

	.integration__title gl-feature-badge {
		vertical-align: super;
	}

	.integration__details {
		display: block;
		font-size: var(--gl-font-micro);
		color: var(--color-foreground--75);
	}

	.status--disconnected .integration__title,
	.status--disconnected .integration__details {
		color: var(--color-foreground--50);
	}

	.integration__actions {
		display: flex;
		flex: none;
		flex-direction: row;
		gap: var(--gl-space-2);
		align-items: center;
		justify-content: flex-end;
	}
`;
