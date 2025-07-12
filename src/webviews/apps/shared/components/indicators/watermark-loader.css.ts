import { css } from 'lit';

export const baseStyles = css`
	.container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		margin: auto;
		position: absolute;
		top: 5%;
		bottom: 45%;
		left: 0;
		right: 0;
	}

	::slotted(p) {
		padding-top: 1rem;
		color: var(--color-foreground--75);
		font-size: 1.4rem;
	}

	.watermark {
		width: 12rem;
		height: 12rem;
		fill: color-mix(in srgb, var(--color-foreground) 15%, var(--color-background));
		transform-origin: center;
	}
`;

export const pulseStyles = css`
	@keyframes pulse {
		0% {
			transform: scale(0.9);
		}
		50% {
			transform: scale(1.05);
		}
		100% {
			transform: scale(0.9);
		}
	}

	.watermark--pulse .watermark-path {
		transform: scale(0.9);
		animation: pulse 1.8s ease-in-out infinite;
		transform-origin: center;
	}

	/* Stagger the pulse animation for a wave effect on all paths */
	/* Targeting all paths using their order within the SVG */
	.watermark-path:nth-of-type(1) {
		/* Target the outer circle path */
		animation-delay: 0.2s;
	}

	.watermark-path:nth-of-type(2) {
		/* Target the connection path */
		animation-delay: 0.4s;
	}

	.watermark-path:nth-of-type(3) {
		/* Target the first dot path */
		animation-delay: 0.1s;
	}

	.watermark-path:nth-of-type(4) {
		/* Target the second dot path */
		animation-delay: 0.1s;
	}

	.watermark-path:nth-of-type(5) {
		/* Target the third dot path */
		animation-delay: 0.1s;
	}
`;
