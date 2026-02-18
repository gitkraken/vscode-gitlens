import type { AuthenticationSession } from 'vscode';
import type { IntegrationIds, SupportedCloudIntegrationIds } from '../../../constants.integrations.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	supportedOrderedCloudIntegrationIds,
	supportedOrderedCloudIssuesIntegrationIds,
} from '../../../constants.integrations.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { fnv1aHash } from '../../../system/hash.js';

export interface ProviderAuthenticationSession extends AuthenticationSession {
	readonly cloud: boolean;
	readonly type: CloudIntegrationAuthType | undefined;
	readonly expiresAt?: Date;
	readonly domain: string;
	readonly protocol?: string;
}

export interface TokenInfo<T extends IntegrationIds | 'gitkraken' = IntegrationIds | 'gitkraken'> {
	readonly providerId: T;
	/**
	 * The first 3 characters of the md5 hash of the token.
	 * It's a very obfuscated representation of the token that we can use in logs
	 * to see whether the token survives refreshing or gets updated.
	 */
	readonly microHash: string | undefined;
	readonly cloud: boolean;
	readonly type: CloudIntegrationAuthType | undefined;
	readonly scopes: readonly string[] | undefined;
	readonly expiresAt?: Date;
}

export interface TokenWithInfo<T extends IntegrationIds = IntegrationIds> extends TokenInfo<T> {
	readonly accessToken: string;
}

export function toTokenInfo<T extends IntegrationIds | 'gitkraken'>(
	providerId: T,
	accessToken: string | undefined,
	info: { cloud: boolean; type: CloudIntegrationAuthType | undefined; scopes?: readonly string[]; expiresAt?: Date },
): TokenInfo<T> {
	return {
		providerId: providerId,
		microHash: microhash(accessToken),
		cloud: info.cloud,
		type: info.type,
		scopes: info.scopes,
		expiresAt: info.expiresAt,
	};
}

export function toTokenWithInfo<T extends IntegrationIds>(
	providerId: T,
	session: ProviderAuthenticationSession,
	altToken?: string,
): TokenWithInfo<T> {
	const { accessToken: sessionToken, ...sessionInfo } = session;
	const accessToken = altToken ?? session.accessToken;
	return {
		// pass original token info to form the correlated microhash
		...toTokenInfo(providerId, sessionToken, sessionInfo),
		// use the actual token used for the request
		accessToken: accessToken,
	};
}

function microhash(token: undefined): undefined;
function microhash(token: string): string;
function microhash(token: string | undefined): string | undefined;
function microhash(token: string | undefined): string | undefined {
	return !token ? undefined : `@${(fnv1aHash(token) >>> 0).toString(16).padStart(8, '0').substring(0, 3)}`;
}

export type TokenOptInfo<T extends IntegrationIds = IntegrationIds> =
	| TokenWithInfo<T>
	| { providerId: T; accessToken?: undefined };

export interface ConfiguredIntegrationDescriptor {
	readonly cloud: boolean;
	readonly integrationId: IntegrationIds;
	readonly scopes: string;
	readonly domain?: string;
	readonly expiresAt?: string | Date;
}

export interface CloudIntegrationAuthenticationSession {
	type: CloudIntegrationAuthType;
	accessToken: string;
	domain: string;
	expiresIn: number;
	scopes: string;
}

export interface CloudIntegrationAuthorization {
	url: string;
}

export interface CloudIntegrationConnection {
	type: CloudIntegrationAuthType;
	provider: CloudIntegrationType;
	domain: string;
}

export type CloudIntegrationType =
	| 'jira'
	| 'linear'
	| 'trello'
	| 'gitlab'
	| 'github'
	| 'bitbucket'
	| 'bitbucketServer'
	| 'azure'
	| 'azureDevopsServer'
	| 'githubEnterprise'
	| 'gitlabSelfHosted';

export type CloudIntegrationAuthType = 'oauth' | 'pat';

export const CloudIntegrationAuthenticationUriPathPrefix = 'did-authenticate-cloud-integration';

export function getSupportedCloudIntegrationIds(): SupportedCloudIntegrationIds[] {
	return configuration.get('cloudIntegrations.enabled', undefined, true)
		? supportedOrderedCloudIntegrationIds
		: supportedOrderedCloudIssuesIntegrationIds;
}

export function isSupportedCloudIntegrationId(id: string): id is SupportedCloudIntegrationIds {
	return getSupportedCloudIntegrationIds().includes(id as SupportedCloudIntegrationIds);
}

export function isIssueCloudIntegrationId(id: string): id is IssuesCloudHostIntegrationId {
	const issueIds: string[] = Object.values(IssuesCloudHostIntegrationId);
	return issueIds.includes(id);
}

export const toIntegrationId: { [key in CloudIntegrationType]: IntegrationIds } = {
	jira: IssuesCloudHostIntegrationId.Jira,
	linear: IssuesCloudHostIntegrationId.Linear,
	trello: IssuesCloudHostIntegrationId.Trello,
	gitlab: GitCloudHostIntegrationId.GitLab,
	github: GitCloudHostIntegrationId.GitHub,
	githubEnterprise: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	gitlabSelfHosted: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	bitbucket: GitCloudHostIntegrationId.Bitbucket,
	bitbucketServer: GitSelfManagedHostIntegrationId.BitbucketServer,
	azure: GitCloudHostIntegrationId.AzureDevOps,
	azureDevopsServer: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
};

export const toCloudIntegrationType: { [key in IntegrationIds]: CloudIntegrationType | undefined } = {
	[IssuesCloudHostIntegrationId.Jira]: 'jira',
	[IssuesCloudHostIntegrationId.Linear]: 'linear',
	[IssuesCloudHostIntegrationId.Trello]: 'trello',
	[GitCloudHostIntegrationId.GitLab]: 'gitlab',
	[GitCloudHostIntegrationId.GitHub]: 'github',
	[GitCloudHostIntegrationId.Bitbucket]: 'bitbucket',
	[GitCloudHostIntegrationId.AzureDevOps]: 'azure',
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: 'azureDevopsServer',
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: 'githubEnterprise',
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: 'gitlabSelfHosted',
	[GitSelfManagedHostIntegrationId.BitbucketServer]: 'bitbucketServer',
	[GitSelfManagedHostIntegrationId.GitHubEnterprise]: undefined,
	[GitSelfManagedHostIntegrationId.GitLabSelfHosted]: undefined,
};
