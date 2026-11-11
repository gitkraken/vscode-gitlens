import { areEqual } from '@gitlens/utils/object.js';

/**
 * How long a tracker's discovered project set (Jira sites and projects, Linear teams) is trusted before it is read
 * again. Projects are created and deleted while a session runs, and a stale set costs more than a re-read: a created
 * project never appears, and a deleted one keeps being searched, which Jira refuses with a `400` (#5907).
 */
export const discoveryCacheTtl = 5 * 60 * 1000;

/**
 * How long an autolink set built from an incomplete or failed discovery read is served before the read is retried.
 * Short, so what the read missed shows up soon; but autolinks are read on every render of a commit message, and
 * retrying on each would make every render wait on the provider (#6183).
 */
export const incompleteAutolinksRetryDelay = 60 * 1000;

/** Whether a kept autolink set is due a rebuild: once older than the TTL, or the retry delay when incomplete. */
export function isAutolinkSetExpired(set: { builtAt: number; complete: boolean }): boolean {
	return Date.now() - set.builtAt >= (set.complete ? discoveryCacheTtl : incompleteAutolinksRetryDelay);
}

/**
 * Whether a kept autolink set is empty and incomplete: the fallback of a failing build that held none, built from no
 * list, so it stands for no set to any set built from the lists (#6184).
 */
export function isEmptyAutolinkFallback(set: { autolinks: readonly unknown[]; complete: boolean }): boolean {
	return !set.complete && !set.autolinks.length;
}

/**
 * A per-key cache of discovery results that expires entries after {@link discoveryCacheTtl} and can be dropped
 * wholesale when the connection is re-synced.
 *
 * {@link clear} bumps a generation, and {@link set} refuses a value read under an older one, so a read that was
 * already in flight when the cache was cleared cannot write the set it read before the clear back into it.
 *
 * A read can also be ordered by when it started ({@link startRead}): its value is then refused once a read that started
 * after it stored the key, so a slower, possibly older read can't put back a list that a newer read replaced (#6184).
 * The start stands in for when the provider answered, which a read doesn't report: one that started first but was
 * answered with a later state (a paged list's last page read after the other read stored, say) is refused too, and one
 * that started later but was answered with an earlier state is stored over it. Either way the stored list lags until a
 * read replaces it, at most the TTL, and what is built from it with its own TTL, like autolinks, up to about twice
 * that. A deletion keeps no such order: Jira Cloud fences the reads in flight across its evictions itself (#6176).
 *
 * An expired entry is no longer served, but is kept until replaced, for that order and so {@link set} can tell whether
 * the read that replaces it found anything new.
 */
export class DiscoveryCache<V> {
	private readonly entries = new Map<string, { value: V; storedAt: number; read: number }>();
	private _generation = 0;
	private reads = 0;

	constructor(private readonly ttl: number = discoveryCacheTtl) {}

	/** Pass to {@link set} to have a value read now refused if the cache is cleared before it is stored. */
	get generation(): number {
		return this._generation;
	}

	/** Pass to {@link set} as `read`, taken when a read starts, to order its value against other reads'. */
	startRead(): number {
		return ++this.reads;
	}

	get(key: string): V | undefined {
		const entry = this.entries.get(key);
		if (entry == null || Date.now() - entry.storedAt >= this.ttl) return undefined;

		return entry.value;
	}

	/** The value stored under `key`, expired or not: what a reader that can't wait for a re-read last knew of it. */
	peek(key: string): V | undefined {
		return this.entries.get(key)?.value;
	}

	/**
	 * Stores `value` unless the cache was cleared since `generation` was taken, or, for a `read` from
	 * {@link startRead}, a read started after it stored `key`. `storedAt` backdates an entry seeded from persisted
	 * storage, so it expires on the schedule of the read that produced it rather than of the seeding. Returns `false`
	 * when refused, `'unchanged'` when `value` equals the one it replaces, expired or not, and `'changed'` otherwise.
	 */
	set(
		key: string,
		value: V,
		options?: { generation?: number; read?: number; storedAt?: number },
	): 'changed' | 'unchanged' | false {
		if (options?.generation != null && options.generation !== this._generation) return false;

		const previous = this.entries.get(key);
		const read = options?.read;
		if (read != null && read < (previous?.read ?? 0)) return false;

		// A value stored without a read keeps the order of the one it replaces.
		this.entries.set(key, {
			value: value,
			storedAt: options?.storedAt ?? Date.now(),
			read: read ?? previous?.read ?? 0,
		});
		return previous != null && areEqual(previous.value, value) ? 'unchanged' : 'changed';
	}

	delete(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this._generation++;
		this.entries.clear();
	}
}
