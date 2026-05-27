/**
 * Bounded LRU map. On `set` / `update`, the touched key becomes the
 * most-recently-used entry; on overflow, the least-recently-used key is
 * evicted until `size <= limit`. Built on a plain `Map`, exploiting that
 * `Map` preserves insertion order — re-inserting a key moves it to the end.
 *
 * Intentionally minimal — `get` / `set` / `delete` / `clear` / `size` /
 * `has` / `keys` / `values` / `update`. No expiry, no async, no events.
 * Callers that need invalidation rules layer them on top.
 *
 * `update(key, patch)` is a convenience for object-shaped values: merges
 * `patch` into the existing entry (or seeds a new one) and touches the key.
 * Use `set` for non-object values.
 */
export class LruMap<K, V> {
	private readonly _map = new Map<K, V>();
	private readonly _pinned = new Set<K>();

	constructor(private readonly limit: number) {}

	/**
	 * Pin a key so it's never evicted by capacity pressure (it can still be explicitly
	 * `delete`d / `clear`ed). Use for entries that must stay available regardless of how many
	 * other keys churn — e.g. the selected repo's WIP, which the header badge derives from.
	 * Pinning a key not yet present is fine; it takes effect once the key is `set`.
	 */
	pin(key: K): void {
		this._pinned.add(key);
	}

	unpin(key: K): void {
		this._pinned.delete(key);
	}

	get size(): number {
		return this._map.size;
	}

	get(key: K): V | undefined {
		return this._map.get(key);
	}

	has(key: K): boolean {
		return this._map.has(key);
	}

	set(key: K, value: V): this {
		// Re-insert to move the key to the end (most-recently-used).
		this._map.delete(key);
		this._map.set(key, value);
		this.evict();
		return this;
	}

	/**
	 * Merge `patch` into the existing entry (or seed a new entry from it) and
	 * touch the key. Returns the merged value. Object-shaped `V` only.
	 */
	update(key: K, patch: Partial<V>): V {
		const existing = this._map.get(key);
		const next = { ...(existing ?? {}), ...patch };
		this.set(key, next as V);
		return next as V;
	}

	/**
	 * Promote an existing entry to most-recently-used without changing its value.
	 * Returns `true` if the key was present (and therefore touched), `false` otherwise.
	 * Use on cache hits when you want subsequent eviction pressure to skip this entry.
	 */
	touch(key: K): boolean {
		if (!this._map.has(key)) return false;

		const value = this._map.get(key) as V;
		this._map.delete(key);
		this._map.set(key, value);
		return true;
	}

	delete(key: K): boolean {
		return this._map.delete(key);
	}

	clear(): void {
		this._map.clear();
		// Drop pins too — a cleared map has no entries to protect, and leaving stale pins would
		// wrongly shield the NEXT value set under a previously-pinned key from eviction.
		this._pinned.clear();
	}

	keys(): IterableIterator<K> {
		return this._map.keys();
	}

	values(): IterableIterator<V> {
		return this._map.values();
	}

	private evict(): void {
		if (this._map.size <= this.limit) return;

		// Iterate oldest-first, deleting the first non-pinned keys until back at capacity.
		// Pinned keys are skipped — if everything is pinned the map can exceed `limit`, which
		// is the intended trade-off (pins are deliberate and few).
		for (const key of this._map.keys()) {
			if (this._map.size <= this.limit) break;
			if (this._pinned.has(key)) continue;

			this._map.delete(key);
		}
	}
}
