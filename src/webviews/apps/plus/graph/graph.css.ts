import { css } from 'lit';

export const graphBaselineStyles = css`
	*,
	*::before,
	*::after {
		box-sizing: border-box;
	}

	[hidden] {
		display: none !important;
	}
`;

export const popoverStyles = css`
	.popover::part(body) {
		padding: 0;
		font-size: var(--vscode-font-size);
	}
`;

export const actionButtonStyles = css`
	.action-button {
		position: relative;
		appearance: none;
		font-family: inherit;
		font-size: 1.2rem;
		line-height: 2.2rem;
		// background-color: var(--color-graph-actionbar-background);
		background-color: transparent;
		border: none;
		color: inherit;
		color: var(--color-foreground);
		padding: 0 0.75rem;
		cursor: pointer;
		border-radius: 3px;
		height: auto;

		display: grid;
		grid-auto-flow: column;
		grid-gap: 0.5rem;
		gap: 0.5rem;
		max-width: fit-content;
	}

	.action-button[disabled] {
		pointer-events: none;
		cursor: default;
		opacity: 1;
	}

	.action-button:hover {
		background-color: var(--color-graph-actionbar-selectedBackground);
		color: var(--color-foreground);
		text-decoration: none;
	}

	.action-button[aria-checked] {
		border: 1px solid transparent;
	}

	.action-button[aria-checked='true'] {
		background-color: var(--vscode-inputOption-activeBackground);
		color: var(--vscode-inputOption-activeForeground);
		border-color: var(--vscode-inputOption-activeBorder);
	}

	.action-button code-icon {
		line-height: 2.2rem;
		vertical-align: bottom;
	}

	.action-button code-icon[icon='graph-line'] {
		transform: translateY(1px);
	}

	.action-button__more {
		font-size: 1rem;
		margin-right: -0.25rem;
	}
	.action-button__more::before {
		margin-left: -0.25rem;
	}

	.action-button__indicator {
		position: absolute;
		bottom: 0.2rem;
		right: 1.5rem;
		display: block;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 100%;
		background-color: var(--vscode-progressBar-background);
	}

	.action-button__small {
		font-size: smaller;
		opacity: 0.6;
		text-overflow: ellipsis;
		overflow: hidden;
	}

	.action-button.is-ahead {
		background-color: var(--branch-status-ahead-background);
	}
	.action-button.is-ahead:hover {
		background-color: var(--branch-status-ahead-hover-background);
	}

	.action-button.is-behind {
		background-color: var(--branch-status-behind-background);
	}
	.action-button.is-behind:hover {
		background-color: var(--branch-status-behind-hover-background);
	}

	.action-button.is-ahead.is-behind {
		background-color: var(--branch-status-both-background);
	}
	.action-button.is-ahead.is-behind:hover {
		background-color: var(--branch-status-both-hover-background);
	}

	.action-button__pill {
	}
	.is-ahead .action-button__pill {
		background-color: var(--branch-status-ahead-pill-background);
	}
	.is-behind .action-button__pill {
		background-color: var(--branch-status-behind-pill-background);
	}
	.is-ahead.is-behind .action-button__pill {
		background-color: var(--branch-status-both-pill-background);
	}
`;

export const graphAppStyles = css`
	.graph {
		display: flex;
		flex-direction: column;
		/* height: calc(100vh - 2px); // shoot me -- the 2px is to stop the vertical scrollbar from showing up */
		gap: 0;
		padding: 0.1rem;
		height: 100vh;
	}

	.graph__header {
		flex: none;
		z-index: 101;
		position: relative;
	}

	.graph__workspace {
		flex: 1 1 auto;
		overflow: hidden;
		contain: content;
	}

	.graph__panes {
		height: 100%;
	}
`;

export const graphHeaderStyles = css`
	.jump-to-ref {
		--button-foreground: var(--color-foreground);
	}
`;

export const graphGateStyles = css`
	gl-feature-gate gl-feature-badge {
		vertical-align: super;
		margin-left: 0.4rem;
		margin-right: 0.4rem;
	}
`;

export const graphWrapperStyles = css`
	.graph-wrapper {
	}
	.graph-wrapper__main {
		overflow: hidden;
		position: relative;
		display: flex;
		flex-direction: row;
	}

	.action-divider {
		display: inline-block;
		width: 0.1rem;
		height: 2.2rem;
		vertical-align: middle;
		background-color: var(--titlebar-fg);
		opacity: 0.4;
		margin-right: 0.2rem;
	}

	.button-group {
		display: flex;
		flex-direction: row;
		align-items: stretch;
	}
	.button-group:hover,
	.button-group:focus-within {
		background-color: var(--color-graph-actionbar-selectedBackground);
		border-radius: 3px;
	}

	.button-group > *:not(:first-child),
	.button-group > *:not(:first-child) .action-button {
		display: flex;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}

	.button-group > *:not(:first-child) .action-button {
		padding-left: 0.5rem;
		padding-right: 0.5rem;
		height: 100%;
	}

	.button-group:hover > *:not(:last-child),
	.button-group:active > *:not(:last-child),
	.button-group:focus-within > *:not(:last-child),
	.button-group:hover > *:not(:last-child) .action-button,
	.button-group:active > *:not(:last-child) .action-button,
	.button-group:focus-within > *:not(:last-child) .action-button {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.minimap-marker-swatch {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border-radius: 2px;
		transform: scale(1.6);
		margin-left: 0.3rem;
		margin-right: 1rem;
	}
	.minimap-marker-swatch[data-marker='localBranches'] {
		background-color: var(--color-graph-minimap-marker-local-branches);
	}

	.minimap-marker-swatch[data-marker='pullRequests'] {
		background-color: var(--color-graph-minimap-marker-pull-requests);
	}

	.minimap-marker-swatch[data-marker='remoteBranches'] {
		background-color: var(--color-graph-minimap-marker-remote-branches);
	}

	.minimap-marker-swatch[data-marker='stashes'] {
		background-color: var(--color-graph-minimap-marker-stashes);
	}

	.minimap-marker-swatch[data-marker='tags'] {
		background-color: var(--color-graph-minimap-marker-tags);
	}

	hr {
		border: none;
		border-top: 1px solid var(--color-foreground--25);
	}

	.md-code {
		background: var(--vscode-textCodeBlock-background);
		border-radius: 3px;
		padding: 0px 4px 2px 4px;
		font-family: var(--vscode-editor-font-family);
	}

	gl-search-box::part(search) {
		--gl-search-input-background: var(--color-graph-actionbar-background);
		--gl-search-input-border: var(--sl-input-border-color);
	}

	sl-option::part(base) {
		padding: 0.2rem 0.4rem;
	}

	sl-option[aria-selected='true']::part(base),
	sl-option:not([aria-selected='true']):hover::part(base),
	sl-option:not([aria-selected='true']):focus::part(base) {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	sl-option::part(checked-icon) {
		display: none;
	}

	sl-select::part(listbox) {
		padding-block: 0.2rem 0;
		width: max-content;
	}

	sl-select::part(combobox) {
		--sl-input-background-color: var(--color-graph-actionbar-background);
		--sl-input-color: var(--color-foreground);
		--sl-input-color-hover: var(--color-foreground);
		padding: 0 0.75rem;
		color: var(--color-foreground);
		border-radius: var(--sl-border-radius-small);
	}

	sl-select::part(display-input) {
		field-sizing: content;
	}

	sl-select::part(expand-icon) {
		margin-inline-start: var(--sl-spacing-x-small);
	}

	sl-select[open]::part(combobox) {
		background-color: var(--color-graph-actionbar-background);
	}
	sl-select:hover::part(combobox),
	sl-select:focus::part(combobox) {
		background-color: var(--color-graph-actionbar-selectedBackground);
	}
`;

export const branchActionsStyles = css`
	.pill {
		display: inline-block;
		padding: 0.2rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 500;
		line-height: 1.2;
		text-transform: uppercase;
		color: var(--vscode-foreground);
		background-color: var(--vscode-editorWidget-background);
	}
	.pill .codicon[class*='codicon-'] {
		font-size: inherit !important;
		line-height: inherit !important;
	}
`;

export const graphContainerStyles = css`
	.gk-graph {
		--fs-1: 1.1rem;
		--fs-2: 1.3rem;
	}

	.gk-graph.bs-tooltip {
		z-index: 1040;
	}

	/* TODO: move this to host-side */
	.graph-icon {
		font: normal normal normal 14px/1 codicon;
		display: inline-block;
		text-decoration: none;
		text-rendering: auto;
		text-align: center;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		user-select: none;
		-webkit-user-select: none;
		-ms-user-select: none;

		vertical-align: middle;
		line-height: 2rem;
		letter-spacing: normal;
	}
	.graph-icon.mini-icon {
		font-size: 1rem;
		line-height: 1.6rem;
	}

	.icon {
	}
	.icon--head::before {
		/* codicon-vm */
		font-family: codicon;
		content: '\ea7a';
	}
	.icon--remote::before {
		/* codicon-cloud */
		font-family: codicon;
		content: '\ebaa';
	}
	.icon--remote-github::before,
	.icon--remote-githubEnterprise::before {
		/* codicon-github-inverted */
		font-family: codicon;
		content: '\eba1';
	}
	.icon--remote-gitlab::before,
	.icon--remote-gitlabSelfHosted::before {
		/* glicon-provider-gitlab */
		font-family: 'glicons';
		content: '\f123';
	}
	.icon--remote-bitbucket::before,
	.icon--remote-bitbucketServer::before {
		/* glicon-provider-bitbucket */
		font-family: 'glicons';
		content: '\f11f';
	}
	.icon--remote-azureDevops::before {
		/* glicon-provider-azdo */
		font-family: 'glicons';
		content: '\f11e';
	}
	.icon--tag::before {
		/* codicon-tag */
		font-family: codicon;
		content: '\ea66';
	}
	.icon--stash::before {
		/* codicon-inbox */
		font-family: codicon;
		content: '\eb09';
	}
	.icon--check::before {
		/* codicon-check */
		font-family: codicon;
		content: '\eab2';
	}
	.icon--warning {
		color: #de9b43;
	}
	.icon--warning :before {
		/* codicon-vm */
		font-family: codicon;
		content: '\ea6c';
	}
	.icon--added::before {
		/* codicon-add */
		font-family: codicon;
		content: '\ea60';
	}
	.icon--modified::before {
		/* codicon-edit */
		font-family: codicon;
		content: '\ea73';
	}
	.icon--deleted::before {
		/* codicon-dash */
		font-family: codicon;
		content: '\eacc';
	}
	.icon--renamed::before {
		/* codicon-file */
		font-family: codicon;
		content: '\eb60';
	}
	.icon--resolved::before {
		/* codicon-pass-filled */
		font-family: codicon;
		content: '\ebb3';
	}
	.icon--hide::before {
		/* codicon-eye-closed */
		font-family: codicon;
		content: '\eae7';
	}
	.icon--show::before {
		/* codicon-eye */
		font-family: codicon;
		content: '\ea70';
	}
	.icon--pull-request::before {
		/* codicon-git-pull-request */
		font-family: codicon;
		content: '\ea64';
	}
	.icon--upstream-ahead::before {
		/* codicon-arrow-up */
		font-family: codicon;
		content: '\eaa1';
	}
	.icon--upstream-behind::before {
		/* codicon-arrow-down */
		font-family: codicon;
		content: '\ea9a';
	}

	.icon--settings::before {
		/* codicon-settings-gear */
		font-family: codicon;
		content: '\eb51';
	}

	.icon--branch::before {
		/* codicon-git-branch */
		font-family: codicon;
		content: '\ea68';
		top: 0px;
		margin: 0 0 0 0;
	}

	.icon--graph::before {
		/* glicon-graph */
		font-family: glicons;
		content: '\f102';
	}

	.icon--commit::before {
		/* codicon-git-commit */
		font-family: codicon;
		content: '\eafc';
		top: 0px;
		margin: 0 0 0 0;
	}

	.icon--author::before {
		/* codicon-account */
		font-family: codicon;
		content: '\eb99';
	}

	.icon--datetime::before {
		/* glicon-clock */
		font-family: glicons;
		content: '\f11d';
	}

	.icon--message::before {
		/* codicon-comment */
		font-family: codicon;
		content: '\ea6b';
	}

	.icon--changes::before {
		/* codicon-request-changes */
		font-family: codicon;
		content: '\eb43';
	}

	.icon--files::before {
		/* codicon-file */
		font-family: codicon;
		content: '\eb60';
	}

	.icon--worktree::before {
		/* glicon-repositories-view */
		font-family: glicons;
		content: '\f10e';
	}

	.gk-graph:not(.ref-zone):not([role='tooltip']) {
		flex: 1 1 auto;
		position: relative;
	}
`;
