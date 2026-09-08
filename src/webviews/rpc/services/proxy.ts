/**
 * Service proxying and disposal for the webview RPC layer.
 *
 * Kept free of service-class imports so it can be unit-tested — the service
 * classes transitively reach `system/-webview/command.ts` (and through it the
 * whole extension), which cannot initialize in the test bundle. `@gitlens/git/errors.js`
 * is a plain package import with no such chain, so it's fine to import directly here.
 */

import { proxy } from '@eamodio/supertalk';
import type { Disposable } from 'vscode';
import { GitCommandError } from '@gitlens/git/errors.js';

const servicesDisposables = Symbol('rpcServicesDisposables');

/** Per-target member cache backing {@link presentServiceErrors} — see its doc comment. */
const presentedMembers = new WeakMap<object, Map<PropertyKey, { source: unknown; presented: unknown }>>();

/**
 * Wraps an exposed services object so a thrown or rejected `GitCommandError` reaches the webview
 * with its localized message instead of the English one.
 *
 * Must run BEFORE Supertalk's `proxy()` marker wraps a service: `proxy()` exposes only the RAW
 * object it closed over at creation time to the wire's real dispatch path (`connection.js`'s
 * `#handleCall` → `#makeProxyWire(value[PROXY_VALUE], ...)` → `#registerLocal(value)`, later looked
 * up via `#getLocal(target)` and invoked directly on that raw object) — so wrapping a service after
 * it has already been handed to `proxy()` (e.g. at the `RpcHost` level) has no effect on real calls.
 *
 * Webviews render `error.message` directly, but Supertalk's wire protocol (`serializeError()`)
 * clones a thrown error's `message` verbatim when shipping it to the client — there's no hook to
 * intercept it. `GitCommandError` deliberately keeps `message` in English (so logs and telemetry
 * stay searchable) and exposes the translated text on `localizedMessage`. This Proxy is the
 * stand-in translation point for RPC responses until Supertalk grows a first-class
 * error-serialization hook.
 */
export function presentServiceErrors<T extends object>(services: T): T {
	return new Proxy(services, {
		get: function (target, prop) {
			const value: unknown = Reflect.get(target, prop, target);
			if (
				typeof prop !== 'string' ||
				value == null ||
				(typeof value !== 'object' && typeof value !== 'function')
			) {
				return value;
			}

			const isPlainObject =
				typeof value === 'object' &&
				(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

			if (typeof value !== 'function' && !isPlainObject) {
				// Only plain object literals (or `Object.create(null)` objects) are recursed into — nested
				// service groups are always shaped that way (see the object literals in `graphWebview.ts`'s
				// `getRpcServices()` for a real example). Everything else — class instances, Maps, Sets,
				// Dates, `Signal.State`/`Signal.Computed`, typed arrays, VS Code's `Uri` — breaks the moment
				// something reads it through a Symbol-keyed path: e.g. `for..of` fetches `Symbol.iterator`
				// via this `get` trap, which returns the raw method, and calling it with this Proxy as
				// `this` throws "called on incompatible receiver" (built-in methods often check internal
				// slots only the real instance has). This is also what keeps `Signal.State`/`Signal.Computed`
				// unwrapped for `SignalHandler`'s `instanceof` check (see `@eamodio/supertalk-signals`'s
				// `SignalHandler.canHandle`) — proxying one here would defeat that check on the sender side.
				return value;
			}

			const cached = presentedMembers.get(target)?.get(prop);
			if (cached?.source === value) return cached.presented;

			const presented: unknown =
				typeof value === 'function' ? wrapServiceMethod(value, target) : presentServiceErrors(value);

			let map = presentedMembers.get(target);
			if (map == null) {
				map = new Map();
				presentedMembers.set(target, map);
			}
			map.set(prop, { source: value, presented: presented });
			return presented;
		},
	});
}

/** Wraps a single service method so its thrown/rejected errors are mapped via {@link toPresentableError}. */
function wrapServiceMethod(method: unknown, target: object): (...args: unknown[]) => unknown {
	return function (...args: unknown[]): unknown {
		let result: unknown;
		try {
			result = Reflect.apply(method as (...args: unknown[]) => unknown, target, args);
		} catch (ex) {
			throw toPresentableError(ex);
		}

		if (typeof (result as Record<string, unknown> | null | undefined)?.then === 'function') {
			return (result as Promise<unknown>).then(undefined, (ex: unknown) => {
				throw toPresentableError(ex);
			});
		}

		return result;
	};
}

/** Maps a `GitCommandError` to a plain `Error` carrying its `localizedMessage`; anything else passes through unchanged. */
function toPresentableError(ex: unknown): unknown {
	if (GitCommandError.is(ex)) {
		const error = new Error(ex.localizedMessage);
		error.name = ex.name;
		error.stack = ex.stack;
		return error;
	}

	return ex;
}

/**
 * Wraps object-valued properties with Supertalk's `proxy()` marker (functions/primitives pass through).
 * Services implementing `dispose()` are collected behind a non-enumerable symbol so the controller can
 * release them at teardown via {@link disposeServices} — the path for resources that must outlive
 * `SubscriptionTracker.reset()` (e.g. `SubscriptionService`'s eager listeners). Only top-level properties
 * are scanned; hoist nested disposables to the top level.
 */
export function proxyServices<T extends Record<string, unknown>>(services: T): T {
	const result: Record<string, unknown> = {};
	const disposables: Disposable[] = [];
	for (const [key, value] of Object.entries(services)) {
		if (value != null && typeof value === 'object') {
			if (typeof (value as Partial<Disposable>).dispose === 'function') {
				// NOTE: `proxy()` exposes every string-named method over RPC (Supertalk has no host-side
				// allowlist), so a collected service's `dispose()` is client-reachable — a stray call would
				// refreeze the signals (#5513). Only trusted webview code calls today; move to a symbol-keyed
				// disposal method if that ever changes.
				disposables.push(value as Disposable);
			}
			result[key] = proxy(presentServiceErrors(value));
		} else {
			result[key] = value;
		}
	}
	Object.defineProperty(result, servicesDisposables, { value: disposables, enumerable: false });
	return result as T;
}

/**
 * Disposes the disposable services collected by {@link proxyServices}.
 * Safe to call with any object — a no-op when none were collected — and idempotent.
 */
export function disposeServices(services: object | undefined): void {
	if (services == null) return;

	const disposables = (services as { [servicesDisposables]?: Disposable[] })[servicesDisposables];
	if (disposables == null) return;

	for (const disposable of disposables.splice(0)) {
		disposable.dispose();
	}
}
