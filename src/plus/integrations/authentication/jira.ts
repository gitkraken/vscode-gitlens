import type { CancellationToken, Disposable } from 'vscode';
import { CancellationTokenSource, window } from 'vscode';
import { Logger } from '../../../system/logger';
import { cancellable } from '../../../system/promise';
import { openUrl } from '../../../system/utils';
import type { ServerConnection } from '../../gk/serverConnection';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthentication';
import type { ProviderAuthenticationSession } from './models';

type ConnectionType = 'oauth' | 'personal_access_token';

type ProviderTokenData = {
	accessToken: string;
	type: ConnectionType;
	domain: string;
	expiresIn: number;
	scopes: string;
};

type ProviderAuthorizationData = {
	url: string;
};

/* type ProviderRsp<T> = {
	data: T | null;
	error: string | null;
}; */

type providerInput = 'jira' | 'trello' | 'gitlab' | 'github' | 'bitbucket' | 'azure';

export class JiraAuthenticationProvider implements IntegrationAuthenticationProvider {
	constructor(private readonly connection: ServerConnection) {}

	private readonly authProviderId = 'jira';

	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	private async getTokenData(
		provider: providerInput,
		refresh: boolean = false,
	): Promise<ProviderTokenData | undefined> {
		const tokenRsp = await this.connection.fetchGkDevApi(
			`v1/provider-tokens/${provider}${refresh ? '/refresh' : ''}`,
			{ method: refresh ? 'POST' : 'GET' },
		);
		if (!tokenRsp.ok) {
			// TODO: Handle errors
			const error = (await tokenRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to ${refresh ? 'refresh' : 'get'} ${provider} token from cloud: ${error}`);
			}
			return undefined;
		}

		return (await tokenRsp.json())?.data as Promise<ProviderTokenData | undefined>;
	}

	private async authorize(provider: providerInput): Promise<ProviderAuthorizationData | undefined> {
		const authorizeRsp = await this.connection.fetchGkDevApi(
			`v1/provider-tokens/${provider}/authorize`,
			{
				method: 'GET',
			},
			{
				query: 'source=gitlens',
			},
		);
		if (!authorizeRsp.ok) {
			// TODO: HANDLE ERROR
			const error = (await authorizeRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to authorize with ${provider}: ${error}`);
			}
			return undefined;
		}

		return (await authorizeRsp.json())?.data as Promise<ProviderAuthorizationData | undefined>;
	}

	async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		let tokenData = await this.getTokenData(this.authProviderId);

		if (tokenData != null && tokenData.expiresIn < 60) {
			tokenData = await this.getTokenData(this.authProviderId, true);
		}

		if (!tokenData) {
			const authorizeJiraUrl = (await this.authorize(this.authProviderId))?.url;

			if (!authorizeJiraUrl) return undefined;

			void (await openUrl(authorizeJiraUrl));

			const cancellation = new CancellationTokenSource();
			try {
				await cancellable(this.openCompletionInput(cancellation.token), 2 * 60 * 1000, cancellation.token);
				tokenData = await this.getTokenData(this.authProviderId);
			} catch {
				tokenData = undefined;
			} finally {
				cancellation.dispose();
			}
		}

		if (!tokenData) return undefined;

		return {
			id: this.getSessionId(descriptor),
			accessToken: tokenData.accessToken,
			scopes: descriptor?.scopes ?? [],
			account: {
				id: '',
				label: '',
			},
			expiresAt: new Date(tokenData.expiresIn * 1000 + Date.now()),
		};
	}

	private async openCompletionInput(cancellationToken: CancellationToken) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			if (cancellationToken.isCancellationRequested) return;

			await new Promise<string | undefined>(resolve => {
				disposables.push(
					cancellationToken.onCancellationRequested(() => input.hide()),
					input.onDidHide(() => resolve(undefined)),
					input.onDidAccept(() => resolve(undefined)),
				);

				input.title = 'Connect to Jira';
				input.placeholder = 'Please enter the provided authorization code';
				input.prompt = '';

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}
}
