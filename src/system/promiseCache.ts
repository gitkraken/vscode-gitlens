interface CacheEntry<V> {
	promise: Promise<V>;
	accessed: number;
	created: number;

	createTTL: number | undefined;
	accessTTL: number | undefined;
}

export interface Cancellable {
	cancel(): void;
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

	async get(
		key: K,
		factory: (cancellable: Cancellable) => Promise<V>,
		options?: {
			/** TTL (time-to-live) in milliseconds since creation */
			createTTL?: number;
			/** TTL (time-to-live) in milliseconds since last access */
			accessTTL?: number;
			/** Whether to expire the entry if the promise fails */
			expireOnError?: boolean;
		},
	): Promise<V> {
		const now = Date.now();

		options = {
			...this.options,
			...options,
		};

		let entry = this.cache.get(key);
		if (entry != null && !this.expired(entry, now)) {
			// Update accessed time
			entry.accessed = now;

			entry.createTTL = options.createTTL;
			entry.accessTTL = options.accessTTL;
			return entry.promise;
		}

		let cancelled = false;
		const promise = factory({ cancel: () => (cancelled = true) });
		void promise.finally(() => {
			if (cancelled) {
				this.cache.delete(key);
			}
		});

		entry = {
			promise: promise,
			created: now,
			accessed: now,

			createTTL: options.createTTL,
			accessTTL: options.accessTTL,
		};
		this.cache.set(key, entry);

		// Clean up other expired entries
		if (this.cache.size > 1) {
			queueMicrotask(() => this.cleanupExpired());
		}

		if (options?.expireOnError) {
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
			(entry.createTTL != null && now - entry.created >= entry.createTTL) ||
			(entry.accessTTL != null && now - entry.accessed >= entry.accessTTL)
		);
	}

	clear(): void {
		this.cache.clear();
	}

	delete(key: K): void {
		this.cache.delete(key);
	}
}
