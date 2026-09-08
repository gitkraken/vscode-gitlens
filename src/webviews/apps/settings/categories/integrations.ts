import * as l10n from '@vscode/l10n';
import type { SettingsCategory } from '../model.js';

export const integrationsCategories: SettingsCategory[] = [
	{
		id: 'ai',
		settingsSearch: 'gitlens.ai',
		name: l10n.t('AI'),
		group: 'Integrations',
		icon: 'sparkle',
		hint: l10n.t(
			'Composing commits, reviewing changes, resolving conflicts, explaining history, and power other AI features across GitLens',
		),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gl-gk-ai/',
		master: {
			kind: 'check',
			key: 'ai.enabled',
			label: l10n.t('AI Features'),
		},
		controls: [
			{
				kind: 'ai',
				label: l10n.t('AI integrations'),
				hint: l10n.t('AI provider, model, compose model, review model, conflict resolution model'),
			},
		],
	},
	{
		id: 'agents',
		settingsSearch: 'gitlens.ai',
		name: l10n.t('Agents'),
		group: 'Integrations',
		icon: 'robot',
		hint: l10n.t('Set your default coding agent, and install GitKraken MCP and hooks for supported agents'),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gl-gk-ai/',
		controls: [
			{
				kind: 'agents',
				label: l10n.t('Agents'),
				// Search text — the rendered rows come from the Agents RPC service
				hint: l10n.t(
					'Chat, extension, and CLI agents, default agent, GitKraken MCP, agent hooks, Copilot, Cursor, Codex, Gemini, opencode',
				),
			},
		],
	},
	{
		id: 'integrations',
		settingsSearch: 'gitlens.integrations',
		name: l10n.t('Cloud Integrations'),
		group: 'Integrations',
		icon: 'plug',
		hint: l10n.t(
			'Connect hosting services like GitHub and issue trackers like Jira to track progress and take action on PRs and issues related to your branches',
		),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-start-here/#improve-workflows-with-integrations',
		master: {
			kind: 'check',
			key: 'integrations.enabled',
			label: l10n.t('Cloud Integrations'),
		},
		controls: [
			{
				kind: 'integrations',
				label: l10n.t('Cloud integrations'),
				// Search text — the rendered rows come from the integrations RPC service
				hint: l10n.t('GitHub, GitHub Enterprise, GitLab, Azure DevOps, Bitbucket, Jira, Linear'),
			},
		],
	},
	{
		id: 'remotes',
		settingsSearch: 'gitlens.remotes',
		name: l10n.t('Custom Remotes'),
		group: 'Integrations',
		icon: 'remote',
		hint: l10n.t(
			'Match your Git remotes to a provider so GitLens can open files, commits, and pull requests on self-hosted or custom Git hosts.',
		),
		controls: [
			{
				kind: 'remotes',
				label: l10n.t('Custom remotes'),
				// Search text — the rendered rows come from the gitlens.remotes array
				hint: l10n.t(
					'GitHub Enterprise, GitLab self-hosted, Bitbucket Server, Azure DevOps, self-hosted, enterprise, custom remote',
				),
			},
		],
	},
	{
		id: 'autolinks',
		settingsSearch: 'gitlens.autolinks',
		name: l10n.t('Autolinks'),
		group: 'Integrations',
		icon: 'link',
		hint: l10n.t(
			'Use autolinks to linkify external references, like Jira issues or Zendesk tickets, in commit messages.',
		),
		controls: [
			{
				kind: 'autolinks',
				label: l10n.t('Custom autolinks'),
			},
		],
	},
	{
		id: 'launchpad',
		settingsSearch: 'gitlens.launchpad',
		name: l10n.t('Launchpad'),
		group: 'Integrations',
		icon: 'rocket',
		hint: l10n.t(
			'Adds a status bar indicator that surfaces pull requests needing your attention, grouped by what action they need',
		),
		command: { label: l10n.t('GitLens: Open Launchpad'), command: 'gitlens.showLaunchpad' },
		master: {
			kind: 'check',
			key: 'launchpad.indicator.enabled',
			label: l10n.t('Launchpad Indicator'),
		},
		controls: [
			{
				kind: 'select',
				key: 'launchpad.indicator.icon',
				label: l10n.t('Show'),
				enabledWhen: 'launchpad.indicator.enabled',
				options: [
					{ value: 'default', label: l10n.t('the Launchpad icon (default)') },
					{ value: 'group', label: l10n.t('the icon of the highest priority group') },
				],
			},
			{
				kind: 'select',
				key: 'launchpad.indicator.label',
				label: l10n.t('Label'),
				enabledWhen: 'launchpad.indicator.enabled',
				options: [
					{ value: 'false', label: l10n.t('hidden') },
					{ value: 'item', label: l10n.t('the highest priority item needing your attention (default)') },
					{ value: 'counts', label: l10n.t('status counts of items needing your attention') },
				],
			},
			{
				kind: 'checkgroup',
				key: 'launchpad.indicator.groups',
				label: l10n.t('Include these groups in the indicator'),
				enabledWhen: 'launchpad.indicator.enabled',
				options: [
					{ value: 'mergeable', label: l10n.t('Mergeable'), hint: l10n.t('Shows mergeable pull requests') },
					{ value: 'blocked', label: l10n.t('Blocked'), hint: l10n.t('Shows blocked pull requests') },
					{
						value: 'needs-review',
						label: l10n.t('Needs review'),
						hint: l10n.t('Shows pull requests needing your review'),
					},
					{
						value: 'follow-up',
						label: l10n.t('Follow-up'),
						hint: l10n.t('Shows pull requests needing follow-up'),
					},
				],
			},
			{
				kind: 'check',
				key: 'launchpad.indicator.useColors',
				label: l10n.t('Use colors on the indicator'),
				enabledWhen: 'launchpad.indicator.enabled',
			},
			{
				kind: 'check',
				key: 'launchpad.indicator.polling.enabled',
				label: l10n.t('Fetch and display pull request data'),
				enabledWhen: 'launchpad.indicator.enabled',
			},
			{
				kind: 'number',
				key: 'launchpad.indicator.polling.interval',
				label: l10n.t('Poll for updates every (minutes)'),
				hint: l10n.t('Use 0 to disable automatic polling'),
				placeholder: '30',
				defaultValue: '30',
				enabledWhen: 'launchpad.indicator.enabled & launchpad.indicator.polling.enabled',
				indent: true,
			},
			{
				kind: 'number',
				key: 'launchpad.staleThreshold',
				label: l10n.t('Consider a pull request stale after (days)'),
				hint: l10n.t(
					'Stale pull requests are moved to Other. Leave blank to never consider a pull request stale',
				),
			},
		],
	},
	{
		id: 'terminal-links',
		name: l10n.t('Terminal Links'),
		group: 'Integrations',
		icon: 'terminal',
		hint: l10n.t('Adds autolinks for branches, tags, commits, and commit ranges in the integrated terminal'),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-features/#terminal-links',
		master: {
			kind: 'check',
			key: 'terminalLinks.enabled',
			label: l10n.t('Terminal Links'),
		},
		controls: [
			{
				kind: 'select',
				key: 'terminalLinks.showIn',
				label: l10n.t('Open commit and ref links in'),
				enabledWhen: 'terminalLinks.enabled',
				options: [
					{ value: 'graph', label: l10n.t('the Commit Graph (default)') },
					{ value: 'inspect', label: l10n.t('the Inspect view') },
					{ value: 'quickpick', label: l10n.t('a quick pick') },
				],
			},
		],
	},
];
