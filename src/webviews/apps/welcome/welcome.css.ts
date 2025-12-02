import { css } from 'lit';

export const welcomeStyles = css`
	.welcome::before {
		content: ' ';
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%) translateY(-40%);
		z-index: -1;

		width: 620px;
		height: 517px;

		border-radius: 100%;
		background: radial-gradient(76.32% 76.32% at 50% 7.24%, #7b00ff 29.72%, rgba(255, 0, 242, 0) 100%);
		opacity: 0.25;
		mix-blend-mode: color;
		filter: blur(53px);
	}
	.welcome__section {
		display: flex;
		flex-flow: column;
		justify-content: center;
		align-items: center;
		text-align: center;
	}
	.welcome__section p {
		font-size: larger;
		max-width: calc(620px * 0.75);
	}

	.welcome__header {
		margin-top: 5rem;
		margin-bottom: 2rem;
		max-width: 620px;
		margin-left: auto;
		margin-right: auto;
	}
	.welcome__header gitlens-logo {
		transform: translateX(-0.75rem);
	}
	.welcome__header h1 {
		margin-bottom: 0;
	}

	.welcome__accent {
		color: #cb64ff;
	}
`;
