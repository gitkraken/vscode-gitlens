import type { CSSResult } from 'lit';
import { css } from 'lit';
import { focusOutline } from '@gitlens/components/components/styles/lit/a11y.css.js';

/**
 * Whole-row target for the Graph account rollup — every region is one band, not a shrink-wrapped chip, so
 * the popover has a single hover model no matter which component draws the row's insides.
 *
 * Shared rather than local to `gl-graph-account-indicator` because the account chip had already grown a
 * parallel implementation of the same row (its `.ai` class) with its own padding and an extra
 * `text-decoration: none` reset, and the two drifted. Rows now come from here so there is one.
 *
 * Note the missing underline reset for `:hover`: a consumer that also pulls in `linkBase` needs it
 * repeated on its own row class, since `a:hover` (0,1,1) out-specifies this bare class (0,1,0).
 */
export const rollupItemStyles: CSSResult = css`
	.rollup__item {
		display: block;
		padding: var(--gl-space-4);
		color: inherit;
		text-decoration: none;
		border-radius: var(--gl-radius-sm);
	}

	.rollup__item:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}

	.rollup__item:focus-visible {
		${focusOutline}
	}

	/* Forced-colors strips backgrounds, so the hover has no channel at all — repaint it as an
	   outline. Highlight is the system color for active/selected UI. */
	@media (forced-colors: active) {
		.rollup__item:hover,
		.rollup__item:focus-visible {
			outline: var(--gl-border-width) solid Highlight;
		}
	}
`;
