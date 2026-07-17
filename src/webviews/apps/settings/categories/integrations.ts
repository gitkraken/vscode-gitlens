import type { SettingsCategory } from '../model.js';

export const integrationsCategories: SettingsCategory[] = [
	{
		id: 'integrations',
		settingsSearch: 'gitlens.integrations',
		name: 'Cloud Integrations',
		group: 'Integrations',
		icon: 'plug',
		hint: 'Connect hosting services like GitHub and issue trackers like Jira to track progress and take action on PRs and issues related to your branches',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-start-here/#improve-workflows-with-integrations',
		master: {
			kind: 'check',
			key: 'integrations.enabled',
			label: 'Cloud Integrations',
		},
		controls: [
			{
				kind: 'integrations',
				label: 'Cloud integrations',
				// Search text — the rendered rows come from the integrations RPC service
				hint: 'GitHub, GitHub Enterprise, GitLab, Azure DevOps, Bitbucket, Jira, Linear',
			},
		],
	},
	{
		id: 'ai',
		settingsSearch: 'gitlens.ai',
		name: 'AI',
		group: 'Integrations',
		icon: 'sparkle',
		hint: 'Generate commit messages, explain changes, and power other AI features across GitLens',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gl-gk-ai/',
		master: {
			kind: 'check',
			key: 'ai.enabled',
			label: 'AI Features',
		},
		controls: [
			{
				kind: 'ai',
				label: 'AI integrations',
				// Search text — the rendered rows come from the AI RPC service
				hint: 'AI provider, model, GitKraken MCP, default coding agent, Claude Code hooks',
			},
			{
				kind: 'slider',
				key: 'ai.modelOptions.temperature',
				label: 'Temperature',
				hint: 'A measure of output randomness. Higher values result in more randomness, e.g. creativity, while lower values are more deterministic',
				min: 0,
				max: 2,
				step: 0.1,
			},
		],
	},
	{
		id: 'autolinks',
		settingsSearch: 'gitlens.autolinks',
		name: 'Autolinks',
		group: 'Integrations',
		icon: 'link',
		hint: 'Use autolinks to linkify external references, like Jira issues or Zendesk tickets, in commit messages.',
		controls: [
			{
				kind: 'autolinks',
				label: 'Custom autolinks',
			},
		],
	},
	{
		id: 'launchpad',
		settingsSearch: 'gitlens.launchpad',
		name: 'Launchpad',
		group: 'Integrations',
		icon: 'rocket',
		hint: 'Adds a status bar indicator that surfaces pull requests needing your attention, grouped by what action they need',
		command: { label: 'GitLens: Open Launchpad', command: 'gitlens.showLaunchpad' },
		master: {
			kind: 'check',
			key: 'launchpad.indicator.enabled',
			label: 'Launchpad Indicator',
		},
		controls: [
			{
				kind: 'select',
				key: 'launchpad.indicator.icon',
				label: 'Show',
				enabledWhen: 'launchpad.indicator.enabled',
				options: [
					{ value: 'default', label: 'the Launchpad icon (default)' },
					{ value: 'group', label: 'the icon of the highest priority group' },
				],
			},
			{
				kind: 'select',
				key: 'launchpad.indicator.label',
				label: 'Label',
				enabledWhen: 'launchpad.indicator.enabled',
				options: [
					{ value: 'false', label: 'hidden' },
					{ value: 'item', label: 'the highest priority item needing your attention (default)' },
					{ value: 'counts', label: 'status counts of items needing your attention' },
				],
			},
			{
				kind: 'checkgroup',
				key: 'launchpad.indicator.groups',
				label: 'Include these groups in the indicator',
				enabledWhen: 'launchpad.indicator.enabled',
				options: [
					{ value: 'mergeable', label: 'Mergeable', hint: 'Shows mergeable pull requests' },
					{ value: 'blocked', label: 'Blocked', hint: 'Shows blocked pull requests' },
					{ value: 'needs-review', label: 'Needs review', hint: 'Shows pull requests needing your review' },
					{ value: 'follow-up', label: 'Follow-up', hint: 'Shows pull requests needing follow-up' },
				],
			},
			{
				kind: 'check',
				key: 'launchpad.indicator.useColors',
				label: 'Use colors on the indicator',
				enabledWhen: 'launchpad.indicator.enabled',
			},
			{
				kind: 'check',
				key: 'launchpad.indicator.polling.enabled',
				label: 'Fetch and display pull request data',
				enabledWhen: 'launchpad.indicator.enabled',
			},
			{
				kind: 'number',
				key: 'launchpad.indicator.polling.interval',
				label: 'Poll for updates every (minutes)',
				hint: 'Use 0 to disable automatic polling',
				placeholder: '30',
				defaultValue: '30',
				enabledWhen: 'launchpad.indicator.enabled & launchpad.indicator.polling.enabled',
				indent: true,
			},
			{
				kind: 'number',
				key: 'launchpad.staleThreshold',
				label: 'Consider a pull request stale after (days)',
				hint: 'Stale pull requests are moved to Other. Leave blank to never consider a pull request stale',
			},
		],
	},
	{
		id: 'terminal-links',
		name: 'Terminal Links',
		group: 'Integrations',
		icon: 'terminal',
		hint: 'Adds autolinks for branches, tags, commits, and commit ranges in the integrated terminal',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#terminal-links',
		master: {
			kind: 'check',
			key: 'terminalLinks.enabled',
			label: 'Terminal Links',
		},
		controls: [
			{
				kind: 'select',
				key: 'terminalLinks.showIn',
				label: 'Open commit and ref links in',
				enabledWhen: 'terminalLinks.enabled',
				options: [
					{ value: 'graph', label: 'the Commit Graph (default)' },
					{ value: 'inspect', label: 'the Inspect view' },
					{ value: 'quickpick', label: 'a quick pick' },
				],
			},
		],
	},
];
