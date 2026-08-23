import type { GraphWalkthroughProgress } from '../../../../constants.walkthroughs.js';

/** `doneCount >= allCount` — mirrors the host's own progress-complete check. Missing progress reads
 *  as NOT complete. */
function isGraphWalkthroughComplete(progress: GraphWalkthroughProgress | undefined): boolean {
	return progress != null && progress.doneCount >= progress.allCount;
}

/** Whether the Graph walkthrough banner opens itself rather than waiting for a hover on the
 *  megaphone. Shared by the banner and the coach-mark gate so the tips stay sequenced behind it. */
export function isGraphWalkthroughBannerHighlighted(state: {
	/** From `OnboardingDismissals.get('graph-walkthrough:banner')` — undefined (not yet fetched) reads as collapsed. */
	bannerCollapsed: boolean | undefined;
	graphWalkthroughProgress: GraphWalkthroughProgress | undefined;
	graphWalkthroughStarted?: boolean | undefined;
}): boolean {
	if ((state.bannerCollapsed ?? true) || isGraphWalkthroughComplete(state.graphWalkthroughProgress)) return false;

	return !(state.graphWalkthroughStarted ?? false);
}
