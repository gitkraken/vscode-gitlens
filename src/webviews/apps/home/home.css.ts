import { css } from 'lit';

export const homeBaseStyles = css`
	* {
		box-sizing: border-box;
	}

	:not(:defined) {
		visibility: hidden;
	}

	[hidden] {
		display: none !important;
	}

	/* roll into shared focus style */
	:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	b {
		font-weight: 600;
	}

	p {
		margin-top: 0;
	}

	ul {
		padding-left: 1.2em;
		margin-top: 0;
	}
`;

export const homeStyles = css`
	.home {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		height: 100vh;
		padding: 0;
		overflow: hidden;
	}

	.home__alerts {
		position: relative;
		flex: none;
		padding: 0 var(--gl-space-20);
	}

	.home__alerts:not([has-alerts]) {
		display: none;
	}

	.home__main {
		flex: 1;
		padding: var(--gl-space-8) var(--gl-space-12);
		overflow: auto;
	}

	.home__main > *:last-child {
		margin-bottom: 0;
	}

	.home__aux,
	.home__header {
		flex: none;
	}

	.home__header {
		padding: var(--gl-space-4);
		border-top: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border);
	}

	.home__aux:has(gl-promo-banner:has(gl-promo:not([has-promo])):only-child) {
		display: none;
	}

	summary {
		font-size: var(--gl-font-base);
		font-weight: normal;
		color: var(--vscode-foreground);
		text-transform: uppercase;
		cursor: pointer;
	}

	details[open] summary {
		margin-block-end: var(--gl-space-8);
	}

	gl-home-header {
		margin: 0;
	}

	gl-repo-alerts:not([has-alerts]) {
		display: none;
	}
`;

export const buttonStyles = css`
	.button-container {
		max-width: 30rem;
		margin: 1rem auto 0;
		text-align: left;
		transition: max-width 0.2s ease-out;
	}

	@media (width >= 640px) {
		.button-container {
			max-width: 100%;
		}
	}

	.button-container--trio > gl-button:first-child {
		margin-bottom: var(--gl-space-4);
	}

	.button-group {
		display: inline-flex;
		gap: var(--gl-space-4);
	}

	.button-group--single {
		width: 100%;
		max-width: 30rem;
	}

	.button-group gl-button {
		margin-top: 0;
	}

	.button-group gl-button:not(:first-child) {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}

	.button-group gl-button:not(:last-child) {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
`;

export const alertStyles = css`
	.alert {
		position: relative;
		padding: var(--gl-space-8) var(--gl-space-12);
		margin-bottom: var(--gl-space-12);
		line-height: 1.2;
		color: var(--color-alert-foreground);
		background-color: var(--color-alert-neutralBackground);
		border-left: 0.3rem solid var(--color-alert-neutralBorder);
	}

	.alert__title {
		margin: 0;
		font-size: var(--gl-font-lg);
	}

	.alert__description {
		margin: var(--gl-space-4) 0 0;
		font-size: var(--gl-font-md);
	}

	.alert__description > :first-child {
		margin-top: 0;
	}

	.alert__description > :last-child {
		margin-bottom: 0;
	}

	.alert__close {
		position: absolute;
		top: 0.8rem;
		right: 0.8rem;
		color: inherit;
		opacity: 0.64;
	}

	.alert__close:hover {
		color: inherit;
		opacity: 1;
	}

	.alert.is-collapsed {
		cursor: pointer;
	}

	.alert.is-collapsed:hover {
		background-color: var(--color-alert-neutralHoverBackground);
	}

	.alert.is-collapsed .alert__description,
	.alert.is-collapsed .alert__close gl-tooltip:first-child,
	.alert:not(.is-collapsed) .alert__close gl-tooltip:last-child {
		display: none;
	}

	.alert--info {
		--color-alert-foreground: var(--color-alert-infoForeground);

		background-color: var(--color-alert-infoBackground);
		border-left-color: var(--color-alert-infoBorder);
	}

	.alert--warning {
		--color-alert-foreground: var(--color-alert-warningForeground);

		background-color: var(--color-alert-warningBackground);
		border-left-color: var(--color-alert-warningBorder);
	}

	.alert--danger {
		--color-alert-foreground: var(--color-alert-errorForeground);

		background-color: var(--color-alert-errorBackground);
		border-left-color: var(--color-alert-errorBorder);
	}

	.alert a:not(:hover) {
		color: color-mix(in srgb, var(--color-alert-foreground) 50%, var(--vscode-textLink-foreground));
	}

	.alert a:hover {
		color: color-mix(in srgb, var(--color-alert-foreground) 50%, var(--vscode-textLink-activeForeground));
	}
`;

export const walkthroughProgressStyles = css`
	a,
	a:hover,
	a:focus,
	a:active {
		text-decoration: none;
	}

	.walkthrough-progress {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-2);
		align-items: stretch;
		padding: var(--gl-space-2) var(--gl-space-4) var(--gl-space-4);
		margin-top: var(--gl-space-4);
		cursor: pointer;
		border-radius: var(--gl-radius-sm);
	}

	.walkthrough-progress:focus-within,
	.walkthrough-progress:hover {
		background-color: var(--gl-walkthrough-hover-background);
	}

	.walkthrough-progress__title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--color-foreground--85);
	}

	.walkthrough-progress__button {
		--button-padding: 1px 2px 0px 2px;

		position: absolute;
		right: 0.4rem;
	}

	.walkthrough-progress__bar::-webkit-progress-bar {
		background: var(--color-alert-neutralBackground);
		border-radius: var(--gl-radius-xs);
	}

	.walkthrough-progress__bar::-webkit-progress-value {
		background: var(--vscode-progressBar-background, blue);
		border-radius: var(--gl-radius-xs);
		transition: 0.1s ease-in;
	}

	.walkthrough-progress__bar {
		z-index: 2;
		flex-shrink: 0;
		width: 100%;
		height: 4px;
		pointer-events: none;
		background: unset;
		border-radius: var(--gl-radius-xs);
	}
`;
