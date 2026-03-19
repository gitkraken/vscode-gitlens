import type { RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type { RemoteProviderConfig } from '@gitlens/git/remotes/matcher.js';
import type { CloudGitSelfManagedHostIntegrationIds } from '../../constants.integrations.js';
import { GitSelfManagedHostIntegrationId } from '../../constants.integrations.js';
import type { ConfiguredIntegrationDescriptor } from '../../plus/integrations/authentication/models.js';
import { isCloudGitSelfManagedHostIntegrationId } from '../../plus/integrations/utils/-webview/integration.utils.js';

/**
 * Configuration shape for user-configured custom remotes (from VS Code settings).
 * Subset of the full RemotesConfig — only the fields needed for remote provider matching.
 */
export interface RemotesConfigLike {
	readonly type: string;
	readonly domain?: string | null;
	readonly regex?: string | null;
	readonly protocol?: string;
	readonly name?: string;
	readonly urls?: RemoteProviderConfig['urls'];
}

/**
 * Converts a PascalCase config type value (from `gitlens.remotes[].type` in package.json)
 * to a kebab-case {@link RemoteProviderId}.
 */
const configTypeMap: Record<string, RemoteProviderId> = {
	AzureDevOps: 'azure-devops',
	Bitbucket: 'bitbucket',
	BitbucketServer: 'bitbucket-server',
	Custom: 'custom',
	Gerrit: 'gerrit',
	GoogleSource: 'google-source',
	Gitea: 'gitea',
	GitHub: 'github',
	GitLab: 'gitlab',
};

/**
 * Converts user-configured custom remotes and cloud self-managed host integrations
 * into library-compatible {@link RemoteProviderConfig} entries.
 *
 * Used by both the host context adapter (for git operations) and standalone callers
 * (e.g., drafts service) that need to build a remote provider matcher.
 */
export function buildRemoteProviderConfigs(
	configuredRemotes: RemotesConfigLike[] | null | undefined,
	configuredIntegrations: ConfiguredIntegrationDescriptor[] | undefined,
): RemoteProviderConfig[] | undefined {
	const configs: RemoteProviderConfig[] = [];

	// User-configured custom remotes from settings
	if (configuredRemotes?.length) {
		for (const rc of configuredRemotes) {
			if (rc.domain == null && rc.regex == null) continue;

			const type = configTypeMap[rc.type];
			if (type == null) continue;

			configs.push({
				type: type,
				domain: rc.domain ?? undefined,
				regex: rc.regex ?? undefined,
				protocol: rc.protocol,
				name: rc.name,
				urls: rc.urls,
			});
		}
	}

	// Cloud self-managed host integrations
	if (configuredIntegrations?.length) {
		for (const ci of configuredIntegrations) {
			if (!isCloudGitSelfManagedHostIntegrationId(ci.integrationId) || !ci.domain) continue;

			const type = cloudIntegrationIdToProviderId(ci.integrationId);
			if (type == null) continue;

			const domain = ci.domain.toLowerCase();
			// Cloud integration takes precedence over user config with the same domain
			const dupIndex = configs.findIndex(c => c.domain === domain);
			const config: RemoteProviderConfig = { type: type, domain: domain };
			if (dupIndex !== -1) {
				configs[dupIndex] = config;
			} else {
				configs.push(config);
			}
		}
	}

	return configs.length ? configs : undefined;
}

function cloudIntegrationIdToProviderId(id: CloudGitSelfManagedHostIntegrationIds): RemoteProviderId | undefined {
	switch (id) {
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return 'github';
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return 'gitlab';
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return 'bitbucket-server';
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return 'azure-devops';
		default:
			return undefined;
	}
}
