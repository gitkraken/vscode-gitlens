import type { RemoteProvider, RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type {
	CloudGitSelfManagedHostIntegrationIds,
	CloudSelfManagedHostIntegrationIds,
	IntegrationIds,
	IssuesHostIntegrationIds,
	SelfManagedHostIntegrationIds,
} from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { Integration, IntegrationConnectedKey } from '../models/integration.js';
// These domain checks come from `providers/models.ts` (already imported here) rather than the individual
// provider modules: those read `providersMetadata[...]` synchronously at module init, so importing from them
// while `providers/models.ts` is still loading triggers a TDZ on `providersMetadata`. Importing the shared
// predicates keeps one definition of each regex — duplicating them let a fix land in only one place.
import { isAzureCloudDomain, isBitbucketCloudDomain, isGitHubDotCom, isGitLabDotCom } from '../providers/models.js';
import { baseUrlFromDomain } from './domain.utils.js';

const selfHostedIntegrationIds: GitSelfManagedHostIntegrationId[] = [
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	GitSelfManagedHostIntegrationId.BitbucketServer,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
] as const;

const selfHostedIssuesIntegrationIds: IssuesSelfManagedHostIntegrationId[] = [
	IssuesSelfManagedHostIntegrationId.JiraServer,
] as const;

export const supportedIntegrationIds: IntegrationIds[] = [
	GitCloudHostIntegrationId.GitHub,
	GitCloudHostIntegrationId.GitLab,
	GitCloudHostIntegrationId.Bitbucket,
	GitCloudHostIntegrationId.AzureDevOps,
	IssuesCloudHostIntegrationId.Jira,
	IssuesCloudHostIntegrationId.Trello,
	...selfHostedIntegrationIds,
	...selfHostedIssuesIntegrationIds,
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
	if (isSelfManagedHostIntegrationId(id)) {
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
				return GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
			}
			return GitCloudHostIntegrationId.GitHub;
		case 'gitlab':
			if (provider.domain != null && !isGitLabDotCom(provider.domain)) {
				return GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
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

/**
 * Whether this id is a self-managed host whose token comes from the GK cloud backend — the check behind
 * "expand this provider to one instance per configured host". Distinct from
 * {@link isCloudGitSelfManagedHostIntegrationId}, which stays git-only because its callers go on to ask the
 * instance for repositories.
 */
export function isCloudSelfManagedHostIntegrationId(id: IntegrationIds): id is CloudSelfManagedHostIntegrationIds {
	return isCloudGitSelfManagedHostIntegrationId(id) || isIssuesSelfManagedHostIntegrationId(id);
}

/**
 * Whether a provider's cloud token uses `expiresIn: 0` to mean "never expires" (rather than "already
 * expired"). GitHub and the cloud self-managed hosts always return 0 for their non-expiring tokens; Trello
 * is issued with `expiration: never` (identity-service), so its cloud token comes back as 0 too. Callers
 * must map 0 → a far-future expiry for these, or the session is immediately treated as expired.
 *
 * Every backend-managed self-managed host qualifies, not just the git ones: a self-hosted tracker's token is
 * a PAT the backend stores as-is and cannot refresh, so reading 0 as "already expired" would re-resolve the
 * session on every single read.
 */
export function isNonExpiringZeroTokenIntegrationId(id: IntegrationIds): boolean {
	return (
		id === GitCloudHostIntegrationId.GitHub ||
		id === IssuesCloudHostIntegrationId.Trello ||
		isCloudSelfManagedHostIntegrationId(id)
	);
}

export function isGitHostIntegration(integration: Integration): integration is GitHostIntegration {
	return integration.type === 'git';
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

export function isIssuesSelfManagedHostIntegrationId(id: IntegrationIds): id is IssuesSelfManagedHostIntegrationId {
	return selfHostedIssuesIntegrationIds.includes(id as IssuesSelfManagedHostIntegrationId);
}

/**
 * Whether this id addresses ONE customer-run host, whatever it hosts — the predicate the domain-keyed
 * machinery runs on: the integration cache key, the secret key, the `connected:${id}:${domain}` flag, domain
 * normalization, per-host primary selection, and multi-account reconcile.
 *
 * Deliberately wider than {@link isGitSelfManagedHostIntegrationId}, which is reserved for reads that go on to
 * ask for repositories, pull requests, or a git remote. Widening THOSE to a tracker would attribute a Jira
 * host's remotes to Jira; narrowing THESE to git hosts would key a tracker's connections under an empty
 * domain, collapsing every host of it into one bucket.
 */
export function isSelfManagedHostIntegrationId(id: IntegrationIds): id is SelfManagedHostIntegrationIds {
	return isGitSelfManagedHostIntegrationId(id) || isIssuesSelfManagedHostIntegrationId(id);
}

/**
 * Whether this id belongs to a dedicated issue tracker (resource → project) rather than a git host.
 *
 * Decided from the id alone, so a read can refuse a mismatched surface — a repo/PR read asked of Jira, or an
 * issue-tracker project read asked of GitHub — before resolving a connection. The instance-level
 * {@link isIssuesIntegration} answers the same question once an integration is in hand.
 */
export function isIssuesHostIntegrationId(id: IntegrationIds): id is IssuesHostIntegrationIds {
	switch (id) {
		case IssuesCloudHostIntegrationId.Jira:
		case IssuesCloudHostIntegrationId.Linear:
		case IssuesCloudHostIntegrationId.Trello:
		case IssuesSelfManagedHostIntegrationId.JiraServer:
			return true;
		default:
			return false;
	}
}

/**
 * Whether a read targeted only by an explicit self-managed `domain` (no `connectionId`) must treat a
 * session-less core result as a broken target instead of an empty account. Without this, a self-managed host
 * addressed only by domain — the manual-token/external-auth case `domain` exists to cover — returns an empty
 * success with no warning and no `fetchFailed`, indistinguishable from "this host has nothing".
 */
export function warnOnMissingSessionForDomain(id: IntegrationIds, domain: string | undefined): boolean {
	return domain != null && isSelfManagedHostIntegrationId(id);
}

/** Maps an integration id to the git-remote provider type used by the remote-URL matcher. */
export function remoteProviderTypeForIntegration(id: IntegrationIds): RemoteProviderId | undefined {
	switch (id) {
		case GitCloudHostIntegrationId.GitHub:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return 'github';
		case GitCloudHostIntegrationId.GitLab:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return 'gitlab';
		case GitCloudHostIntegrationId.Bitbucket:
			return 'bitbucket';
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return 'bitbucket-server';
		case GitCloudHostIntegrationId.AzureDevOps:
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return 'azure-devops';
		default:
			return undefined;
	}
}

/** Normalizes a host remote-config `type` string (e.g. `'GitHub'`) to a git-remote provider type. */
export function remoteProviderTypeForConfig(type: string): RemoteProviderId | undefined {
	switch (type.toLowerCase()) {
		case 'github':
			return 'github';
		case 'gitlab':
			return 'gitlab';
		case 'bitbucket':
			return 'bitbucket';
		case 'bitbucket-server':
		case 'bitbucketserver':
			return 'bitbucket-server';
		case 'azuredevops':
		case 'azure-devops':
			return 'azure-devops';
		case 'gitea':
			return 'gitea';
		case 'gerrit':
			return 'gerrit';
		default:
			return undefined;
	}
}

export function getSelfManagedBaseUrl(
	id: IntegrationIds,
	domain: string | undefined,
	protocol?: string,
): string | undefined {
	const baseUrl = baseUrlFromDomain(domain, protocol);
	if (baseUrl == null) return undefined;

	switch (id) {
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return baseUrl.replace(/\/api(?:\/v\d+)?$/, '');
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return baseUrl.replace(/\/rest\/api\/1\.0$/, '');
		default:
			return baseUrl;
	}
}
