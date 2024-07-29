import { Commands } from '../../../../constants';
import type { OnboardingItemConfiguration } from '../../shared/components/onboarding/onboarding-types';

export enum OnboardingItem {
	configuration = 'configuration',
	commitGraph = 'commitGraph',
	gitLens = 'gitLens',
	inspect = 'inspect',
	stashes = 'stashes',
	commits = 'commits',
	branches = 'branches',
	tags = 'tags',
	workTrees = 'workTrees',
	workSpaces = 'workSpaces',
	contributors = 'contributors',
	cloudPatches = 'cloudPatches',
	searchAndCompare = 'searchAndCompare',
	fileHistory = 'fileHistory',
	lineHistory = 'lineHistory',
	visualFileHistory = 'visualFileHistory',
	launchpad = 'launchpad',
	revisionHistory = 'revisionHistory',
	allViews = 'allViews',
}

const createCommandLink = (command: Commands) => `command:${command}`;

export const onboardingConfiguration: OnboardingItemConfiguration<OnboardingItem>[] = [
	{
		itemId: OnboardingItem.configuration,
		title: 'Configure GitLens',
		infoHref: '#',
		playHref: createCommandLink(Commands.ShowSettingsPage),
	},
	{
		itemId: OnboardingItem.commitGraph,
		title: 'Visit Commit Graph',
		playHref: createCommandLink(Commands.ShowGraph),
	},
	{
		itemId: OnboardingItem.allViews,
		title: 'Visit All the GitLens pages',
		infoTooltip: 'Be familiar with all views that you can see in the GitLens',
		playHref: '#',
		children: [
			{
				itemId: OnboardingItem.stashes,
				title: 'Stashes View',
				playHref: createCommandLink(Commands.ShowStashesView),
			},
			{
				itemId: OnboardingItem.branches,
				title: 'Branches View',
				playHref: createCommandLink(Commands.ShowBranchesView),
			},
		],
	},
];
