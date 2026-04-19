import type { Logger as SupertalkLogger } from '@eamodio/supertalk';
import { flattenError, isErrorLike } from '@gitlens/utils/error.js';
import { Logger } from '@gitlens/utils/logger.js';

function toMessage(data: unknown[]): [message: string, rest: unknown[]] {
	if (typeof data[0] === 'string') {
		return [data[0], data.slice(1)];
	}
	return [data.map(String).join(' '), []];
}

/**
 * Walks one level deep into each rest arg. Any own-enumerable property whose value is
 * Error-like is replaced with `"${name}: ${message}"` so `Logger`'s JSON.stringify path
 * logs the actual failure instead of `{}`. Top-level Error-like rest args are flattened too.
 *
 * This is a narrow fix scoped to RPC logging — the project-wide `toLoggable` replacer
 * at `packages/utils/src/logger.ts` still uses `instanceof Error`, which we intentionally
 * leave alone to avoid touching every logger caller.
 */
function normalizeRest(rest: unknown[]): unknown[] {
	return rest.map(arg => {
		if (isErrorLike(arg)) return flattenError(arg);
		if (arg == null || typeof arg !== 'object' || Array.isArray(arg)) return arg;

		let cloned: Record<string, unknown> | undefined;
		for (const [key, value] of Object.entries(arg)) {
			if (isErrorLike(value)) {
				cloned ??= { ...(arg as Record<string, unknown>) };
				cloned[key] = flattenError(value);
			}
		}
		return cloned ?? arg;
	});
}

function findError(rest: unknown[]): unknown {
	for (const r of rest) {
		if (isErrorLike(r)) return r;
		if (r != null && typeof r === 'object' && !Array.isArray(r)) {
			for (const value of Object.values(r)) {
				if (isErrorLike(value)) return value;
			}
		}
	}
	return undefined;
}

function adaptLogger(prefix: string): SupertalkLogger {
	const tag = `[RPC:${prefix}]`;
	return {
		debug: (...data: unknown[]) => {
			const [message, rest] = toMessage(data);
			Logger.debug(`${tag} ${message}`, ...normalizeRest(rest));
		},
		warn: (...data: unknown[]) => {
			const [message, rest] = toMessage(data);
			Logger.warn(`${tag} ${message}`, ...normalizeRest(rest));
		},
		error: (...data: unknown[]) => {
			const [message, rest] = toMessage(data);
			// Pass the original Error-like value to Logger.error so `String(ex)` renders
			// "AbortError: ..." instead of "[object Object]". Logger.error ignores
			// additional params, so Error context is preserved only via `ex`.
			const ex = findError(rest);
			Logger.error(ex, `${tag} ${message}`);
		},
	};
}

/**
 * Creates a Supertalk-compatible logger tagged with the given prefix. Use this when
 * wiring an `RpcHost` or `RpcClient` so each line identifies the channel in the log.
 *
 * Example prefixes:
 * - `host(gitlens.views.home|5cf1bc7c)` — host-side logger for the Home webview
 * - `client(gitlens.views.timeline|4103a120)` — client-side logger inside the Timeline webview
 */
export function createSupertalkLogger(prefix: string): SupertalkLogger {
	return adaptLogger(prefix);
}

/**
 * Composes a webview identifier tag matching the existing `WebviewController(id|instance)`
 * format used throughout GitLens logs. Either field may be undefined.
 */
export function formatWebviewLogTag(webviewId: string | undefined, webviewInstanceId: string | undefined): string {
	if (webviewId == null && webviewInstanceId == null) return '?';
	if (webviewInstanceId == null) return webviewId!;
	return `${webviewId ?? '?'}|${webviewInstanceId}`;
}

/** Default logger used when no webview context is available. */
export const supertalkLogger: SupertalkLogger = adaptLogger('?');
