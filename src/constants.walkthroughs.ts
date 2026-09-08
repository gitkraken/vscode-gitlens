import * as l10n from '@vscode/l10n';

export type WalkthroughContextKeys =
	| 'gettingStarted'
	| 'visualizeCodeHistory'
	| 'gitBlame'
	| 'prReviews'
	| 'kepler'
	| 'mcpFeatures'
	| 'aiFeatures';

export const walkthroughProgressSteps: Record<WalkthroughContextKeys, string> = {
	gettingStarted: l10n.t('Getting Started'),
	visualizeCodeHistory: l10n.t('Visualize Code History'),
	aiFeatures: l10n.t('AI Features'),
	gitBlame: l10n.t('Inline Blame'),
	prReviews: l10n.t('Launchpad'),
	kepler: l10n.t('Kepler'),
	mcpFeatures: l10n.t('MCP Features'),
};

export type GraphWalkthroughContextKeys =
	| 'graphAgentMonitoring'
	| 'graphParallelWork'
	| 'graphAiReview'
	| 'graphCompose'
	| 'graphCompare'
	| 'graphNextSteps';

export const graphWalkthroughProgressSteps: Record<GraphWalkthroughContextKeys, string> = {
	graphAgentMonitoring: l10n.t('Monitor Your Agents'),
	graphParallelWork: l10n.t('Manage Parallel Work'),
	graphAiReview: l10n.t('Review Changes with AI'),
	graphCompose: l10n.t('Compose Commits'),
	graphCompare: l10n.t('Compare Refs'),
	graphNextSteps: l10n.t('Know Your Next Steps'),
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
