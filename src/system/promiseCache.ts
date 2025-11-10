interface CacheEntry<V> {
	promise: Promise<V>;
	accessed: number;
	created: number;

	createTTL: number | undefined;
	accessTTL: number | undefined;
}

export interface Cancellable {
	cancelled(): void;
}

interface PromiseCacheOptions {
	/** TTL (time-to-live) in milliseconds since creation */
	createTTL?: number;
	/** TTL (time-to-live) in milliseconds since last access */
	accessTTL?: number;
	/** Whether to expire the entry if the promise fails (default: true) */
	expireOnError?: boolean;
	/** Maximum number of entries in the cache (LRU eviction when exceeded) */
	capacity?: number;
}

export class PromiseCache<K, V> {
	private readonly cache = new Map<K, CacheEntry<V>>();
	private readonly options: PromiseCacheOptions;

	constructor(options?: PromiseCacheOptions) {
		this.options = { expireOnError: true, ...options };
	}

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

		options = { ...this.options, ...options };

		let entry = this.cache.get(key);
		if (entry != null && !this.expired(entry, now)) {
			// Update accessed time
			entry.accessed = now;

			entry.createTTL = options.createTTL;
			entry.accessTTL = options.accessTTL;
			return entry.promise;
		}

		let cancelled = false;
		const promise = factory({ cancelled: () => (cancelled = true) });
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

		// Clean up expired entries and enforce capacity limit in one pass
		if (this.cache.size > 1) {
			queueMicrotask(() => this.cleanup());
		}

		if (options?.expireOnError ?? true) {
			promise.catch(() => this.cache.delete(key));
		}

		return promise;
	}

	private cleanup(): void {
		const now = Date.now();
		const capacity = this.options.capacity;

		// If no capacity limit, just remove expired entries
		if (capacity == null) {
			for (const [key, entry] of this.cache.entries()) {
				if (this.expired(entry, now)) {
					this.cache.delete(key);
				}
			}
			return;
		}

		// Single pass: collect non-expired entries and find LRU candidates
		const entries: Array<[K, CacheEntry<V>]> = [];
		for (const [key, entry] of this.cache.entries()) {
			if (!this.expired(entry, now)) {
				entries.push([key, entry]);
			} else {
				this.cache.delete(key);
			}
		}

		// If still over capacity, remove LRU entries
		const excess = entries.length - capacity;
		if (excess > 0) {
			// Sort by accessed time (oldest first) and remove the excess
			entries.sort((a, b) => a[1].accessed - b[1].accessed);
			for (let i = 0; i < excess; i++) {
				this.cache.delete(entries[i][0]);
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

/**
 * A Map-like wrapper for promises that automatically removes failed promises from the cache.
 * This provides a drop-in replacement for Map<K, Promise<V>> with automatic error cleanup.
 */
export class PromiseMap<K, V> {
	private readonly cache = new Map<K, Promise<V>>();

	/**
	 * Returns the string tag for this object.
	 */
	get [Symbol.toStringTag](): string {
		return 'PromiseMap';
	}

	/**
	 * Gets a promise from the cache or creates a new one using the factory function.
	 * Failed promises are automatically removed from the cache.
	 */
	getOrCreate(key: K, factory: (cancellable: Cancellable) => Promise<V>): Promise<V> {
		let promise = this.cache.get(key);
		if (promise == null) {
			let cancelled = false;
			promise = factory({ cancelled: () => (cancelled = true) });
			// Automatically remove failed promises from the cache
			promise.catch(() => this.cache.delete(key));
			void promise.finally(() => {
				if (cancelled) {
					this.cache.delete(key);
				}
			});

			this.cache.set(key, promise);
		}
		return promise;
	}

	/**
	 * Gets a promise from the cache, or undefined if not found.
	 */
	get(key: K): Promise<V> | undefined {
		return this.cache.get(key);
	}

	/**
	 * Sets a promise in the cache. The promise will be automatically removed if it fails.
	 */
	set(key: K, promise: Promise<V>): this {
		this.cache.set(key, promise);

		// Automatically remove failed promises from the cache
		promise.catch(() => {
			this.cache.delete(key);
		});

		return this;
	}

	/**
	 * Checks if a key exists in the cache.
	 */
	has(key: K): boolean {
		return this.cache.has(key);
	}

	/**
	 * Removes a key from the cache.
	 */
	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/**
	 * Clears all entries from the cache.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Returns the number of entries in the cache.
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Returns an iterator for the cache keys.
	 */
	keys(): IterableIterator<K> {
		return this.cache.keys();
	}

	/**
	 * Returns an iterator for the cache values.
	 */
	values(): IterableIterator<Promise<V>> {
		return this.cache.values();
	}

	/**
	 * Returns an iterator for the cache entries.
	 */
	entries(): IterableIterator<[K, Promise<V>]> {
		return this.cache.entries();
	}

	/**
	 * Executes a provided function once for each cache entry.
	 */
	forEach(callbackfn: (value: Promise<V>, key: K, map: Map<K, Promise<V>>) => void, thisArg?: any): void {
		this.cache.forEach(callbackfn, thisArg);
	}

	/**
	 * Returns an iterator for the cache entries.
	 */
	[Symbol.iterator](): IterableIterator<[K, Promise<V>]> {
		return this.cache[Symbol.iterator]();
	}
}
