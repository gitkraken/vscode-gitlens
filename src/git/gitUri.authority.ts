import { decodeUtf8Hex, encodeUtf8Hex } from '@env/hex';

export function decodeGitLensRevisionUriAuthority<T>(authority: string): T {
	return JSON.parse(decodeUtf8Hex(authority)) as T;
}

export function encodeGitLensRevisionUriAuthority<T>(metadata: T): string {
	return encodeUtf8Hex(JSON.stringify(metadata));
}
