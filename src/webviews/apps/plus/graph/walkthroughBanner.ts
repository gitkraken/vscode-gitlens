/** Whether the Graph walkthrough banner opens itself rather than waiting for a hover on the
 *  megaphone. Shared by the banner and the coach-mark gate so the tips stay sequenced behind it. */
export function isGraphWalkthroughBannerHighlighted(state: {
	graphWalkthroughBannerCollapsed?: boolean | undefined;
	graphWalkthroughComplete?: boolean | undefined;
	graphWalkthroughStarted?: boolean | undefined;
}): boolean {
	if ((state.graphWalkthroughBannerCollapsed ?? true) || (state.graphWalkthroughComplete ?? false)) return false;

	return !(state.graphWalkthroughStarted ?? false);
}
