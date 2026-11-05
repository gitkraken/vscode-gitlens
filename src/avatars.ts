import type { MessageItem } from 'vscode';
import { EventEmitter, l10n, Uri, window, workspace } from 'vscode';
import { fetch } from '@env/fetch.js';
import type { CommitAuthor } from '@gitlens/git/models/author.js';
import { CustomRemoteProvider } from '@gitlens/git/remotes/custom.js';
import { getGitHubNoReplyAddressParts } from '@gitlens/git/remotes/github.js';
import { base64 } from '@gitlens/utils/base64.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { GravatarDefaultStyle } from './config.js';
import type { StoredAvatar } from './constants.storage.js';
import { Container } from './container.js';
import {
	getBestRemoteWithIntegration,
	getRemoteIntegration,
	remoteSupportsIntegration,
} from './git/utils/-webview/remote.utils.js';
import { configuration } from './system/-webview/configuration.js';
import { getContext } from './system/-webview/context.js';
import type { ContactPresenceStatus } from './vsls/vsls.js';

let avatarCache: Map<string, Avatar> | undefined;
const avatarQueue = new Map<string, Promise<Uri>>();

const maxAvatarProxyBytes = 512 * 1024; // 512 KB
const rasterImageTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

const _onDidFetchAvatar = new EventEmitter<{ email: string }>();
_onDidFetchAvatar.event(
	debounce(() => {
		const avatars =
			avatarCache != null
				? [
						...filterMap(avatarCache, ([key, avatar]) =>
							avatar.uri != null
								? ([
										key,
										{
											uri: avatar.uri.toString(),
											timestamp: avatar.timestamp,
										},
									] as [string, StoredAvatar])
								: undefined,
						),
					]
				: undefined;
		void Container.instance.storage.store('avatars', avatars).catch();
	}, 1000),
);

export const onDidFetchAvatar = _onDidFetchAvatar.event;

/** User-supplied avatars from the `gitlens.avatars` setting, resolved to data Uris.
 * Kept separate from `avatarCache` so they are never persisted to storage —
 * a file's contents can change, and a stored base64 blob would go stale. */
const userAvatarCache = new Map<string, Uri>();
const userAvatarQueue = new Map<string, Promise<Uri | undefined>>();

const userAvatarMimeTypes = new Map<string, string>([
	['gif', 'image/gif'],
	['jpg', 'image/jpeg'],
	['jpeg', 'image/jpeg'],
	['png', 'image/png'],
	['webp', 'image/webp'],
]);

/** Finds the file mapped to an author email in the `gitlens.avatars` setting,
 * matching setting keys case-insensitively. */
export function findUserAvatarValue(
	email: string,
	avatars: Record<string, string> | null | undefined,
): string | undefined {
	if (avatars == null) return undefined;

	const normalizedEmail = email.trim().toLowerCase();
	for (const [key, value] of Object.entries(avatars)) {
		if (key.trim().toLowerCase() === normalizedEmail) return value;
	}

	return undefined;
}

/** Resolves a `gitlens.avatars` value to a file Uri. Plain paths become file Uris;
 * values that already carry a `file:` scheme are used as-is. Anything else is unsupported. */
export function getUserAvatarFileUri(value: string): Uri | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;

	// Windows drive paths (e.g. `C:\avatars\jane.png`) are file paths, not URI schemes
	if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return Uri.file(trimmed);

	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
		const uri = Uri.parse(trimmed);
		return uri.scheme === 'file' ? uri : undefined;
	}

	return Uri.file(trimmed);
}

/** Maps an avatar file path to its image media type. Only raster formats are supported,
 * matching the avatar proxy's allow-list. */
export function getUserAvatarMimeType(filePath: string): string | undefined {
	const index = filePath.lastIndexOf('.');
	if (index === -1) return undefined;

	return userAvatarMimeTypes.get(filePath.slice(index + 1).toLowerCase());
}

/** Reads a user-supplied avatar file and returns it as a data Uri, which renders in
 * webviews, hovers, and tree views alike. Returns `undefined` when the file can't be
 * used, so callers fall back to the normal avatar chain. */
export async function loadUserAvatarAsDataUri(value: string): Promise<Uri | undefined> {
	const fileUri = getUserAvatarFileUri(value);
	if (fileUri == null) return undefined;

	const mimeType = getUserAvatarMimeType(fileUri.fsPath);
	if (mimeType == null) return undefined;

	let bytes: Uint8Array;
	try {
		bytes = await workspace.fs.readFile(fileUri);
	} catch {
		return undefined;
	}

	if (bytes.byteLength === 0 || bytes.byteLength > maxAvatarProxyBytes) return undefined;

	return Uri.parse(`data:${mimeType};base64,${base64(bytes)}`);
}

function queueUserAvatar(userKey: string, value: string, email: string): Promise<Uri | undefined> {
	let query = userAvatarQueue.get(userKey);
	if (query == null) {
		query = loadUserAvatarAsDataUri(value).then(uri => {
			if (uri != null) {
				userAvatarCache.set(userKey, uri);
				_onDidFetchAvatar.fire({ email: email });
			}

			return uri;
		});
		userAvatarQueue.set(
			userKey,
			query.finally(() => userAvatarQueue.delete(userKey)),
		);
	}

	return query;
}

interface Avatar {
	uri?: Uri;
	fallback?: Uri;
	timestamp: number;
	retries: number;
}

const missingGravatarHash = '00000000000000000000000000000000';

const presenceCache = new Map<ContactPresenceStatus, string>();

const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

const retryDecay = [
	millisecondsPerDay * 7, // First item is cache expiration (since retries will be 0)
	millisecondsPerMinute,
	millisecondsPerMinute * 5,
	millisecondsPerMinute * 10,
	millisecondsPerHour,
	millisecondsPerDay,
	millisecondsPerDay * 7,
];

/** Resource usage retained by the avatar cache and fetch queue. */
export function getAvatarResourceUsage(): ResourceUsage {
	return {
		'cache.entries.count': avatarCache?.size ?? 0,
		'fetchQueue.pending.count': avatarQueue.size,
	};
}

export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit?: undefined,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri;
export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string },
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri>;
export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> {
	return getAvatarUriCore(email, repoPathOrCommit, options);
}

export function getCachedAvatarUri(email: string | undefined, options?: { size?: number }): Uri | undefined {
	return getAvatarUriCore(email, undefined, { ...options, cached: true });
}

function getAvatarUriCore(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { cached: true; defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | undefined;
function getAvatarUriCore(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri>;
function getAvatarUriCore(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { cached?: boolean; defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> | undefined {
	ensureAvatarCache(avatarCache);

	// Double the size to avoid blurring on the retina screen
	const size = (options?.size ?? 16) * 2;

	if (!email) {
		const avatar = createOrUpdateAvatar(
			`${missingGravatarHash}:${size}`,
			undefined,
			size,
			missingGravatarHash,
			options?.defaultStyle,
		);
		return avatar.uri ?? avatar.fallback!;
	}

	const hash = md5(email.trim().toLowerCase());
	const key = `${hash}:${size}`;

	const avatar = createOrUpdateAvatar(key, email, size, hash, options?.defaultStyle);

	// User-supplied avatars from the `gitlens.avatars` setting take priority over every
	// other source — they exist precisely for authors whose hosting avatars don't resolve.
	const userAvatarValue = findUserAvatarValue(email, configuration.get('avatars'));
	if (userAvatarValue != null) {
		const userKey = `${email.trim().toLowerCase()}:${userAvatarValue}`;
		const userAvatar = userAvatarCache.get(userKey);
		if (userAvatar != null) return userAvatar;

		if (!options?.cached) {
			return queueUserAvatar(userKey, userAvatarValue, email).then(uri => uri ?? avatar.uri ?? avatar.fallback!);
		}

		// Cached-only callers can't wait for a file read — kick off the load so the
		// next render hits, and fall through to the normal chain for this render.
		void queueUserAvatar(userKey, userAvatarValue, email);
	}

	if (avatar.uri != null) return avatar.uri;

	if (
		!options?.cached &&
		repoPathOrCommit != null &&
		getContext('gitlens:repos:withRemotes')?.includes(
			typeof repoPathOrCommit === 'string' ? repoPathOrCommit : repoPathOrCommit.repoPath,
		)
	) {
		let query = avatarQueue.get(key);
		if (query == null && hasAvatarExpired(avatar)) {
			query = getAvatarUriFromRemoteProvider(avatar, key, email, repoPathOrCommit, { size: size }).then(
				uri => uri ?? avatar.uri ?? avatar.fallback!,
			);
			avatarQueue.set(
				key,
				query.finally(() => avatarQueue.delete(key)),
			);
		}

		return query ?? avatar.fallback!;
	}

	return options?.cached ? avatar.uri : (avatar.uri ?? avatar.fallback!);
}

function createOrUpdateAvatar(
	key: string,
	email: string | undefined,
	size: number,
	hash: string,
	defaultStyle?: GravatarDefaultStyle,
): Avatar {
	let avatar = avatarCache!.get(key);
	if (avatar == null) {
		avatar = {
			uri: email?.length ? getAvatarUriFromGitHubNoReplyAddress(email, size) : undefined,
			fallback: getAvatarUriFromGravatar(hash, size, defaultStyle),
			timestamp: 0,
			retries: 0,
		};
		avatarCache!.set(key, avatar);
	} else {
		avatar.fallback ??= getAvatarUriFromGravatar(hash, size, defaultStyle);
	}
	return avatar;
}

function ensureAvatarCache(cache: Map<string, Avatar> | undefined): asserts cache is Map<string, Avatar> {
	if (cache == null) {
		const avatars: [string, Avatar][] | undefined = Container.instance.storage
			.get('avatars')
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

function getAvatarUriFromGravatar(hash: string, size: number, defaultStyle?: GravatarDefaultStyle): Uri {
	return Uri.parse(
		`https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultStyle ?? getDefaultGravatarStyle()}`,
	);
}

export function getAvatarUriFromGravatarEmail(email: string, size: number, defaultStyle?: GravatarDefaultStyle): Uri {
	return getAvatarUriFromGravatar(md5(email.trim().toLowerCase()), size, defaultStyle);
}

function getAvatarUriFromGitHubNoReplyAddress(email: string, size: number = 16): Uri | undefined {
	if (email === 'noreply@github.com') {
		return Uri.parse('https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png');
	}

	const parts = getGitHubNoReplyAddressParts(email);
	if (parts == null || !equalsIgnoreCase(parts.authority, 'github.com')) return undefined;

	return Uri.parse(
		`https://avatars.githubusercontent.com/${parts.userId ? `u/${parts.userId}` : parts.login}?size=${size}`,
	);
}

async function getAvatarUriFromRemoteProvider(
	avatar: Avatar,
	_key: string,
	email: string,
	repoPathOrCommit: string | { ref: string; repoPath: string },
	{ size = 16 }: { size?: number } = {},
) {
	ensureAvatarCache(avatarCache);

	try {
		let account: CommitAuthor | undefined;
		let hasAvatarSource = false;
		// if (typeof repoPathOrCommit === 'string') {
		// 	const remote = await Container.instance.git.getRichRemoteProvider(repoPathOrCommit);
		// 	account = await remote?.provider.getAccountForEmail(email, { avatarSize: size });
		// } else {
		if (typeof repoPathOrCommit !== 'string') {
			const remote = await getBestRemoteWithIntegration(repoPathOrCommit.repoPath);
			if (remote != null && remoteSupportsIntegration(remote)) {
				hasAvatarSource = true;
				account = await (
					await getRemoteIntegration(remote)
				)?.getAccountForCommit(remote.provider.repoDesc, repoPathOrCommit.ref, {
					avatarSize: size,
				});
			}

			if (!account?.avatarUrl) {
				const remoteWithProvider = await Container.instance.git
					.getRepositoryService(repoPathOrCommit.repoPath)
					.remotes.getBestRemoteWithProvider();

				if (remoteWithProvider?.provider instanceof CustomRemoteProvider) {
					const avatarUrl = getApprovedCustomRemoteAvatarUrl(remoteWithProvider.provider, email, size);
					if (avatarUrl != null) {
						avatar.uri = Uri.parse(avatarUrl);
						avatar.timestamp = Date.now();
						avatar.retries = 0;
						avatarCache.set(`${md5(email.trim().toLowerCase())}:${size}`, { ...avatar });
						_onDidFetchAvatar.fire({ email: email });
						return avatar.uri;
					}
				}
			}
		}

		if (account?.avatarUrl == null) {
			if (hasAvatarSource) {
				// A provider was consulted but returned no avatar — permanently cache "no result"
				avatar.uri = undefined;
				avatar.timestamp = Infinity;
				avatar.retries = 0;
			}

			return undefined;
		}

		avatar.uri = Uri.parse(account.avatarUrl);
		avatar.timestamp = Date.now();
		avatar.retries = 0;

		if (account.email != null && equalsIgnoreCase(email, account.email)) {
			avatarCache.set(`${md5(account.email.trim().toLowerCase())}:${size}`, { ...avatar });
		}

		_onDidFetchAvatar.fire({ email: email });

		return avatar.uri;
	} catch {
		avatar.uri = undefined;
		avatar.timestamp = Date.now();
		avatar.retries++;

		return undefined;
	}
}

export async function fetchAvatarImageAsDataUri(url: string): Promise<Uri | undefined> {
	try {
		if (!url.startsWith('https://')) return undefined;

		const rsp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!rsp.ok) {
			void rsp.body?.cancel();
			return undefined;
		}
		if (!rsp.url.startsWith('https://')) {
			void rsp.body?.cancel();
			return undefined;
		}

		const contentType = rsp.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (!rasterImageTypes.has(contentType ?? '')) {
			void rsp.body?.cancel();
			return undefined;
		}

		const contentLength = rsp.headers.get('content-length');
		if (contentLength != null && parseInt(contentLength, 10) > maxAvatarProxyBytes) {
			void rsp.body?.cancel();
			return undefined;
		}

		const buffer = await rsp.arrayBuffer();
		if (buffer.byteLength > maxAvatarProxyBytes) return undefined;

		const data = base64(new Uint8Array(buffer));
		return Uri.parse(`data:${contentType};base64,${data}`);
	} catch {
		return undefined;
	}
}

const presenceStatusColorMap = new Map<ContactPresenceStatus, string>([
	['online', '#28ca42'],
	['away', '#cecece'],
	['busy', '#ca5628'],
	['dnd', '#ca5628'],
	['offline', '#cecece'],
]);

export function getPresenceDataUri(status: ContactPresenceStatus): string {
	let dataUri = presenceCache.get(status);
	if (dataUri == null) {
		const contents = base64(`<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="4" height="16" viewBox="0 0 4 16">
	<circle cx="2" cy="14" r="2" fill="${presenceStatusColorMap.get(status)!}"/>
</svg>`);
		dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
		presenceCache.set(status, dataUri);
	}

	return dataUri;
}

const promptedAvatarTemplates = new Set<string>();

function getApprovedCustomRemoteAvatarUrl(
	provider: CustomRemoteProvider,
	email: string,
	size: number,
): string | undefined {
	// Avatar templates from `gitlens.remotes` may originate from workspace settings
	// — only honor them in a trusted workspace
	if (!workspace.isTrusted) return undefined;

	const template = provider.avatarUrlTemplate;
	if (template == null) return undefined;

	const approval = getAvatarTemplateApproval(template);
	if (approval === 'allow') {
		return provider.getUrlForAvatar(email, size);
	}
	if (approval === 'deny') {
		return undefined;
	}

	// Unknown template — prompt the user (non-blocking) and fall through to fallback avatar
	void promptForAvatarTemplateApproval(template);
	return undefined;
}

function getAvatarTemplateApproval(template: string): 'allow' | 'deny' | undefined {
	const approvals = Container.instance.storage.get('avatars:approvedRemoteTemplates');
	if (approvals == null) return undefined;
	return Object.hasOwn(approvals, template) ? approvals[template] : undefined;
}

async function setAvatarTemplateApproval(template: string, decision: 'allow' | 'deny'): Promise<void> {
	const approvals: Record<string, 'allow' | 'deny'> = Object.create(null);
	Object.assign(approvals, Container.instance.storage.get('avatars:approvedRemoteTemplates'));
	approvals[template] = decision;
	await Container.instance.storage.store('avatars:approvedRemoteTemplates', approvals);
}

async function promptForAvatarTemplateApproval(template: string): Promise<void> {
	if (promptedAvatarTemplates.has(template)) return;

	promptedAvatarTemplates.add(template);

	const allow: MessageItem = { title: l10n.t('Allow') };
	const deny: MessageItem = { title: l10n.t('Deny') };
	const notNow: MessageItem = { title: l10n.t('Not Now'), isCloseAffordance: true };

	const result = await window.showInformationMessage(
		l10n.t(
			'The `gitlens.remotes` setting in this workspace includes an avatar URL template that will be requested for every commit author.\n\nTemplate: {0}\n\nDo you trust this workspace to make these requests?',
			template,
		),
		allow,
		deny,
		notNow,
	);

	if (result === allow) {
		await setAvatarTemplateApproval(template, 'allow');
		resetAvatarCache('failed');
	} else if (result === deny) {
		await setAvatarTemplateApproval(template, 'deny');
	}
}

export function resetApprovedAvatarTemplates(): Promise<void> {
	promptedAvatarTemplates.clear();
	resetAvatarCache('failed');
	return Container.instance.storage.delete('avatars:approvedRemoteTemplates');
}

export function resetAvatarCache(reset: 'all' | 'failed' | 'fallback'): void {
	switch (reset) {
		case 'all':
			void Container.instance.storage.delete('avatars');
			avatarCache?.clear();
			avatarQueue.clear();
			userAvatarCache.clear();
			userAvatarQueue.clear();
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

let defaultGravatarsStyle: GravatarDefaultStyle | undefined = undefined;
function getDefaultGravatarStyle() {
	defaultGravatarsStyle ??= configuration.get('defaultGravatarsStyle', undefined, 'robohash');
	return defaultGravatarsStyle;
}

export function setDefaultGravatarsStyle(style: GravatarDefaultStyle): void {
	defaultGravatarsStyle = style;
	resetAvatarCache('fallback');
}
