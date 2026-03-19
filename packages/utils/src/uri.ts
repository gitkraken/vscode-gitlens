import { URI, Utils } from 'vscode-uri';
import { normalizePath } from './path.js';

/**
 * Structural URI interface satisfied by both `vscode.Uri` and `vscode-uri.URI`.
 * Use in all function signatures so callers can pass either type without conversion.
 *
 * For construction, use the factory functions exported from this module
 * (`parseUri`, `fileUri`, `fromUri`, etc.) or the concrete `vscode.Uri.*`
 * statics when in extension code.
 */
export interface Uri {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;
	readonly fsPath: string;

	with(change: {
		scheme?: string;
		authority?: string | null;
		path?: string | null;
		query?: string | null;
		fragment?: string | null;
	}): Uri;

	toString(skipEncoding?: boolean): string;
	toJSON(): UriComponents;
}

export interface UriComponents {
	scheme: string;
	authority: string;
	path: string;
	query: string;
	fragment: string;
}

/** Compare two Uris for equality by their string representation. */
export function areUrisEqual(a: Uri | undefined, b: Uri | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	return a.toString() === b.toString();
}

/** Convert a string (file path or URI string) into a Uri. */
export function coerceUri(pathOrUri: string): Uri {
	return hasScheme(pathOrUri) ? URI.parse(pathOrUri) : URI.file(pathOrUri);
}

/** Create a file-scheme URI from a file-system path. */
export function fileUri(path: string): Uri {
	return URI.file(path);
}

/** Create a URI from component parts. */
export function fromUri(components: {
	scheme: string;
	authority?: string;
	path?: string;
	query?: string;
	fragment?: string;
}): Uri {
	return URI.from(components);
}

const hasSchemeRegex = /^([a-zA-Z][\w+.-]+):/;

/** Check if a string has a URI scheme. */
export function hasScheme(pathOrUri: string): boolean {
	return hasSchemeRegex.test(pathOrUri);
}

/** Type guard: is the value a Uri-shaped object? */
export function isUri(value: unknown): value is Uri {
	return URI.isUri(value);
}

/** Join path segments onto a URI (like `vscode.Uri.joinPath` / `vscode-uri Utils.joinPath`). */
export function joinUriPath(uri: Uri, ...paths: string[]): Uri {
	return Utils.joinPath(uri satisfies URI, ...paths);
}

/** Parse a URI string (e.g. `file:///foo/bar`, `https://example.com`). */
export function parseUri(value: string, strict?: boolean): Uri {
	return URI.parse(value, strict);
}

/** Revive a serialized {@link UriComponents} back into a Uri. */
export function reviveUri(data: UriComponents): Uri {
	return URI.revive(data);
}

/**
 * Canonical repository identity key.
 *
 * - file path string → `normalizePath(path)`
 * - `file:` URI string → parse → `normalizePath(fsPath)`
 * - non-file URI string → parse → canonicalized `toString()`
 * - `file:` Uri object → `normalizePath(fsPath)`
 * - non-file Uri object → `toString()`
 */
export function getRepositoryKey(pathOrUri: string | Uri): string {
	if (typeof pathOrUri === 'string') {
		if (!hasScheme(pathOrUri)) return normalizePath(pathOrUri);
		// Parse URI strings so file: URIs get normalized to fsPath
		pathOrUri = URI.parse(pathOrUri);
	}
	return pathOrUri.scheme === 'file' ? normalizePath(pathOrUri.fsPath) : pathOrUri.toString();
}

/** Extract the file-system path from a path-or-Uri value. */
export function toFsPath(pathOrUri: string | Uri): string {
	return typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
}
