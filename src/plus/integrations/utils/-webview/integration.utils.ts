import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../../constants.integrations';
import type { RemoteProviderId } from '../../../../git/remotes/remoteProvider';

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
