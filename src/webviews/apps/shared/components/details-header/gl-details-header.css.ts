import { css } from 'lit';

export const detailsHeaderStyles = css`
	:host {
		display: contents;
		color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
	}

	.details-header {
		display: flex;
		flex-direction: column;
		flex: none;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.details-header__row {
		display: flex;
		align-items: flex-start;
		padding: 0.7rem 1.2rem 0.5rem 1.2rem;
		gap: 0.6rem;
		container-type: inline-size;
		container-name: gl-action-chip-host;
	}

	.details-header__content {
		flex: 1;
		min-width: 0;
	}

	.details-header__actions {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	/* Mode-toggle label collapse, staggered.
	   The chip's slotted label is a normal child of <gl-action-chip> in this template,
	   so we target it via descendant selectors. Hiding the slotted span with display:none
	   cleanly removes the flex item and its surrounding gap inside the chip — yielding
	   a true icon-only state instead of clipped/ellipsed text. The active chip is exempt
	   so the selected mode keeps its label visible. Review yields first, then Compose. */
	@container gl-action-chip-host (max-width: 320px) {
		.mode-toggle--review:not(.mode-toggle--active) .mode-toggle__text {
			display: none;
		}
	}

	@container gl-action-chip-host (max-width: 260px) {
		.mode-toggle--compose:not(.mode-toggle--active) .mode-toggle__text {
			display: none;
		}
	}
`;
