import type { OnboardingItemState, OnboardingKeys } from '../constants.onboarding.js';

/**
 * Migrations are maps of GitLens version → migration function
 * Each migration transforms data from the previous schema to the version's schema
 * Migrations run in semver order for all versions between stored and current schema
 */
export type OnboardingMigration<T> = Record<`${number}.${number}.${number}`, (state: unknown) => T>;

export const onboardingMigrations: {
	[K in OnboardingKeys]?: OnboardingMigration<OnboardingItemState<K>>;
} = {
	'composer:onboarding': {
		'17.8.0': (state: unknown) => {
			const s = state as { stepReached?: number } | undefined;
			return { stepReached: s?.stepReached ?? 0 };
		},
	},
	'home:walkthrough': {
		'17.8.0': (state: unknown) => {
			const s = state as { completedSteps?: string[] } | undefined;
			return { completedSteps: s?.completedSteps ?? [] };
		},
	},
};
