import { css } from 'lit';

const colorScheme = css`
	:host {
		--accent-color: #cb64ff;

		--hero-gradient: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
	}
`;

const typography = css`
	:host {
		--h1-font-size: 1.4rem;
		--p-font-size: 1rem;
	}

	@media (max-width: 640px) {
		:host {
			--h1-font-size: 0.75rem;
			--p-font-size: 0.7rem;
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
	}
	.header p {
		color: var(--vscode-descriptionForeground);
	}
`;

export const welcomeStyles = css`
	${colorScheme} ${typography}
	${heroGradient} ${section} ${header}
`;
