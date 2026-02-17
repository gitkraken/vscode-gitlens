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
