import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../../constants.js';

export const gitLabProvider: Provider = {
	id: GitCloudHostIntegrationId.GitLab,
	name: 'GitLab',
	domain: 'gitlab.com',
	icon: 'gitlab',
	getIgnoreSSLErrors: () => false,
	reauthenticate: async () => {},
	trackRequestException: () => {},
};

export const gitLabToken: TokenWithInfo<typeof GitCloudHostIntegrationId.GitLab> = {
	providerId: GitCloudHostIntegrationId.GitLab,
	accessToken: 'token',
	microHash: 'hash',
	cloud: true,
	type: undefined,
	scopes: undefined,
};
