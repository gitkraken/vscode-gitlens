import type { SettingsCategory } from '../model.js';

export const setupCategories: SettingsCategory[] = [
	{
		id: 'account',
		name: 'Account',
		group: 'Setup',
		icon: 'account',
		hint: 'Sign in to your GitKraken account to unlock GitLens Pro features, or manage your plan',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/',
		controls: [
			{
				kind: 'account',
				// Search text — the rendered panel comes from the shared subscription RPC service
				label: 'Account, sign in, and GitLens Pro plan',
				hint: 'Sign in or create a GitKraken account, manage your subscription, and upgrade your plan',
			},
		],
	},
	{
		id: 'setup',
		name: 'Get Started',
		group: 'Setup',
		icon: 'checklist',
		hint: 'Connect your services, choose an AI provider and model, and set up MCP and hooks for your agents',
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-start-here/',
		controls: [
			{
				kind: 'setup',
				// Search text — the rendered cards come from the shared RPC services
				label: 'Get started with GitLens',
				hint: 'Connect integrations, choose an AI provider and model, set up agents',
			},
		],
	},
];
