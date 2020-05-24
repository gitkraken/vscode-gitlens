'use strict';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { GravatarDefaultStyle } from './config';
import { Strings } from './system';
import { ContactPresenceStatus } from './vsls/vsls';
import { Container } from './container';

const avatarCache = new Map<string, Uri>();
const missingGravatarHash = '00000000000000000000000000000000';

const presenceCache = new Map<ContactPresenceStatus, string>();

const gitHubNoReplyAddressRegex = /^(?:(?<userId>\d+)\+)?(?<userName>[a-zA-Z\d-]{1,39})@users\.noreply\.github\.com$/;

export function clearAvatarCache() {
	avatarCache.clear();
}

function getAvatarUriFromGitHubNoReplyAddress(email: string | undefined, size: number = 16): Uri | undefined {
	if (email == null || email.length === 0) return undefined;

	const match = gitHubNoReplyAddressRegex.exec(email);
	if (match == null) return undefined;

	const [, userId, userName] = match;
	return Uri.parse(`https://avatars.githubusercontent.com/${userId ? `u/${userId}` : userName}?size=${size}`);
}

export function getAvatarUri(email: string | undefined, fallback: GravatarDefaultStyle, size: number = 16): Uri {
	const hash =
		email != null && email.length !== 0 ? Strings.md5(email.trim().toLowerCase(), 'hex') : missingGravatarHash;

	const key = `${hash}:${size}`;
	let avatar = avatarCache.get(key);
	if (avatar !== undefined) return avatar;

	avatar =
		getAvatarUriFromGitHubNoReplyAddress(email, size) ??
		Uri.parse(`https://www.gravatar.com/avatar/${hash}.jpg?s=${size}&d=${fallback}`);
	avatarCache.set(key, avatar);

	return avatar;
}

export function getPresenceDataUri(status: ContactPresenceStatus) {
	let dataUri = presenceCache.get(status);
	if (dataUri === undefined) {
		const contents = fs
			.readFileSync(Container.context.asAbsolutePath(`images/dark/icon-presence-${status}.svg`))
			.toString('base64');

		dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
		presenceCache.set(status, dataUri);
	}

	return dataUri;
}
