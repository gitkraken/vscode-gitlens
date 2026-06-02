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

	/* Secondary actions (terminal / jump / refresh / open-on-remote …) form their own flex
	   cluster, set off from the primary group (compose / review / compare) by a slightly
	   larger gap. Making the slot itself the flex container keeps the secondary chips tightly
	   spaced among themselves while the leading margin (+ the 0.2rem parent gap) widens only
	   the inter-group seam. Collapsed out of flow entirely until the slot actually receives
	   content (has-actions, set via slotchange) so it never reserves trailing space on the
	   right — e.g. the comparison panel, which slots no secondary actions. */
	.details-header__actions-secondary {
		display: none;
	}

	.details-header__actions-secondary.has-actions {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		margin-inline-start: 0.4rem;
	}

	/* Mode-toggle label collapse, staggered.
	   The chip's slotted label is a normal child of <gl-action-chip> in this template,
	   so we target it via descendant selectors. Hiding the slotted span with display:none
	   cleanly removes the flex item and its surrounding gap inside the chip — yielding
	   a true icon-only state instead of clipped/ellipsed text. The active chip is exempt
	   so the selected mode keeps its label visible. Compare yields first, then Review,
	   then Compose. */
	@container gl-action-chip-host (max-width: 380px) {
		.mode-toggle--compare .mode-toggle__text {
			display: none;
		}
	}

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
