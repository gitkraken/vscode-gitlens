export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'homeView'
	| 'visualizeCodeHistory'
	| 'prReviews'
	| 'streamlineCollaboration'
	| 'integrations'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	homeView: 'Home View',
	visualizeCodeHistory: 'Visualize Code History',
	prReviews: 'PR Reviews',
	streamlineCollaboration: 'Streamline Collaboration',
	integrations: 'Integrations',
	aiFeatures: 'AI Features',
};
