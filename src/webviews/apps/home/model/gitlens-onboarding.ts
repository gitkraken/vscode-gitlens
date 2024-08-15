import type { WalkthroughSteps } from '../../../../constants';
import { Commands } from '../../../../constants.commands';
import { OnboardingItem } from '../../../home/protocol';
import { createCommandLink } from '../../shared/commands';
import type { OnboardingItemConfiguration } from '../../shared/components/onboarding/onboarding-types';

const createWalkthroughLink = (step: WalkthroughSteps) =>
	createCommandLink(Commands.OpenWalkthrough, { args: { source: 'welcome', step: step } });

export function getOnboardingConfiguration(
	editorPreviewEnabled: boolean,
	repoHostConnected: boolean,
	canEnableCodeLens: boolean,
	canEnableLineBlame: boolean,
	proFeaturesEnabled: boolean,
	canActivateTrial: boolean,
	canReActivateTrial: boolean,
	canUpgradeToPro: boolean,
): OnboardingItemConfiguration<OnboardingItem>[] {
	const passIfTrue = <T>(condition: boolean, value: T): T | undefined => (condition ? value : undefined);
	return [
		{
			itemId: OnboardingItem.allSidebarViews,
			title: 'Visit sidebars with GitLens views',
			infoHref: 'https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens#side-bar-views',
			children: [
				{
					itemId: OnboardingItem.gitLens,
					title: 'GitLens',
					playHref: createCommandLink('workbench.view.extension.gitlens'),
					playTooltip: 'Show the GitLens Sidebar',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=65',
					infoTooltip:
						'The GitLens tab includes short links to the main features, cloud patches, workspaces, and GitKraken account management sections',
				},
				{
					itemId: OnboardingItem.inspect,
					title: 'GitLens Inspect',
					playHref: createCommandLink('workbench.view.extension.gitlensInspect'),
					playTooltip: 'Show the GitLens Inspect Sidebar',
					infoTooltip: 'The GitLens Inspect tab includes compare tools',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=213',
				},
				{
					itemId: OnboardingItem.sourceControl,
					title: 'Source Control',
					playHref: createCommandLink('workbench.view.scm'),
					playTooltip: 'Show the Source Control Sidebar',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=185',
					infoTooltip:
						'The Source Control is a default VSCode view, but it contains such GitLens sections as Commits, Branches, Remotes, Stashes, Tags, WorkTrees and Contributors',
				},
			],
		},
		{
			itemId: OnboardingItem.editorFeatures,
			title: 'Editor / file features',
			infoTooltip: 'Check the features of GitLens with active file editor',
			infoHref: createWalkthroughLink('core-features'),
			playHref: passIfTrue(!editorPreviewEnabled, createCommandLink('workbench.action.quickOpen')),
			playTooltip: 'Open a file to try editor features',
			children: [
				{
					itemId: OnboardingItem.blame,
					title: 'Hover over inline blame ',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=129',
					infoTooltip: 'Put the cursor on any line in your file and hover over inline blame',
					playHref: passIfTrue(canEnableLineBlame, createCommandLink(Commands.ToggleLineBlame)),
					playTooltip: 'Enable inline blame',
				},
				{
					itemId: OnboardingItem.codeLens,
					title: 'Use Codelens',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=145',
					playHref: passIfTrue(
						editorPreviewEnabled && canEnableCodeLens,
						createCommandLink(Commands.ToggleCodeLens),
					),
					playTooltip: 'Enable Git CodeLens',
				},
				{
					itemId: OnboardingItem.fileAnnotations,
					title: 'Try File Annotations',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=153',
					infoTooltip: 'Check file history. Open any file to test it',
					playHref: passIfTrue(editorPreviewEnabled, createCommandLink(Commands.ToggleFileBlame)),
					playTooltip: 'Toggle File Blame',
				},
				{
					itemId: OnboardingItem.revisionHistory,
					title: 'Navigate with Revision History',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=178',
					infoTooltip: 'Check file history. Open any file to test it',
					playHref: passIfTrue(editorPreviewEnabled, createCommandLink(Commands.DiffWithPrevious)),
					playTooltip: 'Open changes with the previous revision',
				},
			],
		},
		{
			itemId: OnboardingItem.launchpad,
			title: 'Open Launchpad',
			playHref: createCommandLink(Commands.ShowLaunchpad),
			infoHref: createWalkthroughLink('launchpad'),
			playTooltip: 'Open Launchpad',
		},
		{
			itemId: OnboardingItem.repoHost,
			title: 'Connect with Repo Host',
			playHref: passIfTrue(!repoHostConnected, createCommandLink(Commands.ConnectRemoteProvider)),
			infoHref: createWalkthroughLink('integrations'),
			infoTooltip:
				'Connect remote integration to have such additional features as enriched autolinks, extensive PR support on commits/branches, extensive repo and commit metadata, Launchpad support',
			playTooltip: 'Connect remote integration',
		},
		{
			itemId: OnboardingItem.proFeatures,
			title: 'Pro features',
			infoHref: createWalkthroughLink('pro-upgrade'),
			playTooltip: 'Restore plus features',
			playHref: passIfTrue(!proFeaturesEnabled, createCommandLink(Commands.PlusRestore)),
			children: [
				{
					itemId: OnboardingItem.tryTrial,
					title: canReActivateTrial ? 'Reactivate trial' : 'Activate trial',
					infoTooltip: 'Try pro features',
					playHref:
						passIfTrue(canActivateTrial, createCommandLink(Commands.PlusStartPreviewTrial)) ??
						passIfTrue(canReActivateTrial, createCommandLink(Commands.PlusReactivateProTrial)),
				},
				{
					itemId: OnboardingItem.upgradeToPro,
					playHref: passIfTrue(!canUpgradeToPro, createCommandLink(Commands.PlusUpgrade)),
					title: 'Upgrade to pro',
					playTooltip: 'Upgrade to pro to get more features',
				},
				{
					itemId: OnboardingItem.commitGraph,
					title: 'View the Commit Graph',
					infoHref: createWalkthroughLink('visualize'),
					playHref: createCommandLink(Commands.ShowGraph),
					playTooltip: 'Show the Commit Graph',
					disabled: !proFeaturesEnabled,
				},
				{
					itemId: OnboardingItem.visualFileHistory,
					title: 'Visual File History',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=233',
					playHref: createCommandLink(Commands.ShowTimelineView),
					playTooltip: 'Show Visual File History',
					disabled: !proFeaturesEnabled,
				},
			],
		},
	];
}
