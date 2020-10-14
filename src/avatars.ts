'use strict';
import * as fs from 'fs';
import { EventEmitter, Uri } from 'vscode';
import { GravatarDefaultStyle } from './config';
import { WorkspaceState } from './constants';
import { Container } from './container';
import { GitRevisionReference } from './git/git';
import { Functions, Strings } from './system';
import { ContactPresenceStatus } from './vsls/vsls';

// TODO@eamodio Use timestamp
// TODO@eamodio Clear avatar cache on remote / provider connection change

interface Avatar<T = Uri> {
	uri?: T | null;
	fallback: T;
	timestamp: number;
	// TODO@eamodio Add a fail count, to avoid failing on a single failure
}

type SerializedAvatar = Avatar<string>;

let avatarCache: Map<string, Avatar> | undefined;
const avatarQueue = new Map<string, Promise<Uri>>();

const missingGravatarHash = '00000000000000000000000000000000';

const presenceCache = new Map<ContactPresenceStatus, string>();

const gitHubNoReplyAddressRegex = /^(?:(?<userId>\d+)\+)?(?<userName>[a-zA-Z\d-]{1,39})@users\.noreply\.github\.com$/;

const _onDidFetchAvatar = new EventEmitter<{ email: string }>();
export const onDidFetchAvatar = _onDidFetchAvatar.event;

onDidFetchAvatar(
	Functions.debounce(() => {
		void Container.context.workspaceState.update(
			WorkspaceState.Avatars,
			avatarCache == null
				? undefined
				: [...avatarCache.entries()].map<[string, SerializedAvatar]>(([key, value]) => [
						key,
						{
							uri: value.uri != null ? value.uri.toString() : value.uri,
							fallback: value.fallback.toString(),
							timestamp: value.timestamp,
						},
				  ]),
		);
	}, 1000),
);

export function clearAvatarCache() {
	avatarCache?.clear();
	avatarQueue.clear();
	void Container.context.workspaceState.update(WorkspaceState.Avatars, undefined);
}

function ensureAvatarCache(cache: Map<string, Avatar> | undefined): asserts cache is Map<string, Avatar> {
	if (cache == null) {
		const avatars: [string, Avatar][] | undefined = Container.context.workspaceState
			.get<[string, SerializedAvatar][]>(WorkspaceState.Avatars)
			?.map<[string, Avatar]>(([key, value]) => [
				key,
				{
					uri: value.uri != null ? Uri.parse(value.uri) : value.uri,
					fallback: Uri.parse(value.fallback),
					timestamp: value.timestamp,
				},
			]);
		avatarCache = new Map<string, Avatar>(avatars);
	}
}

export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit: string | GitRevisionReference | undefined,
	{ fallback, size = 16 }: { fallback?: GravatarDefaultStyle; size?: number } = {},
): Uri | Promise<Uri> {
	ensureAvatarCache(avatarCache);

	if (email == null || email.length === 0) {
		const key = `${missingGravatarHash}:${size}`;

		let avatar = avatarCache.get(key);
		if (avatar == null) {
			avatar = {
				fallback: Uri.parse(
					`https://www.gravatar.com/avatar/${missingGravatarHash}.jpg?s=${size}&d=${fallback}`,
				),
				timestamp: Date.now(),
			};
			avatarCache.set(key, avatar);
		}

		return avatar.uri ?? avatar.fallback;
	}

	const hash = Strings.md5(email.trim().toLowerCase(), 'hex');
	const key = `${hash}:${size}`;

	let avatar = avatarCache.get(key);
	if (avatar == null) {
		avatar = {
			uri: getAvatarUriFromGitHubNoReplyAddress(email, size),
			fallback: Uri.parse(`https://www.gravatar.com/avatar/${hash}.jpg?s=${size}&d=${fallback}`),
			timestamp: Date.now(),
		};
		avatarCache.set(key, avatar);
	}

	if (avatar.uri != null) return avatar.uri;

	let query = avatarQueue.get(key);
	if (query == null && avatar.uri === undefined && repoPathOrCommit != null) {
		query = getAvatarUriFromRemoteProvider(key, email, repoPathOrCommit, avatar.fallback, { size: size }).then(
			uri => uri ?? avatar!.uri ?? avatar!.fallback,
		);
		avatarQueue.set(key, query);
	}

	if (query != null) return query;

	return avatar.uri ?? avatar.fallback;
}

function getAvatarUriFromGitHubNoReplyAddress(email: string, size: number = 16): Uri | undefined {
	const match = gitHubNoReplyAddressRegex.exec(email);
	if (match == null) return undefined;

	const [, userId, userName] = match;
	return Uri.parse(`https://avatars.githubusercontent.com/${userId ? `u/${userId}` : userName}?size=${size}`);
}

async function getAvatarUriFromRemoteProvider(
	key: string,
	email: string,
	repoPathOrCommit: string | GitRevisionReference,
	fallback: Uri,
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
			avatarCache.set(key, { uri: null, fallback: fallback, timestamp: Date.now() });

			return undefined;
		}

		const uri = Uri.parse(account.avatarUrl);
		avatarCache.set(key, { uri: uri, fallback: fallback, timestamp: Date.now() });
		if (account.email != null && Strings.equalsIgnoreCase(email, account.email)) {
			avatarCache.set(`${Strings.md5(account.email.trim().toLowerCase(), 'hex')}:${size}`, {
				uri: uri,
				fallback: fallback,
				timestamp: Date.now(),
			});
		}

		_onDidFetchAvatar.fire({ email: email });

		return uri;
	} catch {
		avatarCache.set(key, { uri: null, fallback: fallback, timestamp: Date.now() });

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
