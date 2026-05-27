import { css } from 'lit';

export const detailsWipPanelStyles = css`
	:host([variant='embedded']) {
		--gl-tree-view-margin-top: -0.2rem;
		--gl-tree-view-filterable-margin-top: -0.4rem;
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
		height: 100%;
		min-height: 4.4rem;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* File list wrapper */
	:host([variant='embedded']) .files {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		margin-top: 0.4rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
	}

	/* Explain input override */
	:host([variant='embedded']) .explain-input {
		flex: 1;
		width: 0;
		min-width: 0;
		max-width: none;
		margin: 0;
		padding: 0.4rem 0.7rem;
		font-size: var(--vscode-font-size);
		font-family: var(--vscode-font-family);
		color: var(--vscode-input-foreground);
		background: transparent;
		border: none !important;
		outline: none;
	}
	:host([variant='embedded']) .explain-input::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}

	/* Child Shadow DOM component overrides */
	/* !important is required: webview-pane's own .header rule (specificity 0,1,0) outranks this
	   ::part() selector, so without it webview-pane's default border-top bleeds through. */
	:host([variant='embedded']) webview-pane::part(header) {
		border-top: none !important;
		padding-right: calc(var(--gl-panel-padding-right) - 0.4rem);
		background-color: inherit;
	}

	:host([variant='embedded']) webview-pane [slot='title'] {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* ── WIP-specific embedded header ── */
	:host([variant='embedded']) .header {
		display: flex;
		flex-direction: column;
		flex: none;
		background-color: var(--vscode-sideBarSectionHeader-background, var(--color-background--level-05));
	}

	:host([variant='embedded']) .header__identity {
		display: flex;
		align-items: center;
		padding: 0.8rem var(--gl-panel-padding-right) 0.4rem var(--gl-panel-padding-left);
		gap: 0.6rem;
	}

	:host([variant='embedded']) .header__wip-icon {
		--code-icon-size: 24px;
		width: 3.2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-foreground--50);
	}

	:host([variant='embedded']) .header__wip-title {
		font-weight: 500;
		font-size: var(--gl-font-base);
		color: var(--vscode-gitlens-decorations-worktreeUncommittedForeground, #e2c08d);
	}

	:host([variant='embedded']) .header__wip-subtitle {
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	:host([variant='embedded']) .header__identity-left {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	:host([variant='embedded']) .header__identity-right {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	:host([variant='embedded']) .header__branch-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.2rem 1rem 0.6rem 1.2rem;
		gap: 0.6rem;
	}

	:host([variant='embedded']) .header__branch-pill {
		font-size: var(--gl-font-base);
		max-width: 20rem;
	}

	.paused-op {
		display: flex;
		align-items: center;
		padding: 0.4rem 1rem;
	}

	:host([variant='embedded']) .header .paused-op {
		padding: 0.2rem 1rem 0.6rem 1.2rem;
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
		background-color: transparent !important;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem 0;
	}
`;
