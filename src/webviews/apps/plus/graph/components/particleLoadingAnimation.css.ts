import { css } from 'lit';

/**
 * Stage, scaffold, and particle CSS shared by the graph details' particle "loading" animations.
 * Variants supply only their `--gl-loading-accent` — the geometry, the lens scanline, and the
 * settled-particle treatment are common so the loaders read as one family.
 */
export const particleLoadingAnimationStyles = css`
	:host {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		overflow: hidden;
		opacity: 0;
		transition: opacity 0.6s var(--gl-ease-in);
	}

	:host([data-ready]) {
		opacity: 1;
	}

	.stage {
		position: absolute;
		inset: 0;
	}

	.bucket {
		position: absolute;
		background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, currentcolor 12%, transparent) 100%);
		border-bottom: 0.2rem solid currentcolor;
		border-radius: var(--gl-radius-md);
		opacity: 0.55;
	}

	.lens {
		position: absolute;
		overflow: hidden;
		background: linear-gradient(
			90deg,
			transparent 0%,
			color-mix(in srgb, var(--vscode-foreground) 4%, transparent) 50%,
			transparent 100%
		);
		border-top: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
		border-bottom: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
	}

	.lens__scanline {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent 0%,
			color-mix(in srgb, var(--gl-loading-accent) 70%, transparent) 50%,
			transparent 100%
		);
		animation: gl-particle-scanline 1.4s var(--gl-ease-in-out) infinite alternate;
		will-change: top, opacity;
	}

	.particle {
		position: absolute;
		top: 0;
		left: 0;
		width: 0.8rem;
		height: 0.8rem;
		background: color-mix(in srgb, var(--vscode-foreground) 35%, transparent);
		border-radius: 50%;
		opacity: 0;
		filter: blur(1px);
		will-change: transform, opacity;
	}

	.particle--settled {
		width: 0.6rem;
		height: 0.6rem;
		filter: none;
	}

	@keyframes gl-particle-scanline {
		0% {
			top: 0;
			opacity: 0.35;
		}

		50% {
			opacity: 1;
		}

		100% {
			top: calc(100% - 1px);
			opacity: 0.35;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			display: none;
		}
	}
`;
