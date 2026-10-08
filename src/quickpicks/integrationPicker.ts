import type { QuickInputButton, QuickPickItem } from 'vscode';
import { l10n } from 'vscode';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
import { fromNow } from '@gitlens/utils/date.js';
import {
	ConnectIntegrationButton,
	OpenLogsQuickInputButton,
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
} from '../commands/quick-wizard/quickButtons.js';
import { AuthenticationError, getPresentableErrorMessage, RequestRateLimitError } from '../errors.js';
import type { DirectiveQuickPickItem } from './items/directive.js';
import { createDirectiveQuickPickItem, Directive } from './items/directive.js';

export type ConnectMoreIntegrationsItem = QuickPickItem & {
	item: undefined;
};

export type ManageIntegrationsItem = QuickPickItem & {
	item: undefined;
};

export const manageIntegrationsItem: ManageIntegrationsItem = {
	label: l10n.t('Manage integrations...'),
	detail: l10n.t('Manage your connected integrations'),
	item: undefined,
};

export function isManageIntegrationsItem(item: unknown): item is ManageIntegrationsItem {
	return item === manageIntegrationsItem;
}

/** Surfaces a failed integration read as a picker item, so it can't be mistaken for an empty result */
export function createIntegrationErrorQuickPickItem(error: Error, noun: string): DirectiveQuickPickItem {
	if (error instanceof AggregateError) {
		error =
			error.errors.find(e => e instanceof AuthenticationError) ??
			error.errors.find(e => e instanceof RequestRateLimitError) ??
			error.errors[0] ??
			error;
	}

	if (error instanceof RequestRateLimitError) {
		const resetMs = error.resetAt != null ? error.resetAt * 1000 : undefined;
		return createDirectiveQuickPickItem(Directive.Noop, false, {
			label: `$(warning) ${l10n.t('Rate limit reached')}`,
			detail:
				resetMs != null && resetMs > Date.now()
					? l10n.t('Unable to fully load {0} — try again {1}', noun, fromNow(new Date(resetMs)))
					: l10n.t('Unable to fully load {0} — try again in a few minutes', noun),
			buttons: [OpenLogsQuickInputButton],
		});
	}

	const isAuthError = error instanceof AuthenticationError;

	// Presentable message, collapsed to one line — a QuickPick `detail` is single-line
	const message = getPresentableErrorMessage(error).replace(/\s+/g, ' ').trim();

	return createDirectiveQuickPickItem(Directive.Noop, false, {
		label: isAuthError
			? `$(warning) ${l10n.t('Authentication Required')}`
			: `$(warning) ${l10n.t('Unable to fully load {0}', noun)}`,
		detail: isAuthError
			? l10n.t('{0} — Reconnect your integration', message)
			: error.name === 'HttpError' && 'status' in error && typeof error.status === 'number'
				? `${error.status}: ${message}`
				: message,
		buttons: isAuthError ? [ConnectIntegrationButton, OpenLogsQuickInputButton] : [OpenLogsQuickInputButton],
	});
}

function getOpenOnGitProviderQuickInputButton(integrationId: string): QuickInputButton | undefined {
	switch (integrationId) {
		case GitCloudHostIntegrationId.GitLab:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return OpenOnGitLabQuickInputButton;
		case GitCloudHostIntegrationId.GitHub:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return OpenOnGitHubQuickInputButton;
		case GitCloudHostIntegrationId.AzureDevOps:
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return OpenOnAzureDevOpsQuickInputButton;
		case GitCloudHostIntegrationId.Bitbucket:
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return OpenOnBitbucketQuickInputButton;
		default:
			return undefined;
	}
}

export function getOpenOnGitProviderQuickInputButtons(integrationId: string): QuickInputButton[] {
	const button = getOpenOnGitProviderQuickInputButton(integrationId);
	return button != null ? [button] : [];
}
