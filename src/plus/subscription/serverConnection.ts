import { v4 as uuid } from 'uuid';
import { Disposable, env, EventEmitter, StatusBarAlignment, StatusBarItem, Uri, UriHandler, window } from 'vscode';
import { fetch, getProxyAgent, Response } from '@env/fetch';
import { Container } from '../../container';
import { Logger } from '../../logger';
import { debug, log } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { DeferredEvent, DeferredEventExecutor, promisifyDeferred } from '../../system/event';

interface AccountInfo {
	id: string;
	accountName: string;
}

export class ServerConnection implements Disposable {
	private _deferredCodeExchanges = new Map<string, DeferredEvent<string>>();
	private _disposable: Disposable;
	private _pendingStates = new Map<string, string[]>();
	private _statusBarItem: StatusBarItem | undefined;
	private _uriHandler = new UriEventHandler();

	constructor(private readonly container: Container) {
		this._disposable = window.registerUriHandler(this._uriHandler);
	}

	dispose() {
		this._disposable.dispose();
	}

	@memoize()
	private get baseApiUri(): Uri {
		if (this.container.env === 'staging') {
			return Uri.parse('https://stagingapi.gitkraken.com');
		}

		if (this.container.env === 'dev') {
			return Uri.parse('https://devapi.gitkraken.com');
		}

		return Uri.parse('https://api.gitkraken.com');
	}

	@memoize()
	private get baseAccountUri(): Uri {
		if (this.container.env === 'staging') {
			return Uri.parse('https://stagingaccount.gitkraken.com');
		}

		if (this.container.env === 'dev') {
			return Uri.parse('https://devaccount.gitkraken.com');
		}

		return Uri.parse('https://account.gitkraken.com');
	}

	@debug({ args: false })
	public async getAccountInfo(token: string): Promise<AccountInfo> {
		const cc = Logger.getCorrelationContext();

		let rsp: Response;
		try {
			rsp = await fetch(Uri.joinPath(this.baseApiUri, 'user').toString(), {
				agent: getProxyAgent(),
				headers: {
					Authorization: `Bearer ${token}`,
					// TODO: What user-agent should we use?
					'User-Agent': 'Visual-Studio-Code-GitLens',
				},
			});
		} catch (ex) {
			Logger.error(ex, cc);
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
	public async login(scopes: string[], scopeKey: string): Promise<string> {
		this.updateStatusBarItem(true);

		// Include a state parameter here to prevent CSRF attacks
		const gkstate = uuid();
		const existingStates = this._pendingStates.get(scopeKey) ?? [];
		this._pendingStates.set(scopeKey, [...existingStates, gkstate]);

		const callbackUri = await env.asExternalUri(
			Uri.parse(`${env.uriScheme}://${this.container.context.extension.id}/did-authenticate?gkstate=${gkstate}`),
		);

		const uri = Uri.joinPath(this.baseAccountUri, 'register').with({
			query: `${
				scopes.includes('gitlens') ? 'referrer=gitlens&' : ''
			}pass-token=true&return-url=${encodeURIComponent(callbackUri.toString())}`,
		});
		void (await env.openExternal(uri));

		// Ensure there is only a single listener for the URI callback, in case the user starts the login process multiple times before completing it
		let deferredCodeExchange = this._deferredCodeExchanges.get(scopeKey);
		if (deferredCodeExchange == null) {
			deferredCodeExchange = promisifyDeferred(
				this._uriHandler.event,
				this.getUriHandlerDeferredExecutor(scopeKey),
			);
			this._deferredCodeExchanges.set(scopeKey, deferredCodeExchange);
		}

		return Promise.race([
			deferredCodeExchange.promise,
			new Promise<string>((_, reject) => setTimeout(() => reject('Cancelled'), 60000)),
		]).finally(() => {
			this._pendingStates.delete(scopeKey);
			deferredCodeExchange?.cancel();
			this._deferredCodeExchanges.delete(scopeKey);
			this.updateStatusBarItem(false);
		});
	}

	private getUriHandlerDeferredExecutor(_scopeKey: string): DeferredEventExecutor<Uri, string> {
		return (uri: Uri, resolve, reject) => {
			// TODO: We should really support a code to token exchange, but just return the token from the query string
			// await this.exchangeCodeForToken(uri.query);
			// As the backend still doesn't implement yet the code to token exchange, we just validate the state returned
			const query = parseQuery(uri);

			const acceptedStates = this._pendingStates.get(_scopeKey);

			if (acceptedStates == null || !acceptedStates.includes(query.gkstate)) {
				// A common scenario of this happening is if you:
				// 1. Trigger a sign in with one set of scopes
				// 2. Before finishing 1, you trigger a sign in with a different set of scopes
				// In this scenario we should just return and wait for the next UriHandler event
				// to run as we are probably still waiting on the user to hit 'Continue'
				Logger.log('State not found in accepted state. Skipping this execution...');
				return;
			}

			const token = query['access-token'];
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
			this._statusBarItem.name = 'GitLens+ Sign in';
			this._statusBarItem.text = 'Signing into GitLens+...';
			this._statusBarItem.show();
		}

		if (!signingIn && this._statusBarItem != null) {
			this._statusBarItem.dispose();
			this._statusBarItem = undefined;
		}
	}
}

class UriEventHandler extends EventEmitter<Uri> implements UriHandler {
	@log()
	public handleUri(uri: Uri) {
		this.fire(uri);
	}
}

function parseQuery(uri: Uri): Record<string, string> {
	return uri.query.split('&').reduce((prev, current) => {
		const queryString = current.split('=');
		prev[queryString[0]] = queryString[1];
		return prev;
	}, {} as Record<string, string>);
}
