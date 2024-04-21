import type { AuthenticationSession } from 'vscode';
import { IssueIntegrationId } from '../providers/models';

export interface ProviderAuthenticationSession extends AuthenticationSession {
	readonly expiresAt?: Date;
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

// TODO@axosoft-ramint these constants don't match [IntegrationId](https://github.com/gitkraken/vscode-gitlens/blob/c3a5cf55d92ab4ca090f6f7d047be50414daa824/src/plus/integrations/providers/models.ts#L53)
export type CloudIntegrationType = 'jira' | 'trello' | 'gitlab' | 'github' | 'bitbucket' | 'azure';

// TODO@axosoft-ramint these constants don't match the docs
export type CloudIntegrationAuthType = 'oauth' | 'personal_access_token';

export const CloudIntegrationAuthenticationUriPathPrefix = 'did-authenticate-cloud-integration';

export const supportedCloudIntegrationIds = [IssueIntegrationId.Jira];
