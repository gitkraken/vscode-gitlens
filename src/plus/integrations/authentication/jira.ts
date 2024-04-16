import type { CancellationToken, Disposable, Uri } from 'vscode';
import { CancellationTokenSource, window } from 'vscode';
import type { Container } from '../../../container';
import type { DeferredEventExecutor } from '../../../system/event';
import { promisifyDeferred } from '../../../system/event';
import { openUrl } from '../../../system/utils';
import { IssueIntegrationId } from '../providers/models';
import type { CloudIntegrationsApi } from './cloudIntegrationsApi';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthentication';
import type { ProviderAuthenticationSession } from './models';

export class JiraAuthenticationProvider implements IntegrationAuthenticationProvider {
	constructor(
		private readonly container: Container,
		private readonly cloudIntegrationsApi: CloudIntegrationsApi | undefined,
	) {}

	private readonly authProviderId = IssueIntegrationId.Jira;

	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { authorizeIfNeeded?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		if (this.cloudIntegrationsApi == null) return undefined;
		let tokenData = await this.cloudIntegrationsApi.getTokenData(this.authProviderId);

		if (tokenData != null && tokenData.expiresIn < 60) {
			tokenData = await this.cloudIntegrationsApi.getTokenData(this.authProviderId, true);
		}

		if (!tokenData && options?.authorizeIfNeeded) {
			const authorizeJiraUrl = (await this.cloudIntegrationsApi.authorize(this.authProviderId))?.url;

			if (!authorizeJiraUrl) return undefined;

			void (await openUrl(authorizeJiraUrl));

			const cancellation = new CancellationTokenSource();
			const deferredCallback = promisifyDeferred(
				this.container.uri.onDidReceiveCloudIntegrationAuthenticationUri,
				this.getUriHandlerDeferredExecutor(),
			);

			try {
				await Promise.race([
					deferredCallback.promise,
					this.openCompletionInput(cancellation.token),
					new Promise<string>((_, reject) =>
						// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
						cancellation.token.onCancellationRequested(() => reject('Cancelled')),
					),
					new Promise<string>((_, reject) => setTimeout(reject, 120000, 'Cancelled')),
				]);
				tokenData = await this.cloudIntegrationsApi.getTokenData(this.authProviderId);
			} catch {
				tokenData = undefined;
			} finally {
				cancellation.cancel();
				cancellation.dispose();
				deferredCallback.cancel();
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

	private getUriHandlerDeferredExecutor(): DeferredEventExecutor<Uri, string> {
		return (uri: Uri, resolve, reject) => {
			const queryParams: URLSearchParams = new URLSearchParams(uri.query);
			const provider = queryParams.get('provider');
			if (provider !== IssueIntegrationId.Jira) {
				reject('Invalid provider');
				return;
			}

			resolve(uri.toString(true));
		};
	}
}
