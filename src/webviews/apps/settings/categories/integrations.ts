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
				kind: 'check',
				key: 'terminalLinks.showDetailsView',
				label: 'Show Inspect view for commit links',
				enabledWhen: 'terminalLinks.enabled',
			},
		],
	},
	{
		id: 'rebase-editor',
		name: 'Interactive Rebase Editor',
		group: 'Editing',
		icon: 'git-merge',
		hint: 'Adds a user-friendly interactive rebase editor to easily configure an interactive rebase session',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#interactive-rebase-editor',
		master: {
			kind: 'check',
			key: 'rebaseEditor.enabled',
			type: 'custom',
			label: 'Interactive Rebase Editor',
		},
		controls: [
			{
				kind: 'select',
				key: 'rebaseEditor.ordering',
				label: 'Show',
				enabledWhen: 'rebaseEditor.enabled',
				options: [
					{ value: 'asc', label: 'oldest commit first' },
					{ value: 'desc', label: 'newest commit first (default)' },
				],
			},
		],
	},
];
