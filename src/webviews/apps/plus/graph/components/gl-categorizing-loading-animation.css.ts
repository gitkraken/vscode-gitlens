import { css } from 'lit';

/** Compose shows purple (categorization); review shows yellow (severity). */
export const categorizingLoadingAnimationStyles = css`
	:host {
		--gl-loading-accent: var(--vscode-charts-purple, #c084fc);
	}

	:host([variant='review']) {
		--gl-loading-accent: var(--vscode-charts-yellow, #facc15);
	}
`;
