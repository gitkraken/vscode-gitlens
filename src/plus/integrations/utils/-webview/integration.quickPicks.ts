import type { QuickInputButton, QuickPickItem } from 'vscode';
import {
	OpenOnAzureDevOpsQuickInputButton,
	OpenOnBitbucketQuickInputButton,
	OpenOnGitHubQuickInputButton,
	OpenOnGitLabQuickInputButton,
} from '../../../../commands/quick-wizard/quickButtons.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations.js';

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

function getOpenOnGitProviderQuickInputButton(integrationId: string): QuickInputButton | undefined {
	switch (integrationId) {
		case GitCloudHostIntegrationId.GitLab:
		case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return OpenOnGitLabQuickInputButton;
		case GitCloudHostIntegrationId.GitHub:
		case GitSelfManagedHostIntegrationId.GitHubEnterprise:
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
