'use strict';
import * as fs from 'fs';
import { EventEmitter, Uri } from 'vscode';
import { GravatarDefaultStyle } from './config';
import { GlobalState } from './constants';
import { Container } from './container';
import { GitRevisionReference } from './git/git';
import { Functions, Iterables, Strings } from './system';
import { MillisecondsPerDay, MillisecondsPerHour, MillisecondsPerMinute } from './system/date';
import { ContactPresenceStatus } from './vsls/vsls';

const _onDidFetchAvatar = new EventEmitter<{ email: string }>();
_onDidFetchAvatar.event(
	Functions.debounce(() => {
		const avatars =
			avatarCache != null
				? [
						...Iterables.filterMap(avatarCache, ([key, avatar]) =>
							avatar.uri != null
								? [
										key,
										{
											uri: avatar.uri.toString(),
											timestamp: avatar.timestamp,
										},
								  ]
								: undefined,
						),
				  ]
				: undefined;
		void Container.context.globalState.update(GlobalState.Avatars, avatars);
	}, 1000),
);

export namespace Avatars {
	export const onDidFetch = _onDidFetchAvatar.event;
}

interface Avatar {
	uri?: Uri;
	fallback?: Uri;
	timestamp: number;
	retries: number;
}

interface SerializedAvatar {
	uri: string;
	timestamp: number;
}

let avatarCache: Map<string, Avatar> | undefined;
const avatarQueue = new Map<string, Promise<Uri>>();

const missingGravatarHash = '00000000000000000000000000000000';

const presenceCache = new Map<ContactPresenceStatus, string>();

const gitHubNoReplyAddressRegex = /^(?:(?<userId>\d+)\+)?(?<userName>[a-zA-Z\d-]{1,39})@users\.noreply\.github\.com$/;

const retryDecay = [
	MillisecondsPerDay * 7, // First item is cache expiration (since retries will be 0)
	MillisecondsPerMinute,
	MillisecondsPerMinute * 5,
	MillisecondsPerMinute * 10,
	MillisecondsPerHour,
	MillisecondsPerDay,
	MillisecondsPerDay * 7,
];

export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit: string | GitRevisionReference | undefined,
	{ defaultStyle, size = 16 }: { defaultStyle?: GravatarDefaultStyle; size?: number } = {},
): Uri | Promise<Uri> {
	ensureAvatarCache(avatarCache);

	if (email == null || email.length === 0) {
		const avatar = createOrUpdateAvatar(
			`${missingGravatarHash}:${size}`,
			undefined,
			missingGravatarHash,
			size,
			defaultStyle,
		);
		return avatar.uri ?? avatar.fallback!;
	}

	const hash = Strings.md5(email.trim().toLowerCase(), 'hex');
	const key = `${hash}:${size}`;

	const avatar = createOrUpdateAvatar(
		key,
		getAvatarUriFromGitHubNoReplyAddress(email, size),
		hash,
		size,
		defaultStyle,
	);
	if (avatar.uri != null) return avatar.uri;

	let query = avatarQueue.get(key);
	if (query == null && repoPathOrCommit != null && hasAvatarExpired(avatar)) {
		query = getAvatarUriFromRemoteProvider(avatar, key, email, repoPathOrCommit, { size: size }).then(
			uri => uri ?? avatar.uri ?? avatar.fallback!,
		);
		avatarQueue.set(key, query);
	}

	if (query != null) return query;

	return avatar.uri ?? avatar.fallback!;
}

function createOrUpdateAvatar(
	key: string,
	uri: Uri | undefined,
	hash: string,
	size: number,
	defaultStyle?: GravatarDefaultStyle,
): Avatar {
	let avatar = avatarCache!.get(key);
	if (avatar == null) {
		avatar = {
			uri: uri,
			fallback: getAvatarUriFromGravatar(hash, size, defaultStyle),
			timestamp: 0,
			retries: 0,
		};
		avatarCache!.set(key, avatar);
	} else if (avatar.fallback == null) {
		avatar.fallback = getAvatarUriFromGravatar(hash, size, defaultStyle);
	}
	return avatar;
}

function ensureAvatarCache(cache: Map<string, Avatar> | undefined): asserts cache is Map<string, Avatar> {
	if (cache == null) {
		const avatars: [string, Avatar][] | undefined = Container.context.globalState
			.get<[string, SerializedAvatar][]>(GlobalState.Avatars)
			?.map<[string, Avatar]>(([key, avatar]) => [
				key,
				{
					uri: Uri.parse(avatar.uri),
					timestamp: avatar.timestamp,
					retries: 0,
				},
			]);
		avatarCache = new Map<string, Avatar>(avatars);
	}
}

function hasAvatarExpired(avatar: Avatar) {
	return Date.now() >= avatar.timestamp + retryDecay[Math.min(avatar.retries, retryDecay.length - 1)];
}

function getAvatarUriFromGravatar(
	hash: string,
	size: number,
	defaultStyle: GravatarDefaultStyle = GravatarDefaultStyle.Robot,
): Uri {
	return Uri.parse(`https://www.gravatar.com/avatar/${hash}.jpg?s=${size}&d=${defaultStyle}`);
}

function getAvatarUriFromGitHubNoReplyAddress(email: string, size: number = 16): Uri | undefined {
	const match = gitHubNoReplyAddressRegex.exec(email);
	if (match == null) return undefined;

	const [, userId, userName] = match;
	return Uri.parse(`https://avatars.githubusercontent.com/${userId ? `u/${userId}` : userName}?size=${size}`);
}

async function getAvatarUriFromRemoteProvider(
	avatar: Avatar,
	key: string,
	email: string,
	repoPathOrCommit: string | GitRevisionReference,
	{ size = 16 }: { size?: number } = {},
) {
	ensureAvatarCache(avatarCache);

	try {
		let account;
		// if (typeof repoPathOrCommit === 'string') {
		// 	const remote = await Container.git.getRemoteWithApiProvider(repoPathOrCommit);
		// 	account = await remote?.provider.getAccountForEmail(email, { avatarSize: size });
		// } else {
		if (typeof repoPathOrCommit !== 'string') {
			const remote = await Container.git.getRemoteWithApiProvider(repoPathOrCommit.repoPath);
			account = await remote?.provider.getAccountForCommit(repoPathOrCommit.ref, { avatarSize: size });
		}
		if (account == null) {
			// If we have no account assume that won't change (without a reset), so set the timestamp to "never expire"
			avatar.uri = undefined;
			avatar.timestamp = Number.MAX_SAFE_INTEGER;
			avatar.retries = 0;

			return undefined;
		}

		avatar.uri = Uri.parse(account.avatarUrl);
		avatar.timestamp = Date.now();
		avatar.retries = 0;

		if (account.email != null && Strings.equalsIgnoreCase(email, account.email)) {
			avatarCache.set(`${Strings.md5(account.email.trim().toLowerCase(), 'hex')}:${size}`, { ...avatar });
		}

		_onDidFetchAvatar.fire({ email: email });

		return avatar.uri;
	} catch {
		avatar.uri = undefined;
		avatar.timestamp = Date.now();
		avatar.retries++;

		return undefined;
	} finally {
		avatarQueue.delete(key);
	}
}

export function getPresenceDataUri(status: ContactPresenceStatus) {
	let dataUri = presenceCache.get(status);
	if (dataUri == null) {
		const contents = fs
			.readFileSync(Container.context.asAbsolutePath(`images/dark/icon-presence-${status}.svg`))
			.toString('base64');

		dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
		presenceCache.set(status, dataUri);
	}

	return dataUri;
}

export function resetAvatarCache(reset: 'all' | 'failed' | 'fallback') {
	switch (reset) {
		case 'all':
			void Container.context.globalState.update(GlobalState.Avatars, undefined);
			avatarCache?.clear();
			avatarQueue.clear();
			break;

		case 'failed':
			for (const avatar of avatarCache?.values() ?? []) {
				// Reset failed requests
				if (avatar.uri == null) {
					avatar.timestamp = 0;
					avatar.retries = 0;
				}
			}
			break;

		case 'fallback':
			for (const avatar of avatarCache?.values() ?? []) {
				avatar.fallback = undefined;
			}
			break;
	}
}
