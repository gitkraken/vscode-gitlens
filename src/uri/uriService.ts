import type { Disposable, Event, Uri, UriHandler } from 'vscode';
import { EventEmitter, window } from 'vscode';
import type { Container } from '../container';
import type { DeepLinkType } from '../deepLink/deepLink';
import { DeepLinkTypes } from '../deepLink/deepLink';
import { log } from '../system/decorators/log';
import type { DeepLinkUriEvent, UriEvent } from './uri';
import { UriTypes } from './uri';

// This service is in charge of registering a URI handler and handling/emitting URI events received by GitLens.
// URI events to GitLens take the form of: vscode://eamodio.gitlens/... and are handled by the UriEventHandler.
// The UriEventHandler is responsible for parsing the URI and emitting the event to the UriService.
export class UriService implements Disposable {
	private _disposable: Disposable;
	private _uriHandler: UriHandler = { handleUri: this.handleUri.bind(this) };
	private _uriEventEmitter: EventEmitter<UriEvent> = new EventEmitter<UriEvent>();

	constructor(private readonly container: Container) {
		this._disposable = window.registerUriHandler(this._uriHandler);
	}

	dispose() {
		this._disposable.dispose();
	}

	get onUri(): Event<UriEvent> {
		return this._uriEventEmitter.event;
	}

	// Set up a deep link event based on the following specifications:
	// 1. Remote link type: /repolink/{repoId}?url={remoteUrl}
	// 2. Branch link type: /repolink/{repoId}/branch/{branchName}?url={remoteUrl}
	// 3. Tag link type: /repolink/{repoId}/tag/{tagName}?url={remoteUrl}
	// 4. Commit link type: /repolink/{repoId}/commit/{commitSha}?url={remoteUrl}
	// If the url does not fit any of the above specifications, return null
	// If the url does fit one of the above specifications, return the deep link event
	private formatDeepLinkUriEvent(uri: Uri): DeepLinkUriEvent | null {
		const uriSplit = uri.path.split('/');
		if (uriSplit.length < 2) return null;
		const uriType = uriSplit[1];
		if (uriType !== UriTypes.DeepLink) return null;
		const repoId = uriSplit[2];
		const remoteUrl = this.parseQuery(uri).url;
		if (uriSplit.length === 3) {
			return {
				type: UriTypes.DeepLink,
				linkType: DeepLinkTypes.Remote,
				uri: uri,
				repoId: repoId,
				remoteUrl: remoteUrl,
			};
		}

		const linkTarget = uriSplit[3];
		// The link target id is everything after the link target.
		// For example, if the uri is /repolink/{repoId}/branch/{branchName}?url={remoteUrl},
		// the link target id is {branchName}
		const linkTargetId = uriSplit.slice(4).join('/');

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
			this._uriEventEmitter.fire({ type: UriTypes.Auth, uri: uri });
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
