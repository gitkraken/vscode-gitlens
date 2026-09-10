import type { CSSResult } from 'lit';
import { css } from 'lit';
import { focusOutline } from '@gitlens/components/components/styles/lit/a11y.css.js';

/**
 * Single-line truncation, as a class instead of the same three declarations re-typed per element.
 *
 * Exported on its own rather than folded into `chipStyles` so a consumer can take the utility without the
 * chip/header/content layout that comes with it: `gl-agents-chip` and `gl-ai-chip` truncate text but are not
 * chips, and `chipStyles` would hand them a `:host { display: flex }` they would immediately have to undo.
 */
export const truncateStyles: CSSResult = css`
	.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`;

/*
 * Deliberately NOT here: a `.row` flex utility for the `display: flex; align-items: center; gap: …` triple
 * that the rollup hand-rolls ~19 times. The gap is the one thing that varies across those rows (2 / 4 / 6 /
 * 8), so nearly every call site would have to override the only declaration the utility exists to supply —
 * leaving a class that saves two lines and hides where the spacing actually comes from.
 */
export const chipStyles = css`
	:host {
		display: flex;
	}

	.chip {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-4);
		cursor: pointer;
		border-radius: var(--gl-radius-sm);
	}

	.chip:focus-visible {
		${focusOutline}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		padding-bottom: var(--gl-space-4);
	}

	.header {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		width: 100%;
		padding-bottom: var(--gl-space-4);
	}

	.header__actions {
		display: flex;
		flex: none;
		flex-direction: row;
		gap: var(--gl-space-2);
		align-items: center;
		justify-content: center;
	}

	/* No single-line truncation here, though it once carried the whole ellipsis triple: neither consumer
	   wanted it. gl-account-chip's title is a name plus badges and overrode it back to wrapping, and
	   gl-merge-target-status slots a paragraph through this element, which nowrap would inherit into and
	   flatten. A consumer that does want it can add .truncate (see truncateStyles). */
	.header__title {
		flex: 1;
		margin: 0;
		font-size: var(--gl-font-lg);
		font-weight: 600;
		line-height: 1.7;

		small {
			color: var(--vscode-descriptionForeground);
		}
	}
`;
