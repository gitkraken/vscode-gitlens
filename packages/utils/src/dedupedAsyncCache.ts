/**
 * Per-key cache for async resolution that dedupes concurrent first-time callers and caches the
 * resolved value (including `undefined`) for subsequent reads.
 *
 * Two internal Maps drive the semantics:
 * - `_resolved` holds settled values. `has(key)` distinguishes a cached `undefined` from "never
 *   resolved", so callers can intentionally cache "no result" without re-running the resolver.
 * - `_resolving` holds in-flight Promises. While a key resolves, concurrent `getOrResolve` callers
 *   share the same Promise instead of each invoking the resolver.
 *
 * Failed resolutions do not poison the cache — the entry is removed when the in-flight Promise
 * rejects, so the next call retries.
 */
export class DedupedAsyncCache<K, V> {
	private readonly _resolved = new Map<K, V>();
	private readonly _resolving = new Map<K, Promise<V>>();

	/** True iff `key` has a settled value cached. Distinct from "currently resolving". */
	has(key: K): boolean {
		return this._resolved.has(key);
	}

	/** Settled value for `key`, or `undefined` when not yet cached. May also legitimately return
	 *  `undefined` for a key whose cached value is `undefined`; use `has` to disambiguate. */
	get(key: K): V | undefined {
		return this._resolved.get(key);
	}

	/** Populates the cache directly, bypassing the resolver. Used by callers that already know the
	 *  value (e.g. event payloads, post-write reconciles) and want subsequent reads to hit. */
	set(key: K, value: V): void {
		this._resolved.set(key, value);
	}

	/** Removes both the settled value and any in-flight Promise for `key`. */
	delete(key: K): void {
		this._resolved.delete(key);
		this._resolving.delete(key);
	}

	/** Clears everything — both settled values and in-flight Promises. */
	clear(): void {
		this._resolved.clear();
		this._resolving.clear();
	}

	/**
	 * Returns the cached value for `key`, invoking `resolver` only on a cache miss. Concurrent
	 * cache-miss callers for the same key share the same in-flight Promise — `resolver` is invoked
	 * exactly once per cache fill. If `resolver` rejects, the entry is removed so subsequent calls
	 * retry rather than receiving a permanently cached failure.
	 */
	getOrResolve(key: K, resolver: () => Promise<V>): Promise<V> {
		if (this._resolved.has(key)) {
			// Map.get returns `V | undefined`; `has` confirmed presence, so the value (even if it
			// is `undefined` by intent) is the cached one. Cast pins the return type.
			return Promise.resolve(this._resolved.get(key) as V);
		}

		const existing = this._resolving.get(key);
		if (existing != null) return existing;

		const pending = resolver()
			.then(value => {
				this._resolved.set(key, value);
				return value;
			})
			.finally(() => {
				this._resolving.delete(key);
			});
		this._resolving.set(key, pending);
		return pending;
	}
}
