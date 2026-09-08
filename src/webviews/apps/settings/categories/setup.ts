import * as l10n from '@vscode/l10n';
import type { SettingsCategory } from '../model.js';

export const setupCategories: SettingsCategory[] = [
	{
		id: 'account',
		name: l10n.t('Account'),
		group: 'Setup',
		icon: 'account',
		hint: l10n.t('Sign in to your GitKraken account to unlock GitLens Pro features, or manage your plan'),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/',
		controls: [
			{
				kind: 'account',
				// Search text — the rendered panel comes from the shared subscription RPC service
				label: l10n.t('Account, sign in, and GitLens Pro plan'),
				hint: l10n.t('Sign in or create a GitKraken account, manage your subscription, and upgrade your plan'),
			},
		],
	},
	{
		id: 'setup',
		name: l10n.t('Get Started'),
		group: 'Setup',
		icon: 'checklist',
		hint: l10n.t(
			'Connect your services, choose an AI provider and model, and set up MCP and hooks for your agents',
		),
		learnMoreUrl: 'https://help.gitkraken.com/gitlens/gitlens-start-here/',
		controls: [
			{
				kind: 'setup',
				// Search text — the rendered cards come from the shared RPC services
				label: l10n.t('Get started with GitLens'),
				hint: l10n.t('Connect integrations, choose an AI provider and model, set up agents'),
			},
		],
	},
];
