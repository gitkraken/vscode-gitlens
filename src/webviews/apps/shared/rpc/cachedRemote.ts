/**
 * Wrap a supertalk `Remote<T>` so each non-method property's thenable is fetched at most once
 * per session.
 *
 * Why this exists: a supertalk Remote property (e.g. `services.foo`) is a *thenable*, not a real
 * Promise. Per supertalk-core/lib/connection.js#createProxyProperty, every `.then` allocates a
 * new id and sends a fresh `'get prop'` RPC. The design is intentional — supertalk can't tell at
 * the protocol level whether `foo` is a stable handle (a sub-proxy whose identity never changes)
 * or a dynamic value (something that could change on the host). Always re-fetching is the safe
 * generic default.
 *
 * Our service bags (GraphServices, TimelineServices, HomeServices, CommitDetailsServices) only
 * expose stable handles, so memoization is unambiguously correct here. `Promise.resolve(thenable)`
 * invokes `.then` exactly once and produces a real Promise that caches the resolved value.
 *
 * Method-typed fields pass through unchanged: each method invocation is its own RPC, which is
 * correct semantics. Only thenable properties (the supertalk `'get'` triggers) are cached.
 */
export function cacheRemoteServices<T extends object>(remote: T): T {
	const cache = new Map<string | symbol, unknown>();
	return new Proxy(remote, {
		get: function (target, prop, receiver) {
			if (cache.has(prop)) return cache.get(prop);

			const value: unknown = Reflect.get(target, prop, receiver);
			if (typeof value === 'function') return value;
			if (
				value == null ||
				typeof value !== 'object' ||
				typeof (value as { then?: unknown }).then !== 'function'
			) {
				return value;
			}

			const cached = Promise.resolve(value as PromiseLike<unknown>);
			cache.set(prop, cached);
			return cached;
		},
	});
}
