import type { CloudGitSelfManagedHostIntegrationIds, IntegrationIds } from '../../../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../../constants.integrations';
import type { RemoteProvider, RemoteProviderId } from '../../../../git/remotes/remoteProvider';
import type { IntegrationConnectedKey } from '../../models/integration';
import { isAzureCloudDomain } from '../../providers/azureDevOps';
import { isBitbucketCloudDomain } from '../../providers/bitbucket';
import { isGitHubDotCom, isGitLabDotCom } from '../../providers/models';

const selfHostedIntegrationIds: GitSelfManagedHostIntegrationId[] = [
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitSelfManagedHostIntegrationId.GitHubEnterprise,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	GitSelfManagedHostIntegrationId.GitLabSelfHosted,
	GitSelfManagedHostIntegrationId.BitbucketServer,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
] as const;

export const supportedIntegrationIds: IntegrationIds[] = [
	GitCloudHostIntegrationId.GitHub,
	GitCloudHostIntegrationId.GitLab,
	GitCloudHostIntegrationId.Bitbucket,
	GitCloudHostIntegrationId.AzureDevOps,
	IssuesCloudHostIntegrationId.Jira,
	IssuesCloudHostIntegrationId.Trello,
	...selfHostedIntegrationIds,
] as const;

export function convertRemoteProviderIdToIntegrationId(
	remoteProviderId: RemoteProviderId,
): GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId | undefined {
	switch (remoteProviderId) {
		case 'azure-devops':
			return GitCloudHostIntegrationId.AzureDevOps;
		case 'bitbucket':
			return GitCloudHostIntegrationId.Bitbucket;
		case 'github':
			return GitCloudHostIntegrationId.GitHub;
		case 'gitlab':
			return GitCloudHostIntegrationId.GitLab;
		case 'bitbucket-server':
			return GitSelfManagedHostIntegrationId.BitbucketServer;
		default:
			return undefined;
	}
}

export function getIntegrationConnectedKey<T extends IntegrationIds>(
	id: T,
	domain?: string,
): IntegrationConnectedKey<T> {
	if (isGitSelfManagedHostIntegrationId(id)) {
		if (!domain) {
			throw new Error(`Domain is required for self-managed integration ID: ${id}`);
		}
		return `connected:${id}:${domain}` as IntegrationConnectedKey<T>;
	}

	return `connected:${id}` as IntegrationConnectedKey<T>;
}

export function getIntegrationIdForRemote(
	provider: RemoteProvider | undefined,
): GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId | undefined {
	switch (provider?.id) {
		case 'azure-devops':
			if (isAzureCloudDomain(provider.domain)) {
				return GitCloudHostIntegrationId.AzureDevOps;
			}
			return provider.custom ? undefined : GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		case 'bitbucket':
		case 'bitbucket-server':
			if (isBitbucketCloudDomain(provider.domain)) {
				return GitCloudHostIntegrationId.Bitbucket;
			}
			return GitSelfManagedHostIntegrationId.BitbucketServer;
		case 'github':
			if (provider.domain != null && !isGitHubDotCom(provider.domain)) {
				return provider.custom
					? GitSelfManagedHostIntegrationId.GitHubEnterprise
					: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
			}
			return GitCloudHostIntegrationId.GitHub;
		case 'gitlab':
			if (provider.domain != null && !isGitLabDotCom(provider.domain)) {
				return provider.custom
					? GitSelfManagedHostIntegrationId.GitLabSelfHosted
					: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
			}
			return GitCloudHostIntegrationId.GitLab;
		default:
			return undefined;
	}
}

export function isCloudGitSelfManagedHostIntegrationId(
	id: IntegrationIds,
): id is CloudGitSelfManagedHostIntegrationIds {
	switch (id) {
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
		case GitSelfManagedHostIntegrationId.BitbucketServer:
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return true;
		default:
			return false;
	}
}

export function isGitCloudHostIntegrationId(id: IntegrationIds): id is GitCloudHostIntegrationId {
	switch (id) {
		case GitCloudHostIntegrationId.GitHub:
		case GitCloudHostIntegrationId.GitLab:
		case GitCloudHostIntegrationId.Bitbucket:
		case GitCloudHostIntegrationId.AzureDevOps:
			return true;
		default:
			return false;
	}
}

export function isGitSelfManagedHostIntegrationId(id: IntegrationIds): id is GitSelfManagedHostIntegrationId {
	return selfHostedIntegrationIds.includes(id as GitSelfManagedHostIntegrationId);
}
