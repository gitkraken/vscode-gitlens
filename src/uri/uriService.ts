import type { Disposable, Event, Uri, UriHandler } from 'vscode';
import { EventEmitter, window } from 'vscode';
import type { Container } from '../container';
import { DeepLinkType } from '../deepLink/deepLink';
import { log } from '../system/decorators/log';
import type { DeepLinkUriEvent, DidAuthUriEvent, UriEvent } from './uri';
import { UriTypes } from './uri';

// This service is in charge of registering a URI handler and handling/emitting URI events received by GitLens.
// URI events to GitLens take the form of: vscode://eamodio.gitlens/... and are handled by the UriEventHandler.
// The UriEventHandler is responsible for parsing the URI and emitting the event to the UriService.
export class UriService implements Disposable, UriHandler {
	private _disposable: Disposable;
	private _uriEventEmitter: EventEmitter<UriEvent> = new EventEmitter<UriEvent>();

	constructor(private readonly container: Container) {
		this._disposable = window.registerUriHandler(this);
	}

	dispose() {
		this._disposable.dispose();
	}

	get onDidReceiveUri(): Event<UriEvent> {
		return this._uriEventEmitter.event;
	}

	private formatDeepLinkUriEvent(uri: Uri): DeepLinkUriEvent | undefined {
		// The link target id is everything after the link target.
		// For example, if the uri is /link/r/{repoId}/b/{branchName}?url={remoteUrl},
		// the link target id is {branchName}
		const [, type, prefix, repoId, target, ...targetId] = uri.path.split('/');
		if (type !== UriTypes.DeepLink || prefix !== DeepLinkType.Repository) return undefined;

		const remoteUrl = new URLSearchParams(uri.query).get('url');
		if (!remoteUrl) return undefined;

		if (target == null) {
			return {
				type: UriTypes.DeepLink,
				linkType: DeepLinkType.Repository,
				uri: uri,
				repoId: repoId,
				remoteUrl: remoteUrl,
			};
		}

		return {
			type: UriTypes.DeepLink,
			linkType: target as DeepLinkType,
			uri: uri,
			repoId: repoId,
			remoteUrl: remoteUrl,
			targetId: targetId.join('/'),
		};
	}

	@log<UriHandler['handleUri']>({ args: { 0: u => u.with({ query: '' }).toString(true) } })
	handleUri(uri: Uri) {
		const uriSplit = uri.path.split('/');
		if (uriSplit.length < 2) return;
		const uriType = uriSplit[1];
		if (uriType !== UriTypes.Auth && uriType !== UriTypes.DeepLink) return;
		if (uriType === UriTypes.Auth) {
			const didAuthEvent: DidAuthUriEvent = { type: UriTypes.Auth, uri: uri };
			this._uriEventEmitter.fire(didAuthEvent);
			return;
		}

		if (uriType === UriTypes.DeepLink) {
			const deepLinkEvent: DeepLinkUriEvent | undefined = this.formatDeepLinkUriEvent(uri);
			if (deepLinkEvent) {
				this._uriEventEmitter.fire(deepLinkEvent);
			}
		}
	}
}
