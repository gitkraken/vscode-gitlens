import { css } from 'lit';

const colorScheme = css`
	:host {
		--accent-color: #cb64ff;
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

		width: 620px;
		height: 517px;
		max-width: 100%;

		border-radius: 100%;
		background: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
		opacity: 0.25;
		mix-blend-mode: color;
		filter: blur(53px);
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
	.section p {
		font-size: larger;
		max-width: calc(620px * 0.75);
	}
`;

const header = css`
	.header {
		margin-top: 5rem;
		margin-bottom: 2rem;
		max-width: 620px;
		margin-left: auto;
		margin-right: auto;
	}
	.header gitlens-logo {
		transform: translateX(-0.75rem);
	}
	.header h1 {
		margin-bottom: 0;
	}
`;

const typography = css`
	.accent {
		color: var(--accent-color);
	}
`;

export const welcomeStyles = css`
	${colorScheme}
	${heroGradient} ${section} ${header} ${typography}
`;
