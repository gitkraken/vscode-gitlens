import { css } from 'lit';

export const detailsCommitPanelStyles = css`
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
	:host([variant='embedded']) webview-pane::part(header) {
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		padding-right: calc(var(--gl-panel-padding-right) - 0.4rem);
		background-color: inherit;
	}

	:host([variant='embedded']) webview-pane [slot='title'] {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* Add spacing between header and tree generator */
	:host([variant='embedded']) {
		--gl-tree-view-margin-top: -0.2rem;
		--gl-tree-view-filterable-margin-top: -0.4rem;
	}

	/* ── Zone 1: Author header (standalone fallback when panelActions=false) ── */
	:host([variant='embedded']) .author-header {
		display: flex;
		align-items: center;
		padding: 0.8rem var(--gl-panel-padding-right) 0.6rem var(--gl-panel-padding-left);
		gap: 0.6rem;
		flex: none;
		position: sticky;
		top: 0;
		z-index: 10;
		background-color: var(--titlebar-bg, var(--vscode-sideBar-background, var(--color-background)));
	}

	:host([variant='embedded']) .author-header__author {
		--gl-avatar-size: 3.2rem;
		min-width: 0;
		flex: 1;
	}

	/* ── Zone 2: Metadata bar ── */
	:host([variant='embedded']) .metadata-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--gl-panel-padding-right) 0 var(--gl-panel-padding-left);
		gap: 0.6rem;
		flex: none;
		min-height: var(--gl-metadata-bar-min-height);
		font-size: var(--gl-font-sm);
		background-color: var(--gl-metadata-bar-bg);
		border-top: 1px solid var(--gl-metadata-bar-border);
		border-bottom: 1px solid var(--gl-metadata-bar-border);
	}
	:host([variant='embedded']) .metadata-bar:has(+ .reachability) {
		border-bottom: none;
	}

	:host([variant='embedded']) .metadata-bar__left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}
	:host([variant='embedded']) .metadata-bar__left > gl-tooltip,
	:host([variant='embedded']) .metadata-bar__left > gl-popover {
		display: inline-flex;
		flex-shrink: 1;
		min-width: 0;
	}

	:host([variant='embedded']) .metadata-bar__sha {
		flex-shrink: 0;
		font-size: var(--gl-font-base);
	}

	:host([variant='embedded']) .metadata-bar__branch {
		flex: 0 1 auto;
		min-width: 0;
		font-size: var(--gl-font-base);
		color: var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, #4ec9b0);
		text-transform: lowercase;
	}

	:host([variant='embedded']) .metadata-bar__branch-unreachable {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--color-foreground--65);
		font-style: italic;
	}
	:host([variant='embedded']) .metadata-bar__branch-unreachable code-icon {
		--code-icon-size: 12px;
	}

	:host([variant='embedded']) .metadata-bar__branch-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: none;
		background: transparent;
		cursor: pointer;
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
		padding: 0.4rem;
		border-radius: var(--gk-action-radius, 0.3rem);
		color: var(--color-foreground--65);
		font-size: inherit;
		font-family: inherit;
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator:hover {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--color-foreground);
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator:disabled {
		cursor: default;
		opacity: 0.6;
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator:disabled:hover {
		background: transparent;
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator--idle {
		color: var(--color-foreground--50);
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator--warning {
		color: var(--vscode-editorWarning-foreground, #cca700);
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator--error {
		color: var(--vscode-errorForeground, #f48771);
	}
	:host([variant='embedded']) .metadata-bar__branch-indicator code-icon {
		--code-icon-size: 12px;
	}

	:host([variant='embedded']) .metadata-bar__branch-status {
		font-size: var(--gl-font-sm);
	}

	:host([variant='embedded']) .metadata-bar__ref-count {
		font-size: var(--gl-font-micro);
		font-weight: 500;
		color: var(--color-foreground--50);
		flex-shrink: 0;
	}

	:host([variant='embedded']) .metadata-bar__right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		font-weight: 600;
		margin-right: 0.5rem;
	}

	/* Reachability (below metadata bar) */
	:host([variant='embedded']) .reachability {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.2rem var(--gl-panel-padding-right) 0.4rem var(--gl-panel-padding-left);
		font-size: var(--gl-font-base);
		flex: none;
		background-color: var(--gl-metadata-bar-bg);
		border-bottom: 1px solid var(--gl-metadata-bar-border);
	}

	:host([variant='embedded']) .reachability__load-all {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-left: auto;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 0.4rem;
		color: var(--color-foreground);
		border-radius: var(--gk-action-radius, 0.3rem);
	}
	:host([variant='embedded']) .reachability__load-all:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}
	:host([variant='embedded']) .reachability__load-all code-icon {
		--code-icon-size: 16px;
	}

	/* ── Zone 3: Message ── */
	:host([variant='embedded']) .message {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 0.8rem var(--gitlens-scrollbar-gutter-width) 0 var(--gl-panel-padding-left);
		overflow: hidden;
	}

	:host([variant='embedded']) .message .message-block {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		border: none;
		background: none;
		padding: 0;
		border-radius: 0;
	}

	:host([variant='embedded']) .message .message-block__text {
		--_fade-bg: var(--titlebar-bg, var(--color-background));

		max-height: none;
		overflow-y: auto;
		scroll-timeline: --msg-scroll block;
		flex: 1;
		min-height: 0;
		padding-bottom: 0.6rem;

		/* Scrollbar: fade in on hover/focus, hidden otherwise */
		border-color: transparent;
		transition: border-color 1s linear;
	}
	:host([variant='embedded']) .message .message-block__text:hover,
	:host([variant='embedded']) .message .message-block__text:focus-within {
		border-color: var(--vscode-scrollbarSlider-background);
		transition: none;
	}

	:host([variant='embedded']) .message .message-block__text::-webkit-scrollbar-thumb {
		background-color: transparent;
		border-color: inherit;
		border-right-style: inset;
		border-right-width: calc(100vw + 100vh);
	}
	:host([variant='embedded']) .message .message-block__text::-webkit-scrollbar-thumb:hover {
		border-color: var(--vscode-scrollbarSlider-hoverBackground);
	}
	:host([variant='embedded']) .message .message-block__text::-webkit-scrollbar-thumb:active {
		border-color: var(--vscode-scrollbarSlider-activeBackground);
	}

	:host([variant='embedded']) .message .message-block__text::before,
	:host([variant='embedded']) .message .message-block__text::after {
		content: '';
		display: block;
		position: sticky;
		z-index: 1;
		pointer-events: none;
		opacity: 0;
		animation: linear both;
		animation-timeline: --msg-scroll;
	}
	:host([variant='embedded']) .message .message-block__text::before {
		top: 0;
		height: 2.4rem;
		margin-bottom: -2.4rem;
		background: linear-gradient(to bottom, var(--_fade-bg) 25%, transparent);
		animation-name: scroll-fade-in;
	}
	:host([variant='embedded']) .message .message-block__text::after {
		bottom: -0.6rem;
		height: 3.6rem;
		margin-top: -3.6rem;
		background: linear-gradient(to top, var(--_fade-bg) 25%, transparent);
		animation-name: scroll-fade-out;
	}

	:host([variant='embedded']) .message .message-block__text strong {
		font-size: var(--gl-font-lg);
		display: block;
		margin-bottom: 0.2rem;
	}

	:host([variant='embedded']) .message .message-block__copy {
		position: sticky;
		top: 0;
		z-index: 2;
		display: block;
		width: fit-content;
		margin-left: auto;
		margin-right: -0.4rem;
		margin-bottom: -2.4rem;
		background: var(--titlebar-bg, var(--color-background));
		padding: 0.2rem;
		border-radius: 0.3rem;
		opacity: 1;
		transition: color 0.15s ease;
	}

	/* ── Zone 4: Autolinks footer ── */
	:host([variant='embedded']) .autolinks {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0.2rem var(--gl-panel-padding-right) 0.4rem var(--gl-panel-padding-left);
		font-size: var(--gl-font-sm);
		flex: none;
	}
	:host([variant='embedded']) .autolinks gl-action-chip[data-action='autolink-settings'] {
		color: var(--color-foreground--65);
		--code-icon-size: 12px;
	}

	:host([variant='embedded']) .autolinks__label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--gl-font-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-foreground--50);
		white-space: nowrap;
	}
	:host([variant='embedded']) .autolinks__label code-icon {
		opacity: 0.5;
	}

	/* ── Zone 5: AI input ── */
	:host([variant='embedded']) gl-ai-input {
		width: calc(100% - var(--gl-panel-padding-left) - var(--gl-panel-padding-right));
		max-width: var(--gl-max-input);
		margin: 0.2rem auto;
	}

	/* ── Zone 6: Bottom section (split panel end slot) ── */
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

	/* ── Scroll fade keyframes ── */
	@keyframes scroll-fade-in {
		0% {
			opacity: 0;
		}
		1%,
		100% {
			opacity: 1;
		}
	}

	@keyframes scroll-fade-out {
		0%,
		95% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
`;
