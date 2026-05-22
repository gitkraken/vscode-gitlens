import type { OnboardingItemDefinition } from './onboarding/models/onboarding.js';

/** Central registry of all dismissible/onboarding keys */
export const onboardingDefinitions = {
	// Home View
	'home:integrationBanner': { schema: '17.8.0', scope: 'global' },
	'home:walkthrough': { schema: '17.8.0', scope: 'global' },

	// MCP Banner (shown in home and graph)
	'mcp:banner': { schema: '17.8.0', scope: 'global' },

	// AI Hooks Banner (shown in home and graph when MCP banner is hidden)
	'hooks:banner': { schema: '17.12.0', scope: 'global' },

	// Rebase Editor
	'rebaseEditor:closeWarning': { schema: '17.8.0', scope: 'global' },

	// Composer
	'composer:onboarding': {
		schema: '17.9.0',
		scope: 'global',
		reshowAfter: '17.9.0',
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		state: undefined as unknown as { stepReached: number },
	},

	// Graph Visualizations Toggle (first-interaction callout)
	'graph:visualizations:buttonCallout': { schema: '18.0.0', scope: 'global' },

	// Graph Walkthrough Banner
	'graph-walkthrough:banner': {
		schema: '18.0.0',
		scope: 'global',
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
