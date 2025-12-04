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
		--h1-font-size: 1.4rem;
		--p-font-size: 1rem;
		--card-font-size: var(--vscode-font-size);
	}

	@media (max-width: 640px) {
		:host {
			--h1-font-size: 0.75rem;
			--p-font-size: 0.7rem;
			--card-font-size: var(--vscode-editor-font-size);
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
		font-size: var(--p-font-size);
	}
	.section p {
		max-width: 30em;
	}
	.section .accent {
		color: var(--accent-color);
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
		--gl-carousel-border-radius: 0.65rem;
		--gl-carousel-background-color: var(--vscode-textBlockQuote-background);
	}

	gl-feature-carousel h1 {
		margin: 0;
		font-size: var(--card-font-size);
		color: var(--em-color);
	}

	gl-feature-carousel p {
		margin: 0.4em 0;
		font-size: var(--card-font-size);
		color: var(--text-color);
	}

	gl-feature-carousel img {
		max-width: 100%;
		height: auto;
		border-radius: 0.4rem;
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
