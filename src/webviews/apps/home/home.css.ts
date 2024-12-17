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
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	b {
		font-weight: 600;
	}

	p {
		margin-top: 0;
	}

	ul {
		margin-top: 0;
		padding-left: 1.2em;
	}
`;

export const homeStyles = css`
	.home {
		padding: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		overflow: hidden;
	}

	.home__alerts {
		flex: none;
		padding: 0 2rem;
		position: relative;
	}
	.home__alerts:not([has-alerts]) {
		display: none;
	}

	.home__main {
		flex: 1;
		overflow: auto;
		padding: 0.8rem 1.2rem;
	}
	.home__main > *:last-child {
		margin-bottom: 0;
	}

	.home__aux,
	.home__header {
		flex: none;
	}

	.home__header {
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
		padding: 0.4rem;
	}

	.home__aux:has(gl-promo-banner:not([has-promo]):only-child) {
		display: none;
	}

	summary {
		font-size: 1.3rem;
		font-weight: normal;
		text-transform: uppercase;
		color: var(--vscode-foreground);
		cursor: pointer;
	}

	details[open] summary {
		margin-block-end: 0.8rem;
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
		margin: 1rem auto 0;
		text-align: left;
		max-width: 30rem;
		transition: max-width 0.2s ease-out;
	}

	@media (min-width: 640px) {
		.button-container {
			max-width: 100%;
		}
	}
	.button-container--trio > gl-button:first-child {
		margin-bottom: 0.4rem;
	}

	.button-group {
		display: inline-flex;
		gap: 0.4rem;
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
		padding: 0.8rem 1.2rem;
		line-height: 1.2;
		margin-bottom: 1.2rem;
		background-color: var(--color-alert-neutralBackground);
		border-left: 0.3rem solid var(--color-alert-neutralBorder);
		color: var(--color-alert-foreground);
	}
	.alert__title {
		font-size: 1.4rem;
		margin: 0;
	}
	.alert__description {
		font-size: 1.2rem;
		margin: 0.4rem 0 0;
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
		background-color: var(--color-alert-infoBackground);
		border-left-color: var(--color-alert-infoBorder);
	}
	.alert--warning {
		background-color: var(--color-alert-warningBackground);
		border-left-color: var(--color-alert-warningBorder);
	}
	.alert--danger {
		background-color: var(--color-alert-errorBackground);
		border-left-color: var(--color-alert-errorBorder);
	}
`;

export const navListStyles = css`
	.nav-list {
		margin-left: -2rem;
		margin-right: -2rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		align-items: stretch;
		margin-bottom: 1.6rem;
	}
	.nav-list__item {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.8rem;
		padding: 0.4rem 2rem;
	}
	.nav-list__item:hover,
	.nav-list__item:focus-within {
		background-color: var(--vscode-list-hoverBackground);
		color: var(--vscode-list-hoverForeground);
	}
	.nav-list__item:has(:first-child:focus) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.nav-list__item:has(:active) {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.nav-list__item:has(.is-disabled) {
		cursor: not-allowed;
	}
	.nav-list__link {
		flex: 1;
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.8rem;
		color: inherit;
	}
	.nav-list__link:hover,
	.nav-list__link:focus {
		color: inherit;
		text-decoration: none;
	}
	.nav-list__link:focus {
		outline: none;
	}
	.nav-list__link.is-disabled,
	.nav-list__link.is-disabled:hover {
		opacity: 0.5;
		pointer-events: none;
		text-decoration: none;
	}
	.nav-list__icon {
		flex: none;
		opacity: 0.5;
	}
	.nav-list__label {
		flex: 1;
		font-weight: 600;
	}
	.nav-list__desc {
		color: var(--color-foreground--65);
		font-variant: all-small-caps;
		margin-left: 1rem;
	}
	.nav-list__group {
		width: 100%;
		display: flex;
		justify-content: flex-start;
	}
	.nav-list__group .nav-list__label {
		width: auto;
	}
	.nav-list__access {
		flex: none;
		position: relative;
		left: 1.5rem;
		font-size: x-small;
		outline: none;
		white-space: nowrap;
		--gl-feature-badge-color: color-mix(in srgb, transparent 40%, currentColor);
		--gl-feature-badge-border-color: color-mix(in srgb, transparent 40%, var(--color-foreground--50));
	}
	.nav-list__item:hover .nav-list__label {
		text-decoration: underline;
	}
	.nav-list__item:hover .is-disabled .nav-list__label {
		text-decoration: none;
	}
	.nav-list__item:hover .nav-list__desc {
		color: var(--color-foreground);
	}
	.nav-list__item:focus-within .nav-list__access,
	.nav-list__item:hover .nav-list__access {
		--gl-feature-badge-color: currentColor;
		--gl-feature-badge-border-color: var(--color-foreground--50);
	}
	.nav-list__title {
		padding: 0 2rem;
	}

	.t-eyebrow {
		text-transform: uppercase;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-foreground--50);
		margin: 0;
	}
	.t-eyebrow.sticky {
		top: -8px;
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
		gap: 2px;
		padding: 2px 4px 4px;
		margin-top: 4px;
		align-items: stretch;
		cursor: pointer;
		border-radius: 4px;
	}
	.walkthrough-progress:focus-within,
	.walkthrough-progress:hover {
		background-color: var(--gl-walkthrough-hover-background);
	}

	.walkthrough-progress__title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--color-foreground--85);
	}
	.walkthrough-progress__button {
		--button-padding: 1px 2px 0px 2px;
	}
	.walkthrough-progress__bar::-webkit-progress-bar {
		border-radius: 2px;
		background: var(--color-alert-neutralBackground);
	}
	.walkthrough-progress__bar::-webkit-progress-value {
		background: var(--vscode-progressBar-background, blue);
		transition: 0.1s ease-in;
		border-radius: 2px;
	}
	.walkthrough-progress__bar {
		pointer-events: none;
		border-radius: 2px;
		width: 100%;
		background: unset;
		height: 4px;
		flex-shrink: 0;
		z-index: 2;
	}
`;
