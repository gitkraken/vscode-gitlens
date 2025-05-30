import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations';
import type { GitRemote } from '../../../../git/models/remote';
import type { RemoteProviderId } from '../../../../git/remotes/remoteProvider';
import { isAzureCloudDomain } from '../../providers/azureDevOps';
import { isBitbucketCloudDomain } from '../../providers/bitbucket';
import { isGitHubDotCom, isGitLabDotCom } from '../../providers/models';

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

export function getIntegrationIdForRemote(
	remote: GitRemote,
): GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId | undefined {
	switch (remote.provider?.id) {
		case 'azure-devops':
			if (isAzureCloudDomain(remote.provider.domain)) {
				return GitCloudHostIntegrationId.AzureDevOps;
			}
			return undefined;
		case 'bitbucket':
		case 'bitbucket-server':
			if (isBitbucketCloudDomain(remote.provider.domain)) {
				return GitCloudHostIntegrationId.Bitbucket;
			}
			return GitSelfManagedHostIntegrationId.BitbucketServer;
		case 'github':
			if (remote.provider.domain != null && !isGitHubDotCom(remote.provider.domain)) {
				return remote.provider.custom
					? GitSelfManagedHostIntegrationId.GitHubEnterprise
					: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
			}
			return GitCloudHostIntegrationId.GitHub;
		case 'gitlab':
			if (remote.provider.domain != null && !isGitLabDotCom(remote.provider.domain)) {
				return remote.provider.custom
					? GitSelfManagedHostIntegrationId.GitLabSelfHosted
					: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
			}
			return GitCloudHostIntegrationId.GitLab;
		default:
			return undefined;
	}
}
