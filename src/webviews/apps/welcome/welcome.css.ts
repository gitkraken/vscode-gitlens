import { css } from 'lit';

const colorScheme = css`
	:host {
		--accent-color: #cb64ff;
		--text-color: var(--vscode-descriptionForeground);
		--em-color: var(--vscode-editor-foreground);
		--link-color: var(--vscode-textLink-foreground);

		--hero-gradient: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
	}
`;

const typography = css`
	:host {
		font-size: var(--vscode-font-size);

		--h1-font-size: 1.7em;
		--p-font-size: 1.23em;
		--card-font-size: 1em;
	}

	@media (max-width: 640px) {
		:host {
			font-size: var(--vscode-editor-font-size);
			--h1-font-size: 1em;
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

	@media (max-width: 640px) {
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
		align-items: center;
		text-align: center;
	}
	.section .accent {
		color: var(--accent-color);
	}

	.section.plain p {
		max-width: 30em;
		font-size: var(--p-font-size);
	}
`;

const header = css`
	.logo {
		transform: scale(0.7);
	}
	@media (max-width: 640px) {
		.logo {
			transform: scale(0.5);
		}
	}

	.header {
		margin-top: 3em;
		margin-bottom: 1em;
		max-width: 620px;
		margin-left: auto;
		margin-right: auto;
	}
	.header gitlens-logo {
		transform: translateX(-0.75rem);
	}
	.header h1 {
		margin-bottom: 0;

		font-size: var(--h1-font-size);
		color: var(--em-text-color);
	}
	.header p {
		color: var(--text-color);
	}
`;

const carousel = css`
	gl-feature-carousel {
		text-align: initial;
		--gl-carousel-border-radius: 0.63em;
		--gl-carousel-padding: 1.8em;
		--gl-carousel-background-color: var(--vscode-textBlockQuote-background);
	}

	@media (max-width: 640px) {
		gl-feature-carousel {
			--gl-carousel-padding: 1em;
		}
	}

	@media (max-width: 300px) {
		gl-feature-carousel {
			--gl-carousel-padding: 0.5em;
		}
	}

	gl-feature-carousel h1 {
		margin: 0;
		font-size: var(--card-font-size);
		color: var(--em-color);
	}

	gl-feature-carousel p {
		margin: 0.4em 0 0;
		font-size: var(--card-font-size);
		color: var(--text-color);
	}

	gl-feature-carousel img {
		max-width: 100%;
		height: auto;
	}

	gl-feature-carousel a {
		color: var(--link-color);
		text-decoration: none;
	}
`;

export const welcomeStyles = css`
	${colorScheme} ${typography}
	${heroGradient} ${section} ${header}
	${carousel}
`;
