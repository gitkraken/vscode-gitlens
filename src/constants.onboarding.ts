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
		// oxlint-disable-next-line typescript/no-unnecessary-type-assertion
		state: undefined as unknown as { stepReached: number },
	},

	// Graph Visualizations Toggle (first-interaction callout)
	'graph:visualizations:buttonCallout': { schema: '18.0.0', scope: 'global' },

	// Graph Kanban Toggle (first-interaction callout)
	'graph:kanban:buttonCallout': { schema: '18.2.0', scope: 'global' },

	// Graph side bar Pull Requests panel (first-interaction callout)
	'graph:sidebar:pullRequests:callout': { schema: '18.5.0', scope: 'global' },

	// Graph side bar Agents panel (first-interaction callout)
	'graph:sidebar:agents:callout': { schema: '18.5.0', scope: 'global' },

	// Graph Layout Prompt (one-time layout choice on first entry to the Graph view)
	'graph:layoutPrompt': { schema: '18.4.0', scope: 'global' },

	// Graph Coach Marks (contextual feature popovers, #5516)
	// Aggregate "already shown" set; the per-mark keys below carry the permanent "Got it" dismissal.
	'graph:coachMarks': {
		schema: '18.2.0',
		scope: 'global',
		// oxlint-disable-next-line typescript/no-unnecessary-type-assertion
		state: undefined as unknown as { seen: Partial<Record<string, true>> },
	},
	'graph:coachMark:details': { schema: '18.2.0', scope: 'global' },
	'graph:coachMark:compose': { schema: '18.2.0', scope: 'global' },
	'graph:coachMark:review': { schema: '18.2.0', scope: 'global' },
	'graph:coachMark:conflicts': { schema: '18.2.0', scope: 'global' },
	'graph:coachMark:resolve': { schema: '18.2.0', scope: 'global' },
	'graph:coachMark:agents': { schema: '18.2.0', scope: 'global' },
	'graph:coachMark:compare': { schema: '18.2.0', scope: 'global' },
	// Not a tip: records that the marks have already stood down for the walkthrough banner once.
	'graph:coachMarks:bannerDeferral': { schema: '18.2.0', scope: 'global' },

	// Graph Walkthrough Banner
	'graph-walkthrough:banner': {
		schema: '18.0.0',
		scope: 'global',
	},

	// Details Header Toggles (first-interaction callouts)
	'details:compose:buttonCallout': { schema: '18.2.0', scope: 'global' },
	'details:review:buttonCallout': { schema: '18.2.0', scope: 'global' },
	'details:compare:buttonCallout': { schema: '18.2.0', scope: 'global' },
	'details:resolve:buttonCallout': { schema: '18.2.0', scope: 'global' },

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
