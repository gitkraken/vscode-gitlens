export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'homeView'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'streamlineCollaboration'
	| 'integrations'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: 'Getting Started',
	homeView: 'Home View',
	visualizeCodeHistory: 'Visualize Code History',
	gitBlame: 'File Blame',
	prReviews: 'Launchpad',
	streamlineCollaboration: 'Streamline Collaboration',
	integrations: 'Integrations',
	aiFeatures: 'AI Features',
};
