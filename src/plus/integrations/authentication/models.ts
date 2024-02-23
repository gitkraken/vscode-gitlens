import type { AuthenticationSession } from 'vscode';

export interface ProviderAuthenticationSession extends AuthenticationSession {
	readonly expiresAt?: Date;
}
