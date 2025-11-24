interface CacheEntry<V> {
	promise: Promise<V>;
	accessed: number;
	created: number;

	createTTL: number | undefined;
	accessTTL: number | undefined;
}

export class CacheController {
	#invalidated = false;
	get invalidated(): boolean {
		return this.#invalidated;
	}

	invalidate(): void {
		this.#invalidated = true;
	}
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

	async getOrCreate(
		key: K,
		factory: (cacheable: CacheController) => Promise<V>,
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

		const cacheable = new CacheController();
		const promise = factory(cacheable);
		void promise.finally(() => {
			if (cacheable.invalidated) {
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

	get [Symbol.toStringTag](): string {
		return 'PromiseMap';
	}

	/**
	 * Gets a promise from the cache or creates a new one using the factory function.
	 * Failed promises are automatically removed from the cache.
	 */
	getOrCreate(key: K, factory: (cacheable: CacheController) => Promise<V>): Promise<V> {
		let promise = this.cache.get(key);
		if (promise == null) {
			const cacheable = new CacheController();
			promise = factory(cacheable);
			// Automatically remove failed promises from the cache
			promise.catch(() => this.cache.delete(key));
			void promise.finally(() => {
				if (cacheable.invalidated) {
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

	[Symbol.iterator](): IterableIterator<[K, Promise<V>]> {
		return this.cache[Symbol.iterator]();
	}
}

/**
 * A two-level cache that organizes PromiseCaches by repository path.
 * Automatically creates and manages inner PromiseCaches per repository.
 *
 * This is useful for caching data that varies by both repository and some other key,
 * with TTL and capacity management provided by PromiseCache.
 */
export class RepoPromiseCacheMap<K, V> {
	private readonly cache = new Map<string, PromiseCache<K, V>>();
	private readonly options: PromiseCacheOptions;

	constructor(options?: PromiseCacheOptions) {
		this.options = { expireOnError: true, ...options };
	}

	get [Symbol.toStringTag](): string {
		return 'RepoPromiseCacheMap';
	}

	/**
	 * Gets a promise from the cache or creates a new one using the factory function.
	 * Automatically creates the inner PromiseCache for the repository if it doesn't exist.
	 *
	 * @param repoPath - The repository path (outer key)
	 * @param key - The cache key within the repository (inner key)
	 * @param factory - Factory function to create the value if not cached
	 * @param options - Optional TTL and error handling options that override the defaults
	 */
	getOrCreate(
		repoPath: string,
		key: K,
		factory: (cacheable: CacheController) => Promise<V>,
		options?: {
			/** TTL (time-to-live) in milliseconds since creation */
			createTTL?: number;
			/** TTL (time-to-live) in milliseconds since last access */
			accessTTL?: number;
			/** Whether to expire the entry if the promise fails */
			expireOnError?: boolean;
		},
	): Promise<V> {
		let repoCache = this.cache.get(repoPath);
		if (repoCache == null) {
			repoCache = new PromiseCache<K, V>(this.options);
			this.cache.set(repoPath, repoCache);
		}

		return repoCache.getOrCreate(key, factory, options);
	}

	/**
	 * Deletes a specific key from a repository's cache, or all keys for a repository.
	 *
	 * @param repoPath - The repository path
	 * @param key - Optional specific key to delete. If omitted, deletes the entire repository cache.
	 * @returns true if something was deleted, false otherwise
	 */
	delete(repoPath: string, key?: K): boolean {
		if (key === undefined) {
			return this.cache.delete(repoPath);
		}

		const repoCache = this.cache.get(repoPath);
		if (repoCache == null) return false;

		repoCache.delete(key);
		return true;
	}

	/**
	 * Clears all caches for all repositories.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Returns the number of repositories in the cache.
	 */
	get size(): number {
		return this.cache.size;
	}
}

/**
 * A two-level cache that organizes PromiseMaps by repository path.
 * Automatically creates and manages inner PromiseMaps per repository.
 *
 * This is useful for caching data that varies by both repository and some other key,
 * with simple promise deduplication and automatic error cleanup.
 */
export class RepoPromiseMap<K, V> {
	private readonly cache = new Map<string, PromiseMap<K, V>>();

	get [Symbol.toStringTag](): string {
		return 'RepoPromiseMap';
	}

	/**
	 * Gets a promise from the cache or creates a new one using the factory function.
	 * Automatically creates the inner PromiseMap for the repository if it doesn't exist.
	 *
	 * @param repoPath - The repository path (outer key)
	 * @param key - The cache key within the repository (inner key)
	 * @param factory - Factory function to create the value if not cached
	 */
	getOrCreate(repoPath: string, key: K, factory: (cacheable: CacheController) => Promise<V>): Promise<V> {
		let repoCache = this.cache.get(repoPath);
		if (repoCache == null) {
			repoCache = new PromiseMap<K, V>();
			this.cache.set(repoPath, repoCache);
		}

		return repoCache.getOrCreate(key, factory);
	}

	/**
	 * Gets a promise from the cache without creating it.
	 *
	 * @param repoPath - The repository path (outer key)
	 * @param key - The cache key within the repository (inner key)
	 * @returns The cached promise, or undefined if not found
	 */
	get(repoPath: string, key: K): Promise<V> | undefined {
		const repoCache = this.cache.get(repoPath);
		return repoCache?.get(key);
	}

	/**
	 * Deletes a specific key from a repository's cache, or all keys for a repository.
	 *
	 * @param repoPath - The repository path
	 * @param key - Optional specific key to delete. If omitted, deletes the entire repository cache.
	 * @returns true if something was deleted, false otherwise
	 */
	delete(repoPath: string, key?: K): boolean {
		if (key === undefined) {
			return this.cache.delete(repoPath);
		}

		const repoCache = this.cache.get(repoPath);
		if (repoCache == null) return false;

		return repoCache.delete(key);
	}

	/**
	 * Clears all caches for all repositories.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Returns the number of repositories in the cache.
	 */
	get size(): number {
		return this.cache.size;
	}
}
