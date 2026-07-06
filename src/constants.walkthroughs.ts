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
