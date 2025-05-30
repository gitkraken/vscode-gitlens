import type { Disposable, Event, Uri, UriHandler } from 'vscode';
import { EventEmitter, window } from 'vscode';
import type { Container } from '../container';
import { AuthenticationUriPathPrefix } from '../plus/subscription/serverConnection';
import { log } from '../system/decorators/log';

// This service is in charge of registering a URI handler and handling/emitting URI events received by GitLens.
// URI events to GitLens take the form of: vscode://eamodio.gitlens/... and are handled by the UriEventHandler.
// The UriEventHandler is responsible for parsing the URI and emitting the event to the UriService.
export class UriService implements Disposable, UriHandler {
	private _disposable: Disposable;

	private _onDidReceiveAuthenticationUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveAuthenticationUri(): Event<Uri> {
		return this._onDidReceiveAuthenticationUri.event;
	}

	private _onDidReceiveUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveUri(): Event<Uri> {
		return this._onDidReceiveUri.event;
	}

	constructor(private readonly container: Container) {
		this._disposable = window.registerUriHandler(this);
	}

	dispose() {
		this._disposable.dispose();
	}

	@log<UriHandler['handleUri']>({ args: { 0: u => u.with({ query: '' }).toString(true) } })
	handleUri(uri: Uri) {
		const [, type] = uri.path.split('/');
		if (type === AuthenticationUriPathPrefix) {
			this._onDidReceiveAuthenticationUri.fire(uri);
			return;
		}

		this._onDidReceiveUri.fire(uri);
	}
}
