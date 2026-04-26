import type { OnboardingKeys } from '../constants.onboarding.js';
import { onboardingDefinitions } from '../constants.onboarding.js';
import type { Container } from '../container.js';

export type OnboardingSnapshot = readonly OnboardingKeys[];

/**
 * Dismisses every onboarding item that isn't already dismissed and returns the
 * list of keys we dismissed — pass that snapshot to {@link restoreOnboarding}
 * on teardown so we only undo what we touched.
 */
export async function dismissAllOnboarding(container: Container): Promise<OnboardingSnapshot> {
	const dismissedHere: OnboardingKeys[] = [];
	for (const key of Object.keys(onboardingDefinitions) as OnboardingKeys[]) {
		if (!container.onboarding.isDismissed(key, true)) {
			dismissedHere.push(key);
			await container.onboarding.dismiss(key);
		}
	}
	return dismissedHere;
}

export async function restoreOnboarding(container: Container, snapshot: OnboardingSnapshot): Promise<void> {
	for (const key of snapshot) {
		await container.onboarding.reset(key);
	}
}
