export const failureBackoffInitialMs = 30 * 1000;
export const failureBackoffMaxMs = 10 * 60 * 1000;
const failureBackoffCapacity = 500;

export class FailureBackoff {
	private readonly entries = new Map<string, { until: number; failures: number }>();

	backedOffUntil(key: string, now: number): number | undefined {
		const entry = this.entries.get(key);
		return entry != null && entry.until > now ? entry.until : undefined;
	}

	isBackedOff(key: string, now: number): boolean {
		return this.backedOffUntil(key, now) != null;
	}

	fail(key: string, now: number, until?: number): number {
		const previous = this.entries.get(key);
		if (previous != null && previous.until > now) {
			if (until != null && until > previous.until) {
				previous.until = until;
			}
			return previous.until;
		}

		const failures = previous != null && !isStale(previous, now) ? previous.failures + 1 : 1;
		const next =
			until != null && until > now
				? until
				: now + Math.min(failureBackoffInitialMs * 2 ** (failures - 1), failureBackoffMaxMs);

		this.entries.delete(key);
		for (const [k, entry] of this.entries) {
			if (isStale(entry, now)) {
				this.entries.delete(k);
			}
		}
		for (const k of this.entries.keys()) {
			if (this.entries.size < failureBackoffCapacity) break;

			this.entries.delete(k);
		}

		this.entries.set(key, { until: next, failures: failures });
		return next;
	}

	clear(key: string): void {
		this.entries.delete(key);
	}

	clearAll(): void {
		this.entries.clear();
	}
}

function isStale(entry: { until: number }, now: number): boolean {
	return entry.until + failureBackoffMaxMs <= now;
}
