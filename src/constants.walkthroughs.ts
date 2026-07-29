export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'kepler'
	| 'mcpFeatures'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	visualizeCodeHistory: 'Visualize Code History',
	aiFeatures: 'AI Features',
	gitBlame: 'Inline Blame',
	prReviews: 'Launchpad',
	kepler: 'Kepler',
	mcpFeatures: 'MCP Features',
};

export type GraphWalkthroughContextKeys =
	| 'graphAgentMonitoring'
	| 'graphParallelWork'
	| 'graphAiReview'
	| 'graphCompose'
	| 'graphCompare'
	| 'graphNextSteps';

export const graphWalkthroughProgressSteps: Record<GraphWalkthroughContextKeys, string> = {
	graphAgentMonitoring: 'Monitor Your Agents',
	graphParallelWork: 'Manage Parallel Work',
	graphAiReview: 'Review Changes with AI',
	graphCompose: 'Compose Commits',
	graphCompare: 'Compare Refs',
	graphNextSteps: 'Know Your Next Steps',
};

/**
 * Progress of the main (7-step) GitLens walkthrough.
 */
export interface WalkthroughProgress {
	readonly doneCount: number;
	readonly allCount: number;
	readonly progress: number;
	readonly state: Record<WalkthroughContextKeys, boolean>;
}

/**
 * Progress of the graph-specific (6-step) walkthrough.
 */
export interface GraphWalkthroughProgress {
	readonly doneCount: number;
	readonly allCount: number;
	readonly progress: number;
	readonly state: Record<GraphWalkthroughContextKeys, boolean>;
}
