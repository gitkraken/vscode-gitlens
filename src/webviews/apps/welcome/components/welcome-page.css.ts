import { css } from 'lit';

const colorScheme = css`
	:host {
		--accent-color: #cb64ff;
		--text-color: var(--vscode-sideBar-foreground);
		--dimmed-text-color: var(--vscode-descriptionForeground);
		--heading-color: var(--vscode-tab-activeForeground);
		--em-color: var(--vscode-sideBar-foreground);
		--link-color: var(--vscode-textLink-foreground);
		--card-background: color-mix(in srgb, var(--vscode-descriptionForeground) 13%, var(--color-view-background));

		--hero-gradient: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgb(255 0 242 / 0%) 100%);
		--trial-button-gradient: var(--gl-gradient-brand);
		--trial-button-border: none;
		--trial-button-text-color: #fff;
	}

	:host-context(.vscode-light) {
		--hero-gradient: radial-gradient(62.4% 62.4% at 50% 7.24%, #7b00ff 29.72%, rgb(255 0 242 / 0%) 100%);
	}

	:host-context(.vscode-dark) {
		--hero-gradient: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgb(255 0 242 / 0%) 100%);
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

	@media (width <= 640px) {
		:host {
			font-size: var(--vscode-editor-font-size);
			--h1-font-size: 1.2em;
			--p-font-size: 1em;
			--card-font-size: 1em;
		}
	}

	@media (width <= 300px) {
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
		position: relative;
		max-height: 100%;
		overflow: auto;
	}
`;

const heroGradient = css`
	.welcome::before {
		position: absolute;
		top: 0;
		left: 50%;
		z-index: -1;
		width: 620px;
		max-width: 100%;
		height: 517px;
		content: ' ';
		background: var(--hero-gradient);
		border-radius: 100%;
		opacity: 0.25;
		filter: blur(53px);
		transform: translateX(-50%) translateY(-40%);
	}

	@media (width <= 400px) {
		.welcome::before {
			height: 273px;
		}
	}
`;

const section = css`
	.section {
		display: flex;
		flex-flow: column;
		gap: 0.7em;
		justify-content: center;
		max-width: 620px;
		padding: 1em;
		margin: 0 auto;
		text-align: center;
	}

	.section.section--centered {
		align-items: center;
	}

	.section h1 {
		color: var(--heading-color);
	}

	.section h2 {
		font-size: var(--p-font-size);
		font-weight: normal;
		color: var(--heading-color);
	}

	.section p {
		font-size: var(--p-font-size);
		color: var(--text-color);
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
		font-size: var(--p-font-size);
		color: var(--text-color);
	}

	.section gl-button.start-trial-button {
		color: var(--trial-button-text-color);
		background: var(--trial-button-gradient);
		border: var(--trial-button-border);
	}

	.section gl-button {
		--button-width: 100%;
	}

	@media (width >= 400px) {
		.section gl-button {
			--button-width: initial;
		}

		.section gl-button {
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
		margin-right: auto;
		margin-left: auto;
	}

	.header gitlens-logo-circle {
		width: 0;
		height: calc(46px * 0.6);
		margin-right: 0.4em;
		vertical-align: top;
		transform: scale(0.6) translate(calc(-46px), calc(-46px * 0.2));
	}

	.header h1 {
		margin: 0;
		font-size: var(--h1-font-size);
	}

	.header h1 + p {
		margin-top: 0;
	}

	@media (width <= 640px) {
		.header gitlens-logo-circle {
			height: calc(46px * 0.5);
			margin-right: 0.3em;
			transform: scale(0.5) translate(calc(-46px), calc(-46px * 0.25 - 2px));
		}
	}

	@media (width <= 300px) {
		.header gitlens-logo-circle {
			height: calc(46px * 0.4);
			margin-right: 0.2em;
			transform: scale(0.4) translate(calc(-46px), calc(-46px * 0.3 - 4px));
		}
	}
`;

const cards = css`
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.7em;
		padding: 1.5em;
		text-align: initial;
		background-color: var(--card-background);
		border-radius: 0.63em;
	}

	.card-part--centered {
		align-items: center;
		margin: auto;
		text-align: center;
	}

	gl-walkthrough-step.card::part(header) {
		padding: 1.5em;
		margin: -1.5em;
	}

	@media (width <= 400px) {
		.card-part--centered {
			margin: 0;
		}
	}

	@media (width <= 300px) {
		.card {
			padding: 1em;
		}

		gl-walkthrough-step.card::part(header) {
			padding: 1em;
			margin: -1em;
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
		padding-inline-start: 1em;
		margin: 0.5em 0 0;
		font-size: var(--card-font-size);
		text-align: initial;
	}

	.card img {
		max-width: 100%;
	}

	p.card-part--tip {
		color: var(--dimmed-text-color);
	}

	p.card-part--tip em {
		font-style: normal;
		color: var(--em-color);
	}

	gl-walkthrough-step.card {
		text-align: left;
	}
`;

const scrollableFeatures = css`
	gl-scrollable-features {
		--side-shadow-padding: max(var(--page-margin-left), var(--page-margin-right));
		--side-shadow-color: var(--page-background-color);
	}
`;

const backLink = css`
	.section--back {
		align-items: flex-start;
		text-align: left;
	}

	.section .back-link {
		font-size: var(--card-font-size);
		color: var(--dimmed-text-color);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--vscode-textLink-activeForeground);
		text-decoration: underline;
	}
`;

export const welcomeStyles = [
	colorScheme,
	typography,
	main,
	heroGradient,
	section,
	header,
	scrollableFeatures,
	cards,
	backLink,
];
