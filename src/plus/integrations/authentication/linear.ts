import type { Disposable, Event } from 'vscode';
import type { Sources } from '../../../constants.telemetry';
import { configuration } from '../../../system/-webview/configuration';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthenticationProvider';
import type { ProviderAuthenticationSession } from './models';

export class LinearAuthenticationProvider implements IntegrationAuthenticationProvider {
	// I want to read the token from the config "temporary-configured-linear-config":
	private currentToken: string | undefined =
		(configuration.get('temporary-configured-linear-config') as string) ?? undefined;

	deleteSession(_descriptor: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		//throw new Error('Method not implemented.');
		this.currentToken = undefined;
		return Promise.resolve();
	}
	deleteAllSessions(): Promise<void> {
		//throw new Error('Method not implemented.');
		this.currentToken = undefined;
		return Promise.resolve();
	}
	getSession(
		_descriptor: IntegrationAuthenticationSessionDescriptor,
		_options?:
			| { createIfNeeded?: boolean; forceNewSession?: boolean; sync?: never; source?: Sources }
			| { createIfNeeded?: never; forceNewSession?: never; sync: boolean; source?: Sources },
	): Promise<ProviderAuthenticationSession | undefined> {
		return Promise.resolve(
			this.currentToken
				? {
						accessToken: this.currentToken,
						id: 'linear',
						account: {
							id: 'linear',
							label: 'Linear',
						},
						scopes: ['read'],
						cloud: true,
						expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
						domain: 'linear.app',
					}
				: undefined,
		);
	}
	get onDidChange(): Event<void> {
		return (_listener: (e: void) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable => {
			return { dispose: () => {} };
		};
	}
	dispose(): void {}
}
