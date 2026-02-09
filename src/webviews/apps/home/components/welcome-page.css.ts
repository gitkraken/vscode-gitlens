import { css } from 'lit';

const colorScheme = css`
	:host {
		--accent-color: #cb64ff;
		--text-color: var(--vscode-sideBar-foreground);
		--dimmed-text-color: var(--vscode-descriptionForeground);
		--heading-color: var(--vscode-tab-activeForeground);
		--em-color: var(--vscode-sideBar-foreground);
		--link-color: var(--vscode-textLink-foreground);
		--card-background: var(--vscode-textBlockQuote-background);

		--hero-gradient: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
		--trial-button-gradient: linear-gradient(90deg, #7900c9 0%, #196fff 100%);
		--trial-button-border: none;
		--trial-button-text-color: #fff;
	}

	:host-context(.vscode-light) {
		--hero-gradient: radial-gradient(62.4% 62.4% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
	}

	:host-context(.vscode-dark) {
		--hero-gradient: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
	}

	:host-context(.vscode-high-contrast) {
		--hero-gradient: transparent;
		--trial-button-gradient: var(--color-button-background);
		--trial-button-border: 1px solid var(--vscode-button-border);
		--trial-button-text-color: var(--color-button-foreground);
	}

	:host-context(.vscode-high-contrast-light) {
		--accent-color: #500070;
	}
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) {
		--accent-color: #ffc0ff;
	}
`;

const typography = css`
	:host {
		font-size: var(--vscode-editor-font-size);

		--h1-font-size: 1.7em;
		--p-font-size: 1.23em;
		--card-font-size: 1em;
	}

	@media (max-width: 640px) {
		:host {
			font-size: var(--vscode-editor-font-size);
			--h1-font-size: 1.2em;
			--p-font-size: 1em;
			--card-font-size: 1em;
		}
	}

	@media (max-width: 300px) {
		:host {
			font-size: calc(var(--vscode-editor-font-size) * 0.8);
		}
	}
`;

const main = css`
	:host {
		--page-margin-left: 0px;
		--page-margin-right: 0px;
		display: block;
		height: 100%;
	}

	.welcome {
		max-height: 100%;
		overflow: auto;
		position: relative;
	}
`;

const heroGradient = css`
	.welcome::before {
		content: ' ';
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%) translateY(-40%);
		z-index: -1;

		background: var(--hero-gradient);
		border-radius: 100%;
		opacity: 0.25;
		filter: blur(53px);

		width: 620px;
		height: 517px;
		max-width: 100%;
	}

	@media (max-width: 400px) {
		.welcome::before {
			height: 273px;
		}
	}
`;

const section = css`
	.section {
		display: flex;
		flex-flow: column;
		justify-content: center;
		text-align: center;
		gap: 0.7em;
		margin: 0 auto;
		padding: 1em;
		max-width: 620px;
	}
	.section.section--centered {
		align-items: center;
	}
	.section h1 {
		color: var(--heading-color);
	}
	.section h2 {
		color: var(--heading-color);
		font-weight: normal;
		font-size: var(--p-font-size);
	}

	.section p {
		color: var(--text-color);
		font-size: var(--p-font-size);
	}
	.section > p {
		max-width: 30em;
	}
	.section > p:first-child {
		margin-top: 0;
	}
	.section > p:last-child {
		margin-bottom: 0;
	}

	.section .accent {
		color: var(--accent-color);
	}
	.section a {
		color: var(--link-color);
		text-decoration: none;
	}

	.section ul {
		color: var(--text-color);
		font-size: var(--p-font-size);
	}

	.section gl-button.start-trial-button {
		background: var(--trial-button-gradient);
		border: var(--trial-button-border);
		color: var(--trial-button-text-color);
	}
	.section gl-button {
		width: 100%;
	}

	@media (min-width: 400px) {
		.section gl-button {
			width: initial;
		}
		.section gl-button.start-trial-button {
			--button-padding: 0.4em 4em;
		}
	}
`;

const header = css`
	.section.header {
		align-items: center;
	}
	.header {
		max-width: 620px;
		margin-left: auto;
		margin-right: auto;
	}
	.header gitlens-logo-circle {
		height: calc(46px * 0.6);
		transform: scale(0.6) translate(calc(46px * 0.4), calc(-46px * 0.2));
		margin-right: 0.4em;
		vertical-align: top;
	}
	.header h1 {
		margin: 0;
		font-size: var(--h1-font-size);
	}
	.header h1 + p {
		margin-top: 0;
	}

	@media (max-width: 640px) {
		.header gitlens-logo-circle {
			height: calc(46px * 0.5);
			transform: scale(0.5) translate(calc(46px * 0.5), calc(-46px * 0.25 - 2px));
			margin-right: 0.3em;
		}
	}

	@media (max-width: 300px) {
		.header gitlens-logo-circle {
			height: calc(46px * 0.4);
			transform: scale(0.4) translate(calc(46px * 0.6), calc(-46px * 0.3 - 4px));
			margin-right: 0.2em;
		}
	}
`;

const cards = css`
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.7em;
		border-radius: 0.63em;
		background-color: var(--card-background);
		padding: 1em 2em;
		text-align: initial;
	}

	gl-walkthrough-step.card::part(header) {
		padding: 1em 2em;
		margin: -1em -2em;
	}

	@media (max-width: 300px) {
		.card {
			padding: 0.5em 0.5em;
		}
		gl-walkthrough-step.card::part(header) {
			padding: 0.5em 0.5em;
			margin: -0.5em -0.5em;
		}
	}

	.card h1 {
		margin: 0;
		font-size: var(--card-font-size);
	}

	.card p {
		margin: 0.5em 0 0;
		font-size: var(--card-font-size);
	}

	.card p:last-child {
		margin: 1em 0 0;
	}

	.card ul {
		text-align: initial;
		padding-inline-start: 2em;
		margin: auto;
		font-size: var(--card-font-size);
	}

	.card img {
		max-width: 100%;
	}

	p.card-part--tip {
		color: var(--dimmed-text-color);
	}
	p.card-part--tip em {
		color: var(--em-color);
		font-style: normal;
	}

	gl-walkthrough-step.card {
		text-align: center;
	}
`;

const scrollableFeatures = css`
	gl-scrollable-features {
		--side-shadow-padding: max(var(--page-margin-left), var(--page-margin-right));
		--side-shadow-color: var(--page-background-color);
	}
`;

export const welcomeStyles = css`
	${colorScheme} ${typography} ${main}
	${heroGradient} ${section} ${header}
	${scrollableFeatures}
	${cards}
`;
