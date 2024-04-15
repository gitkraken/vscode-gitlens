import type { AuthenticationSession } from 'vscode';
import { IssueIntegrationId } from '../providers/models';

export interface ProviderAuthenticationSession extends AuthenticationSession {
	readonly expiresAt?: Date;
}

export type CloudIntegrationConnection = {
	accessToken: string;
	type: CloudIntegrationConnectionType;
	domain: string;
	expiresIn: number;
	scopes: string;
};

export type CloudIntegrationAuthorization = {
	url: string;
};

export type ConnectedCloudIntegration = {
	type: CloudIntegrationConnectionType;
	provider: CloudIntegrationType;
	domain: string;
};

export type CloudIntegrationType = 'jira' | 'trello' | 'gitlab' | 'github' | 'bitbucket' | 'azure';

export type CloudIntegrationConnectionType = 'oauth' | 'personal_access_token';

export const CloudIntegrationAuthenticationUriPathPrefix = 'did-authenticate-cloud-integration';

export const supportedCloudIntegrationIds = [IssueIntegrationId.Jira];
