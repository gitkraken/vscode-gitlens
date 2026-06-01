import { css } from 'lit';

export const fileTreeStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	webview-pane {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	webview-pane[flexible] {
		overflow: hidden;
	}

	gl-tree-view {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		margin-top: var(--gl-tree-view-margin-top, 0);
		--gl-decoration-before-font-size: 0.9em;
		--gl-decoration-before-opacity: 0.8;
		--gl-decoration-after-font-size: 0.9em;
		--gl-decoration-after-opacity: 0.8;
	}
	gl-tree-view[filterable] {
		margin-top: var(--gl-tree-view-filterable-margin-top, var(--gl-tree-view-margin-top, 0));
	}

	/* inline-flex matches the original so webview-pane's .label baseline stays centered.
	   width:100% lets inner children (.checkbox-header__title, badge) ellipse against
	   the .title slot's actual width instead of overflow-clipping at max-content.
	   vertical-align:middle pins the wrapper to the line's vertical middle so its taller
	   contents (checkbox + label + badge) center-align with the action buttons. */
	webview-pane [slot='title'] {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		width: 100%;
		vertical-align: middle;
	}

	/* The Stash button's min-height makes the header taller than .label's fixed
	   2.2rem, and webview-pane's header uses default align-items: stretch which falls
	   back to start (top) for children with an explicit height. That puts .label at
	   the top of the header while .header-actions fills it — visually 3px too high.
	   align-items: center re-centers .label so the title content lines up with the
	   action buttons. */
	/* !important is required: webview-pane's own .header rule (specificity 0,1,0) outranks this
	   ::part() selector (0,0,2), so without it webview-pane's default border-top bleeds through
	   wherever the --gl-file-tree-pane-header-border-top var isn't set (compose/review/etc.). */
	webview-pane::part(header) {
		background-color: inherit;
		border-top: var(--gl-file-tree-pane-header-border-top, none) !important;
		align-items: center;
	}

	.header-actions {
		display: flex;
		align-items: center;
		/* Both gaps are var-driven so consumers (e.g. gl-wip-tree-pane) can collapse them
		   to 0 from their own container queries when the leading action goes icon-only. */
		gap: var(--gl-header-actions-gap, 0.4rem);
	}

	.leading-actions::slotted(*) {
		margin-right: var(--gl-leading-action-trailing-gap, 0.2rem);
	}

	gl-badge {
		font-size: var(--gl-font-micro);
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		/* The slot inside (.badge) has content-box sizing + 4px padding, so width:100%
		   makes it overflow the host by 8px. Clipping at the host pins everything to the
		   visible badge box. */
		overflow: hidden;
	}

	/* Make the badge slot itself overflow-clip so ellipsis at the wrapper text can
	   actually trigger. box-sizing:border-box + width:100% pins the slot inside the
	   host (instead of overflowing 8px due to default content-box + padding). Display
	   stays as the slot's default inline-flex so vertical centering remains intact.
	   !important is needed because the internal .badge class selector (specificity
	   0,1,0) outranks ::part() (0,0,2). */
	gl-badge::part(base) {
		box-sizing: border-box !important;
		width: 100% !important;
		min-width: 0 !important;
		overflow: hidden !important;
	}

	.checkbox-header__badge-text {
		display: block;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The "+N Mixed" sub-badge nested inside the primary staged badge: keep it intact (don't
	   shrink) so the staged text ellipses first under width pressure, and inset it from that text. */
	gl-badge.checkbox-header__badge-mixed {
		flex: 0 0 auto;
		margin-left: 0.4rem;
		overflow: visible;
	}

	.checkbox-header {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 5px 0 5px 2px; /* prevent focus ring from clipping */
		flex: 1 1 auto;
		min-width: 0;
	}

	.checkbox-header gl-checkbox {
		--checkbox-foreground: var(--vscode-sideBarSectionHeader-foreground);
		--checkbox-size: 1.6rem;
		--checkbox-spacing: 0;
		--checkbox-radius: 0.3rem;
		--code-icon-size: 14px;
		margin-block: 0;
		flex-shrink: 0;
	}

	.checkbox-header__label {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--vscode-sideBarSectionHeader-foreground);
		flex: 1 1 auto;
		min-width: 0;
	}

	/* Title yields width before the badge — title clips to ellipsis first, then badge clips.
	   The same shape applies to the non-checkbox header path (.file-tree-pane__title) so
	   multi-commit / commit-details file trees ellipse the title before their badge/stats.
	   display:block is required for text-overflow:ellipsis to actually trigger — when
	   the title sits inside a default <slot> (display:contents), some browsers don't
	   blockify its outer display, leaving it inline. */
	.checkbox-header__title,
	.file-tree-pane__title {
		display: block;
		flex: 0 1 auto;
		min-width: 0;
		flex-shrink: 10;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Active state for the toggle chips (e.g. Show/Hide Search). Inherits the chip's own 0.5rem
	   radius so the active background matches the hover/idle box exactly. */
	gl-action-chip.active-toggle {
		color: var(--vscode-inputOption-activeForeground);
		background-color: var(--vscode-inputOption-activeBackground);
	}
`;
