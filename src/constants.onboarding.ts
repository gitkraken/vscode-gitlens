import type { OnboardingItemDefinition } from './onboarding/models/onboarding.js';

/** Central registry of all dismissible/onboarding keys */
export const onboardingDefinitions = {
	// Home View
	'home:integrationBanner': { schema: '17.8.0', scope: 'global' },
	'home:walkthrough': {
		schema: '17.8.0',
		scope: 'global',
		state: undefined as unknown as { completedSteps: string[] },
	},

	// MCP Banner (shown in home and graph)
	'mcp:banner': { schema: '17.8.0', scope: 'global' },

	// Rebase Editor
	'rebaseEditor:closeWarning': { schema: '17.8.0', scope: 'global' },

	// Composer
	'composer:onboarding': {
		schema: '17.8.0',
		scope: 'global',
		state: undefined as unknown as { stepReached: number },
	},

	// Views
	'views:scmGrouped:welcome': { schema: '17.8.0', scope: 'global' },
} as const satisfies Record<string, OnboardingItemDefinition<unknown>>;

export type OnboardingKeys = keyof typeof onboardingDefinitions;

/** Extract state type for a specific item key */
export type OnboardingItemState<K extends OnboardingKeys> = (typeof onboardingDefinitions)[K] extends {
	state: infer State;
}
	? State
	: undefined;
