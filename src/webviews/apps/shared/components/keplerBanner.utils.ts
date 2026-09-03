import type { WalkthroughProgress } from '../../../../constants.walkthroughs.js';

/** Whether the "Get Kepler" banner should show for the given main-walkthrough progress.
 *
 * `undefined` means the host hasn't pushed walkthrough progress yet — that reads as NOT shown (rather
 * than shown-by-default), so the banner never flashes on before the real state arrives.
 *
 * Also suppressed when `onboardingOptedOut` (mirrors `gitlens.advanced.skipOnboarding`) is true — the
 * banner isn't a registered dismissible, so this is how it respects the service-wide onboarding
 * opt-out instead of staying stuck on forever for a user who opted out and has no dismiss button.
 * `undefined` reads as NOT opted out, matching the setting's own default.
 *
 * Also suppressed when `orgDisabledAi` is true — pitching an agentic AI product with no dismiss
 * button to someone an org admin has forbidden from using AI is a dead end. This ONLY covers org
 * policy (`orgEnabled === false`); the user's own `ai.enabled` toggle does NOT suppress the banner,
 * because that one they can flip back on themselves — it isn't a dead end the way org policy is.
 * `undefined` reads as NOT org-disabled, matching each caller's own "no verdict yet" default.
 *
 * Lives here rather than in `kepler-banner.ts` so consumers keep an explicit side-effect import of the
 * component: a host that imported only a named export from the component module would still register
 * the element today, but silently stop the moment that import was refactored away. */
export function shouldShowKeplerBanner(options: {
	progress: WalkthroughProgress | undefined;
	onboardingOptedOut: boolean | undefined;
	orgDisabledAi: boolean | undefined;
}): boolean {
	const { progress, onboardingOptedOut, orgDisabledAi } = options;
	return progress != null && !onboardingOptedOut && !orgDisabledAi && !progress.state.kepler;
}
