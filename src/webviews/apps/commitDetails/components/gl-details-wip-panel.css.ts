import { css } from 'lit';

export const detailsWipPanelStyles = css`
	:host([variant='embedded']) {
		--gl-tree-view-margin-top: -0.2rem;
		--gl-tree-view-filterable-margin-top: -0.4rem;
		--action-item-foreground: var(--vscode-sideBarSectionHeader-foreground);
	}

	/* Split panel layout */
	:host([variant='embedded']) .split {
		flex: 1;
		min-height: 200px;
		overflow: hidden;
		--gl-split-panel-divider-width: 12px;
	}

	:host([variant='embedded']) .split--auto-size:not([dragging]) {
		--gl-split-panel-start-size: fit-content(var(--_start-size, 25%));
	}

	:host([variant='embedded']) .msg-slot {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 4.4rem;
		overflow: hidden;
	}

	/* File list wrapper */
	:host([variant='embedded']) .files {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		padding-right: var(--gl-space-6);
		padding-left: var(--gl-space-6);
		margin-top: var(--gl-space-4);
		overflow: hidden;
	}

	/* Explain input override */
	:host([variant='embedded']) .explain-input {
		flex: 1;
		width: 0;
		min-width: 0;
		max-width: none;
		padding: 0.4rem 0.7rem;
		margin: 0;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-input-foreground);
		outline: none;
		background: transparent;
		border: none !important;
	}

	:host([variant='embedded']) .explain-input::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}

	/* Child Shadow DOM component overrides */

	/* !important is required: webview-pane's own .header rule (specificity 0,1,0) outranks this
	   ::part() selector, so without it webview-pane's default border-top bleeds through. */
	:host([variant='embedded']) webview-pane::part(header) {
		padding-right: calc(var(--gl-panel-padding-right) - 0.4rem);
		background-color: inherit;
		border-top: none !important;
	}

	:host([variant='embedded']) webview-pane [slot='title'] {
		display: inline-flex;
		gap: var(--gl-space-6);
		align-items: center;
	}

	/* ── WIP-specific embedded header ── */
	:host([variant='embedded']) .header {
		display: flex;
		flex: none;
		flex-direction: column;
		background-color: var(--vscode-sideBarSectionHeader-background, var(--color-background--level-05));
	}

	:host([variant='embedded']) .header__identity {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: 0.8rem var(--gl-panel-padding-right) 0.4rem var(--gl-panel-padding-left);
	}

	:host([variant='embedded']) .header__wip-icon {
		--code-icon-size: 24px;

		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 3.2rem;
		color: var(--color-foreground--50);
	}

	:host([variant='embedded']) .header__wip-title {
		font-size: var(--gl-font-base);
		font-weight: 500;
		color: var(--vscode-gitlens-decorations-worktreeUncommittedForeground, #e2c08d);
	}

	:host([variant='embedded']) .header__wip-subtitle {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
	}

	:host([variant='embedded']) .header__identity-left {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	:host([variant='embedded']) .header__identity-right {
		display: flex;
		flex-shrink: 0;
		gap: var(--gl-space-2);
		align-items: center;
	}

	:host([variant='embedded']) .header__branch-row {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: space-between;
		padding: var(--gl-space-2) var(--gl-space-10) var(--gl-space-6) var(--gl-space-12);
	}

	:host([variant='embedded']) .header__branch-pill {
		max-width: 20rem;
		font-size: var(--gl-font-base);
	}

	.paused-op {
		display: flex;
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-10);
	}

	:host([variant='embedded']) .header .paused-op {
		padding: var(--gl-space-2) var(--gl-space-10) var(--gl-space-6) var(--gl-space-12);
	}

	.paused-op > gl-merge-rebase-status {
		flex: 1;
		min-width: 0;
	}

	/* ── Bottom section (split panel end slot) ── */
	:host([variant='embedded']) .bottom-section {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 120px;
		overflow: hidden;
	}

	/* Split panel divider */
	:host([variant='embedded']) .split::part(divider) {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--gl-space-4) 0;
		background-color: transparent !important;
	}
`;
