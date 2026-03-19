import { decodeUtf8Hex, encodeUtf8Hex } from '@gitlens/utils/hex.js';

export interface RevisionUriData {
	ref?: string;
	repoPath: string;
	uncPath?: string;
	submoduleSha?: string;
}

export interface RevisionUriOptions {
	submoduleSha?: string;
}

export function encodeGitLensRevisionUriAuthority<T>(metadata: T): string {
	return encodeUtf8Hex(JSON.stringify(metadata));
}

export function decodeGitLensRevisionUriAuthority<T>(authority: string): T {
	return JSON.parse(decodeUtf8Hex(authority)) as T;
}

export function decodeRemoteHubAuthority<T>(authority: string): { scheme: string; metadata: T | undefined } {
	const [scheme, encoded] = authority.split('+');

	let metadata: T | undefined;
	if (encoded) {
		try {
			const data = JSON.parse(decodeUtf8Hex(encoded));
			metadata = data as T;
		} catch {}
	}

	return { scheme: scheme, metadata: metadata };
}
