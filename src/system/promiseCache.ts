interface CacheEntry<V> {
	promise: Promise<V>;
	accessed: number;
	created: number;
}

export class PromiseCache<K, V> {
	private readonly cache = new Map<K, CacheEntry<V>>();

	constructor(private readonly options?: { createTTL?: number; accessTTL?: number }) {}

	async get(key: K, factory: () => Promise<V>): Promise<V> {
		const now = Date.now();

		const entry = this.cache.get(key);
		if (entry != null && !this.expired(entry, now)) {
			// Update accessed time
			entry.accessed = now;
			return entry.promise;
		}

		const promise = factory();
		this.cache.set(key, {
			promise: promise,
			created: now,
			accessed: now,
		});

		// Clean up other expired entries
		if ((this.options?.createTTL != null || this.options?.accessTTL != null) && this.cache.size > 1) {
			queueMicrotask(() => this.cleanupExpired());
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
