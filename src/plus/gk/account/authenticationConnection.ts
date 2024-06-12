import type { CancellationToken, Disposable, StatusBarItem } from 'vscode';
import { CancellationTokenSource, env, StatusBarAlignment, Uri, window } from 'vscode';
import { uuid } from '@env/crypto';
import type { Response } from '@env/fetch';
import type { Container } from '../../../container';
import { debug } from '../../../system/decorators/log';
import type { DeferredEvent, DeferredEventExecutor } from '../../../system/event';
import { promisifyDeferred } from '../../../system/event';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import { openUrl } from '../../../system/utils';
import type { ServerConnection } from '../serverConnection';

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

	@debug<AuthenticationConnection['getAccountInfo']>({ args: false, exit: r => `returned ${r.id}` })
	async getAccountInfo(token: string): Promise<AccountInfo> {
		const scope = getLogScope();

		let rsp: Response;
		try {
			rsp = await this.connection.fetchApi('user', undefined, { token: token });
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
	async login(scopes: string[], scopeKey: string, signUp: boolean = false): Promise<string> {
		this.updateStatusBarItem(true);

		// Include a state parameter here to prevent CSRF attacks
		const gkstate = uuid();
		const existingStates = this._pendingStates.get(scopeKey) ?? [];
		this._pendingStates.set(scopeKey, [...existingStates, gkstate]);

		const callbackUri = await env.asExternalUri(
			Uri.parse(`${env.uriScheme}://${this.container.context.extension.id}/${AuthenticationUriPathPrefix}`),
		);

		const uri = this.container.getGkDevUri(
			signUp ? 'register' : 'login',
			`${scopes.includes('gitlens') ? 'source=gitlens&' : ''}state=${encodeURIComponent(
				gkstate,
			)}&redirect_uri=${encodeURIComponent(callbackUri.toString(true))}`,
		);

		void (await openUrl(uri.toString(true)));

		// Ensure there is only a single listener for the URI callback, in case the user starts the login process multiple times before completing it
		let deferredCodeExchange = this._deferredCodeExchanges.get(scopeKey);
		if (deferredCodeExchange == null) {
			deferredCodeExchange = promisifyDeferred(
				this.container.uri.onDidReceiveAuthenticationUri,
				this.getUriHandlerDeferredExecutor(),
			);
			this._deferredCodeExchanges.set(scopeKey, deferredCodeExchange);
		}

		if (this._cancellationSource != null) {
			this._cancellationSource.cancel();
			this._cancellationSource = undefined;
		}

		this._cancellationSource = new CancellationTokenSource();

		try {
			const code = await Promise.race([
				deferredCodeExchange.promise,
				new Promise<string>(resolve =>
					this.openCompletionInputFallback(this._cancellationSource!.token, resolve),
				),
				new Promise<string>(
					(_, reject) =>
						// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
						this._cancellationSource?.token.onCancellationRequested(() => reject('Cancelled')),
				),
				new Promise<string>((_, reject) => setTimeout(reject, 120000, 'Cancelled')),
			]);

			const token = await this.getTokenFromCodeAndState(scopeKey, code, gkstate);
			return token;
		} finally {
			this._cancellationSource?.cancel();
			this._cancellationSource = undefined;

			this._pendingStates.delete(scopeKey);
			deferredCodeExchange?.cancel();
			this._deferredCodeExchanges.delete(scopeKey);
			this.updateStatusBarItem(false);
		}
	}

	private async openCompletionInputFallback(cancellationToken: CancellationToken, resolve: (token: string) => void) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];
		let code: string | undefined = undefined;

		try {
			if (cancellationToken.isCancellationRequested) return;

			code = await new Promise<string | undefined>(resolve => {
				disposables.push(
					cancellationToken.onCancellationRequested(() => input.hide()),
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(e => {
						if (!e) {
							input.validationMessage = 'Please enter a valid code';
							return;
						}

						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => resolve(input.value)),
				);

				input.title = 'GitKraken Sign In';
				input.placeholder = 'Please enter the provided authorization code';
				input.prompt = 'If the auto-redirect fails, paste the authorization code';

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (code != null) {
			resolve(code);
		}
	}

	private async getTokenFromCodeAndState(scopeKey: string, code: string, state: string): Promise<string> {
		const existingStates = this._pendingStates.get(scopeKey);
		if (!existingStates?.includes(state)) {
			throw new Error('Getting token failed: Invalid state');
		}

		const rsp = await this.connection.fetchGkDevApi(
			'oauth/access_token',
			{
				method: 'POST',
				body: JSON.stringify({
					grant_type: 'authorization_code',
					client_id: 'gitkraken.gitlens',
					code: code,
					state: state,
				}),
			},
			{
				unAuthenticated: true,
			},
		);

		if (!rsp.ok) {
			throw new Error(`Getting token failed: (${rsp.status}) ${rsp.statusText}`);
		}

		const json: { access_token: string } = await rsp.json();
		if (json.access_token == null) {
			throw new Error('Getting token failed: No access token returned');
		}

		return json.access_token;
	}

	private getUriHandlerDeferredExecutor(): DeferredEventExecutor<Uri, string> {
		return (uri: Uri, resolve, reject) => {
			const queryParams: URLSearchParams = new URLSearchParams(uri.query);
			const code = queryParams.get('code');
			if (code == null) {
				reject('Code not returned');
				return;
			}

			resolve(code);
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
