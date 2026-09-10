import type { CSSResult } from 'lit';
import { css } from 'lit';

/**
 * The Graph account rollup's raised-surface tone — one step off the sidebar ground, used for anything that
 * has to read as sitting ON the panel rather than in it (the collapsed account chip's fill and outline, and
 * both skeletons).
 *
 * Shared because it had been independently reinvented under two unrelated names that resolved to the same
 * value in every theme: `--gl-account-chip-color` in `gl-account-chip` (which also used it as the chip's own
 * background, so it was never skeleton-specific) and `--gl-chip-skeleton-bg` in `gl-integrations-chip`. Named
 * for what it is rather than for either of the two things that first needed it.
 */
export const rollupSurfaceStyles: CSSResult = css`
	:host-context(.vscode-dark),
	:host-context(.vscode-high-contrast) {
		--gl-rollup-raised: color-mix(in lab, var(--vscode-sideBar-background), #fff 10%);
	}

	:host-context(.vscode-light),
	:host-context(.vscode-high-contrast-light) {
		--gl-rollup-raised: color-mix(in lab, var(--vscode-sideBar-background), #000 7%);
	}
`;

/**
 * The rollup's loading shimmer — the sweeping gradient only, plus the keyframes that drive it.
 *
 * The consumer owns the pill itself: its own width/height, position: relative, overflow: hidden, and its own
 * background-color (default it to --gl-rollup-raised above). That split is deliberate rather than shy — the
 * two skeletons stand in for differently-sized chips (8rem x 2.4rem for the account chip, 9rem x 2.2rem for
 * the integrations strip), and those dimensions were the ONLY thing that differed between the two copies of
 * this rule: the keyframes and the whole gradient were byte-identical.
 *
 * Deliberately NOT the shared skeleton-loader component: that element is width: 100% with a height computed
 * from --skeleton-line-height x --skeleton-lines, i.e. a stand-in for n lines of text, so its only two levers
 * are the wrong ones for a fixed-size pill. The Settings panels do use the component, correctly — they are
 * waiting on text, not on a chip.
 */
export const skeletonStyles: CSSResult = css`
	@keyframes shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	.skeleton::before {
		position: absolute;
		inset: 0;
		content: '';
		background-image: linear-gradient(
			to right,
			transparent 0%,
			var(--color-background--lighten-15) 20%,
			var(--color-background--lighten-30) 60%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: shimmer 2s var(--gl-ease-in-out) infinite;
	}
`;
