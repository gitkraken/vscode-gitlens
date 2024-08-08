import { Commands } from '../../../../constants.commands';
import { OnboardingItem } from '../../../home/protocol';
import { createCommandLink } from '../../shared/commands';
import type { OnboardingItemConfiguration } from '../../shared/components/onboarding/onboarding-types';

export function getOnboardingConfiguration(
	editorPreviewEnabled: boolean,
	repoHostConnected: boolean,
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
					playHref: createCommandLink(Commands.ShowHomeView),
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=65',
					infoTooltip:
						'The GitLens tab includes short links to the main features, cloud patches, workspaces, and GitKraken account management sections',
				},
				{
					itemId: OnboardingItem.inspect,
					title: 'GitLens Inspect',
					playHref: createCommandLink(Commands.ShowCommitDetailsView),
					infoTooltip: 'The GitLens Inspect tab includes compare tools',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=213',
				},
				{
					itemId: OnboardingItem.sourceControl,
					title: 'Source Control',
					playHref: createCommandLink('workbench.view.scm'),
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
			playHref: passIfTrue(!editorPreviewEnabled, createCommandLink('workbench.action.quickOpen')),
			children: [
				{
					itemId: OnboardingItem.blame,
					title: 'Hover over inline blame ',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=129',
					infoTooltip: 'Put the cursor on any line in your file and hover over inline blame',
				},
				{
					itemId: OnboardingItem.codeLens,
					title: 'Use Codelens',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=145',
				},
				{
					itemId: OnboardingItem.fileAnnotations,
					title: 'Try File Annotations',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=153',
					infoTooltip: 'Check file history. Open any file to test it',
					playHref: passIfTrue(editorPreviewEnabled, createCommandLink(Commands.ToggleFileBlame)),
				},
				{
					itemId: OnboardingItem.revisionHistory,
					title: 'Navigate with Revision History',
					infoHref: 'https://youtu.be/oJdlGtsbc3U?t=178',
					infoTooltip: 'Check file history. Open any file to test it',
					playHref: passIfTrue(editorPreviewEnabled, createCommandLink(Commands.DiffWithPrevious)),
				},
			],
		},
		{
			itemId: OnboardingItem.commitGraph,
			title: 'View the Commit Graph',
			infoHref: 'https://youtu.be/oJdlGtsbc3U?t=275',
			playHref: createCommandLink(Commands.ShowGraph),
		},
		{
			itemId: OnboardingItem.launchpad,
			title: 'Open Launchpad',
			playHref: createCommandLink('gitlens.launchpad.split'),
			infoHref: 'https://youtu.be/oJdlGtsbc3U?t=443',
		},
		{
			itemId: OnboardingItem.repoHost,
			title: 'Connect with Repo Host',
			playHref: passIfTrue(!repoHostConnected, createCommandLink(Commands.ConnectRemoteProvider)),
			infoTooltip:
				'Connect remote integration to have such additional features as enriched autolinks, extensive PR support on commits/branches, extensive repo and commit metadata, Launchpad support',
		},
		{
			itemId: OnboardingItem.visualFileHistory,
			title: 'Visual File History',
			infoHref: 'https://youtu.be/oJdlGtsbc3U?t=233',
			// ??? should we show play button if no active editor ???
			playHref: createCommandLink(editorPreviewEnabled ? Commands.ShowInTimeline : 'workbench.action.quickOpen'),
		},
	];
}
