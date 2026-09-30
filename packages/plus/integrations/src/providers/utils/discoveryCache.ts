/**
 * How long a tracker's discovered project set (Jira sites and projects, Linear teams) is trusted before it is read
 * again. Projects are created and deleted while a session runs, and a stale set costs more than a re-read: a created
 * project never appears, and a deleted one keeps being searched, which Jira refuses with a `400` (#5907).
 */
export const discoveryCacheTtl = 5 * 60 * 1000;

/**
 * A per-key cache of discovery results that expires entries after {@link discoveryCacheTtl} and can be dropped
 * wholesale when the connection is re-synced.
 *
 * {@link clear} bumps a generation, and {@link set} refuses a value read under an older one, so a read that was
 * already in flight when the cache was cleared cannot write the set it read before the clear back into it.
 */
export class DiscoveryCache<V> {
	private readonly entries = new Map<string, { value: V; storedAt: number }>();
	private _generation = 0;

	constructor(private readonly ttl: number = discoveryCacheTtl) {}

	/** Pass to {@link set} to have a value read now refused if the cache is cleared before it is stored. */
	get generation(): number {
		return this._generation;
	}

	get(key: string): V | undefined {
		const entry = this.entries.get(key);
		if (entry == null) return undefined;
		if (Date.now() - entry.storedAt >= this.ttl) {
			this.entries.delete(key);
			return undefined;
		}

		return entry.value;
	}

	/**
	 * Stores `value` unless the cache was cleared since `generation` was taken. `storedAt` backdates an entry seeded
	 * from persisted storage, so it expires on the schedule of the read that produced it rather than of the seeding.
	 * Returns whether the value was stored.
	 */
	set(key: string, value: V, options?: { generation?: number; storedAt?: number }): boolean {
		if (options?.generation != null && options.generation !== this._generation) return false;

		this.entries.set(key, { value: value, storedAt: options?.storedAt ?? Date.now() });
		return true;
	}

	delete(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this._generation++;
		this.entries.clear();
	}
}
