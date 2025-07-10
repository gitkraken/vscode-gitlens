import type { Event, Uri, UriHandler } from 'vscode';
import { Disposable, EventEmitter, window } from 'vscode';
import type { Container } from '../container';
import { AuthenticationUriPathPrefix, LoginUriPathPrefix } from '../plus/gk/authenticationConnection';
import { AiAllAccessOptInPathPrefix, SubscriptionUpdatedUriPathPrefix } from '../plus/gk/utils/subscription.utils';
import { CloudIntegrationAuthenticationUriPathPrefix } from '../plus/integrations/authentication/models';
import { log } from '../system/decorators/log';

// This service is in charge of registering a URI handler and handling/emitting URI events received by GitLens.
// URI events to GitLens take the form of: vscode://eamodio.gitlens/... and are handled by the UriEventHandler.
// The UriEventHandler is responsible for parsing the URI and emitting the event to the UriService.
export class UriService implements Disposable, UriHandler {
	private _onDidReceiveAuthenticationUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveAuthenticationUri(): Event<Uri> {
		return this._onDidReceiveAuthenticationUri.event;
	}

	private _onDidReceiveCloudIntegrationAuthenticationUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveCloudIntegrationAuthenticationUri(): Event<Uri> {
		return this._onDidReceiveCloudIntegrationAuthenticationUri.event;
	}

	private _onDidReceiveLoginUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveLoginUri(): Event<Uri> {
		return this._onDidReceiveLoginUri.event;
	}

	private _onDidReceiveSubscriptionUpdatedUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveSubscriptionUpdatedUri(): Event<Uri> {
		return this._onDidReceiveSubscriptionUpdatedUri.event;
	}

	private _onDidReceiveAiAllAccessOptInUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveAiAllAccessOptInUri(): Event<Uri> {
		return this._onDidReceiveAiAllAccessOptInUri.event;
	}

	private _onDidReceiveUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveUri(): Event<Uri> {
		return this._onDidReceiveUri.event;
	}

	private _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this._onDidReceiveAuthenticationUri,
			this._onDidReceiveCloudIntegrationAuthenticationUri,
			this._onDidReceiveLoginUri,
			this._onDidReceiveSubscriptionUpdatedUri,
			this._onDidReceiveAiAllAccessOptInUri,
			this._onDidReceiveUri,
			window.registerUriHandler(this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	@log<UriHandler['handleUri']>({ args: { 0: u => u.with({ query: '' }).toString(true) } })
	handleUri(uri: Uri): void {
		const [, type] = uri.path.split('/');
		if (type === AuthenticationUriPathPrefix) {
			this._onDidReceiveAuthenticationUri.fire(uri);
			return;
		} else if (type === CloudIntegrationAuthenticationUriPathPrefix) {
			this._onDidReceiveCloudIntegrationAuthenticationUri.fire(uri);
			return;
		} else if (type === SubscriptionUpdatedUriPathPrefix) {
			this._onDidReceiveSubscriptionUpdatedUri.fire(uri);
			return;
		} else if (type === AiAllAccessOptInPathPrefix) {
			this._onDidReceiveAiAllAccessOptInUri.fire(uri);
			return;
		} else if (type === LoginUriPathPrefix) {
			this._onDidReceiveLoginUri.fire(uri);
			return;
		}

		this._onDidReceiveUri.fire(uri);
	}
}
