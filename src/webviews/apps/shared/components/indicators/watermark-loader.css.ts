import { css } from 'lit';

export const baseStyles = css`
	.container {
		position: absolute;
		inset: 5% 0 45%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		margin: auto;
	}

	::slotted(p) {
		padding-top: 1rem;
		font-size: 1.4rem;
		color: var(--color-foreground--75);
	}

	.watermark {
		position: relative;
		width: 12rem;
		height: 12rem;
	}

	.watermark-piece {
		position: absolute;
		inset: 0;
		transform-origin: center;
	}

	.watermark-piece svg {
		display: block;
		width: 100%;
		height: 100%;
		fill: color-mix(in srgb, var(--color-foreground) 40%, var(--color-background));
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

	/* Animate the HTML wrapper, not the SVG path — Blink composites HTML transforms,
	   but the same animation on SVG sub-elements runs on the main thread. */
	.watermark--pulse .watermark-piece {
		transform: scale(0.9);
		animation: pulse 1.8s ease-in-out infinite;
		will-change: transform;
	}

	/* Stagger the pulse for a wave effect across the watermark pieces. */
	.watermark-piece:nth-of-type(1) {
		animation-delay: 0.2s;
	}

	.watermark-piece:nth-of-type(2) {
		animation-delay: 0.4s;
	}

	.watermark-piece:nth-of-type(3),
	.watermark-piece:nth-of-type(4),
	.watermark-piece:nth-of-type(5) {
		animation-delay: 0.1s;
	}
`;
