import type { AuthenticationSession } from 'vscode';
import { IssueIntegrationId } from '../providers/models';

export interface ProviderAuthenticationSession extends AuthenticationSession {
	readonly expiresAt?: Date;
}

export type CloudIntegrationTokenData = {
	accessToken: string;
	type: CloudIntegrationConnectionType;
	domain: string;
	expiresIn: number;
	scopes: string;
};

export type CloudIntegrationAuthorizationData = {
	url: string;
};

export type ConnectedCloudIntegrationData = {
	type: CloudIntegrationConnectionType;
	provider: CloudIntegrationType;
	domain: string;
};

export type CloudIntegrationType = 'jira' | 'trello' | 'gitlab' | 'github' | 'bitbucket' | 'azure';

export type CloudIntegrationConnectionType = 'oauth' | 'personal_access_token';

export const CloudIntegrationAuthenticationUriPathPrefix = 'did-authenticate-cloud-integration';

export const supportedCloudIntegrationIds = [IssueIntegrationId.Jira];
