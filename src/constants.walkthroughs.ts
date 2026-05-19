export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'homeView'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'mcpFeatures'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	homeView: 'Home View',
	visualizeCodeHistory: 'Visualize Code History',
	aiFeatures: 'AI Features',
	gitBlame: 'Inline Blame',
	prReviews: 'Launchpad',
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
	graphAgentMonitoring: 'Stay on top of every running agent',
	graphParallelWork: 'All your parallel work, in one Graph',
	graphAiReview: 'Review changes with AI in the details panel',
	graphCompose: 'Compose working changes into logical Commits',
	graphCompare: 'Compare any refs from your Graph selection',
	graphNextSteps: 'Always know what to do next',
};
