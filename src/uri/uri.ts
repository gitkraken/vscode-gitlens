import type { Uri } from 'vscode';
import type { DeepLinkType } from '../deepLink/deepLink';

export enum UriTypes {
	Auth = 'did-authenticate',
	DeepLink = 'repolink',
}

export type DidAuthUriEvent = {
	type: UriTypes.Auth;
	uri: Uri;
};

export type DeepLinkUriEvent = {
	type: UriTypes.DeepLink;
	linkType: DeepLinkType;
	uri: Uri;
	repoId: string;
	remoteUrl: string;
	targetId?: string;
};

export type UriEvent = DidAuthUriEvent | DeepLinkUriEvent;
