import type { QuickInputButton, QuickPickItem } from 'vscode';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
import {
	ConnectIntegrationButton,
	OpenLogsQuickInputButton,
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
} from '../commands/quick-wizard/quickButtons.js';
import { AuthenticationError, getPresentableErrorMessage } from '../errors.js';
import type { DirectiveQuickPickItem } from './items/directive.js';
import { createDirectiveQuickPickItem, Directive } from './items/directive.js';

export type ConnectMoreIntegrationsItem = QuickPickItem & {
	item: undefined;
};

export type ManageIntegrationsItem = QuickPickItem & {
	item: undefined;
};

export const manageIntegrationsItem: ManageIntegrationsItem = {
	label: 'Manage integrations...',
	detail: 'Manage your connected integrations',
	item: undefined,
};

export function isManageIntegrationsItem(item: unknown): item is ManageIntegrationsItem {
	return item === manageIntegrationsItem;
}

/** Surfaces a failed integration read as a picker item, so it can't be mistaken for an empty result */
export function createIntegrationErrorQuickPickItem(error: Error, noun: string): DirectiveQuickPickItem {
	if (error instanceof AggregateError) {
		const firstAuthError = error.errors.find(e => e instanceof AuthenticationError);
		error = firstAuthError ?? error.errors[0] ?? error;
	}

	const isAuthError = error instanceof AuthenticationError;

	return createDirectiveQuickPickItem(Directive.Noop, false, {
		label: isAuthError ? '$(warning) Authentication Required' : `$(warning) Unable to fully load ${noun}`,
		detail: isAuthError
			? `${getPresentableErrorMessage(error)} — Reconnect your integration`
			: error.name === 'HttpError' && 'status' in error && typeof error.status === 'number'
				? `${error.status}: ${String(error)}`
				: String(error),
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
