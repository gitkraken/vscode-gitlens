export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	visualizeCodeHistory: 'Visualize Code History',
	gitBlame: 'File Blame',
	prReviews: 'PR Reviews',
	aiFeatures: 'AI Features',
};
