/**
 * Duck-types an Error-like value. Catches native `Error`, subclasses, `DOMException`
 * (thrown by `AbortSignal.throwIfAborted()`), and cross-realm Errors (which fail
 * `instanceof Error` checks). Without this, `JSON.stringify(error)` serializes those
 * shapes to `{}` since core properties are non-enumerable on the prototype.
 */
export function isErrorLike(v: unknown): v is { name: string; message: string; stack?: string } {
	if (v == null || typeof v !== 'object') return false;
	if (v instanceof Error) return true;
	const o = v as { name?: unknown; message?: unknown };
	return typeof o.name === 'string' && typeof o.message === 'string';
}

/** Returns the error's stack when available, otherwise `"<name>: <message>"`. */
export function flattenError(v: { name: string; message: string; stack?: string }): string {
	return v.stack ?? `${v.name}: ${v.message}`;
}
