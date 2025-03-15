interface CacheEntry<V> {
	promise: Promise<V>;
	accessed: number;
	created: number;
}

export class PromiseCache<K, V> {
	private readonly cache = new Map<K, CacheEntry<V>>();

	constructor(
		private readonly options?: {
			/** TTL (time-to-live) in milliseconds since creation */
			createTTL?: number;
			/** TTL (time-to-live) in milliseconds since last access */
			accessTTL?: number;
			/** Whether to expire the entry if the promise fails */
			expireOnError?: boolean;
		},
	) {}

	async get(key: K, factory: () => Promise<V>): Promise<V> {
		const now = Date.now();

		let entry = this.cache.get(key);
		if (entry != null && !this.expired(entry, now)) {
			// Update accessed time
			entry.accessed = now;
			return entry.promise;
		}

		const promise = factory();
		entry = {
			promise: promise,
			created: now,
			accessed: now,
		};
		this.cache.set(key, entry);

		// Clean up other expired entries
		if ((this.options?.createTTL != null || this.options?.accessTTL != null) && this.cache.size > 1) {
			queueMicrotask(() => this.cleanupExpired());
		}

		if (this.options?.expireOnError) {
			promise.catch(() => this.cache.delete(key));
		}

		return promise;
	}

	private cleanupExpired(): void {
		const now = Date.now();

		for (const [key, entry] of this.cache.entries()) {
			if (this.expired(entry, now)) {
				this.cache.delete(key);
			}
		}
	}

	private expired(entry: CacheEntry<V>, now: number): boolean {
		return (
			(this.options?.createTTL != null && now - entry.created >= this.options?.createTTL) ||
			(this.options?.accessTTL != null && now - entry.accessed >= this.options?.accessTTL)
		);
	}

	clear(): void {
		this.cache.clear();
	}

	delete(key: K): void {
		this.cache.delete(key);
	}
}
