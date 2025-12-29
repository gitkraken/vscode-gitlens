export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'streamlineCollaboration'
	| 'integrations'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	visualizeCodeHistory: 'Visualize Code History',
	gitBlame: 'File Blame',
	prReviews: 'PR Reviews',
	streamlineCollaboration: 'Streamline Collaboration',
	integrations: 'Integrations',
	aiFeatures: 'AI Features',
};
