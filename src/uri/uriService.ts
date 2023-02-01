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

	// Set up a deep link event based on the following specifications:
	// 1. Remote link type: /link/r/{repoId}?url={remoteUrl}
	// 2. Branch link type: /link/r/{repoId}/b/{branchName}?url={remoteUrl}
	// 3. Tag link type: /link/r/{repoId}/t/{tagName}?url={remoteUrl}
	// 4. Commit link type: /link/r/{repoId}/c/{commitSha}?url={remoteUrl}
	// If the url does not fit any of the above specifications, return null
	// If the url does fit one of the above specifications, return the deep link event
	private formatDeepLinkUriEvent(uri: Uri): DeepLinkUriEvent | null {
		const uriSplit = uri.path.split('/');
		if (uriSplit.length < 2) return null;
		const uriType = uriSplit[1];
		if (uriType !== UriTypes.DeepLink) return null;
		const repoTag = uriSplit[2];
		if (repoTag !== 'r') return null;
		const repoId = uriSplit[3];
		const remoteUrl = this.parseQuery(uri).url;
		if (uriSplit.length === 4) {
			return {
				type: UriTypes.DeepLink,
				linkType: DeepLinkType.Remote,
				uri: uri,
				repoId: repoId,
				remoteUrl: remoteUrl,
			};
		}

		const linkTarget = uriSplit[4];
		// The link target id is everything after the link target.
		// For example, if the uri is /link/r/{repoId}/b/{branchName}?url={remoteUrl},
		// the link target id is {branchName}
		const linkTargetId = uriSplit.slice(5).join('/');

		return {
			type: UriTypes.DeepLink,
			linkType: linkTarget as DeepLinkType,
			uri: uri,
			repoId: repoId,
			remoteUrl: remoteUrl,
			targetId: linkTargetId,
		};
	}

	parseQuery(uri: Uri): Record<string, string> {
		return uri.query.split('&').reduce<Record<string, string>>((prev, current) => {
			const queryString = current.split('=');
			prev[queryString[0]] = queryString[1];
			return prev;
		}, {});
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
			const deepLinkEvent: DeepLinkUriEvent | null = this.formatDeepLinkUriEvent(uri);
			if (deepLinkEvent) {
				this._uriEventEmitter.fire(deepLinkEvent);
			}
		}
	}
}
