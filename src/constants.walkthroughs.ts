export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'mcpFeatures'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	visualizeCodeHistory: 'Visualize Code History',
	aiFeatures: 'AI Features',
	gitBlame: 'Inline Blame',
	prReviews: 'Launchpad',
	mcpFeatures: 'MCP Features',
};
