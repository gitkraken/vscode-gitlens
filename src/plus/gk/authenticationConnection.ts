import type { CancellationToken, Disposable, StatusBarItem } from 'vscode';
import { CancellationTokenSource, env, StatusBarAlignment, Uri, window } from 'vscode';
import { uuid } from '@env/crypto';
import type { Response } from '@env/fetch';
import type { Container } from '../../container';
import { debug } from '../../system/decorators/log';
import type { DeferredEvent, DeferredEventExecutor } from '../../system/event';
import { promisifyDeferred } from '../../system/event';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { ServerConnection } from './serverConnection';

export const AuthenticationUriPathPrefix = 'did-authenticate';

interface AccountInfo {
	id: string;
	accountName: string;
}

export class AuthenticationConnection implements Disposable {
	private _cancellationSource: CancellationTokenSource | undefined;
	private _deferredCodeExchanges = new Map<string, DeferredEvent<string>>();
	private _pendingStates = new Map<string, string[]>();
	private _statusBarItem: StatusBarItem | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose() {}

	abort(): Promise<void> {
		if (this._cancellationSource == null) return Promise.resolve();

		this._cancellationSource.cancel();
		// This should allow the current auth request to abort before continuing
		return new Promise<void>(resolve => setTimeout(resolve, 50));
	}

	@debug({ args: false })
	async getAccountInfo(token: string): Promise<AccountInfo> {
		const scope = getLogScope();

		let rsp: Response;
		try {
			rsp = await this.connection.fetchApi('user', undefined, token);
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}

		if (!rsp.ok) {
			Logger.error(undefined, `Getting account info failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const json: { id: string; username: string } = await rsp.json();
		return { id: json.id, accountName: json.username };
	}

	@debug()
	async login(scopes: string[], scopeKey: string): Promise<string> {
		this.updateStatusBarItem(true);

		// Include a state parameter here to prevent CSRF attacks
		const gkstate = uuid();
		const existingStates = this._pendingStates.get(scopeKey) ?? [];
		this._pendingStates.set(scopeKey, [...existingStates, gkstate]);

		const callbackUri = await env.asExternalUri(
			Uri.parse(
				`${env.uriScheme}://${this.container.context.extension.id}/${AuthenticationUriPathPrefix}?gkstate=${gkstate}`,
			),
		);

		const uri = this.connection.getAccountsUri(
			'register',
			`${scopes.includes('gitlens') ? 'referrer=gitlens&' : ''}pass-token=true&return-url=${encodeURIComponent(
				callbackUri.toString(),
			)}`,
		);
		void (await env.openExternal(uri));

		// Ensure there is only a single listener for the URI callback, in case the user starts the login process multiple times before completing it
		let deferredCodeExchange = this._deferredCodeExchanges.get(scopeKey);
		if (deferredCodeExchange == null) {
			deferredCodeExchange = promisifyDeferred(
				this.container.uri.onDidReceiveAuthenticationUri,
				this.getUriHandlerDeferredExecutor(scopeKey),
			);
			this._deferredCodeExchanges.set(scopeKey, deferredCodeExchange);
		}

		if (this._cancellationSource != null) {
			this._cancellationSource.cancel();
			this._cancellationSource = undefined;
		}

		this._cancellationSource = new CancellationTokenSource();

		void this.openCompletionInputFallback(this._cancellationSource.token);

		return Promise.race([
			deferredCodeExchange.promise,
			new Promise<string>(
				(_, reject) =>
					// eslint-disable-next-line prefer-promise-reject-errors
					this._cancellationSource?.token.onCancellationRequested(() => reject('Cancelled')),
			),
			new Promise<string>((_, reject) => setTimeout(reject, 120000, 'Cancelled')),
		]).finally(() => {
			this._cancellationSource?.cancel();
			this._cancellationSource = undefined;

			this._pendingStates.delete(scopeKey);
			deferredCodeExchange?.cancel();
			this._deferredCodeExchanges.delete(scopeKey);
			this.updateStatusBarItem(false);
		});
	}

	private async openCompletionInputFallback(cancellationToken: CancellationToken) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			if (cancellationToken.isCancellationRequested) return;

			const uri = await new Promise<Uri | undefined>(resolve => {
				disposables.push(
					cancellationToken.onCancellationRequested(() => input.hide()),
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(e => {
						if (!e) {
							input.validationMessage = undefined;
							return;
						}

						try {
							const uri = Uri.parse(e.trim());
							if (uri.scheme && uri.scheme !== 'file') {
								input.validationMessage = undefined;
								return;
							}
						} catch {}

						input.validationMessage = 'Please enter a valid authorization URL';
					}),
					input.onDidAccept(() => resolve(Uri.parse(input.value.trim()))),
				);

				input.title = 'GitKraken Sign In';
				input.placeholder = 'Please enter the provided authorization URL';
				input.prompt = 'If the auto-redirect fails, paste the authorization URL';

				input.show();
			});

			if (uri != null) {
				this.container.uri.handleUri(uri);
			}
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}

	private getUriHandlerDeferredExecutor(_scopeKey: string): DeferredEventExecutor<Uri, string> {
		return (uri: Uri, resolve, reject) => {
			// TODO: We should really support a code to token exchange, but just return the token from the query string
			// await this.exchangeCodeForToken(uri.query);
			// As the backend still doesn't implement yet the code to token exchange, we just validate the state returned
			const queryParams: URLSearchParams = new URLSearchParams(uri.query);

			const acceptedStates = this._pendingStates.get(_scopeKey);
			const state = queryParams.get('gkstate');

			if (acceptedStates == null || !state || !acceptedStates.includes(state)) {
				// A common scenario of this happening is if you:
				// 1. Trigger a sign in with one set of scopes
				// 2. Before finishing 1, you trigger a sign in with a different set of scopes
				// In this scenario we should just return and wait for the next UriHandler event
				// to run as we are probably still waiting on the user to hit 'Continue'
				Logger.log('State not found in accepted state. Skipping this execution...');
				return;
			}

			const accessToken = queryParams.get('access-token');
			const code = queryParams.get('code');
			const token = accessToken ?? code;

			if (token == null) {
				reject('Token not returned');
			} else {
				resolve(token);
			}
		};
	}

	private updateStatusBarItem(signingIn?: boolean) {
		if (signingIn && this._statusBarItem == null) {
			this._statusBarItem = window.createStatusBarItem('gitlens.plus.signIn', StatusBarAlignment.Left);
			this._statusBarItem.name = 'GitKraken Sign in';
			this._statusBarItem.text = 'Signing in to GitKraken...';
			this._statusBarItem.show();
		}

		if (!signingIn && this._statusBarItem != null) {
			this._statusBarItem.dispose();
			this._statusBarItem = undefined;
		}
	}
}
