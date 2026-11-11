import { LruMap } from './lruMap.js';

/**
 * Keys held off for a fixed wait from when each was last held (after a failure, say), each with a value of its own.
 * Bounded: the least recently held key is dropped past `capacity`, which only ends its wait early.
 */
export class HoldOffMap<K, V> {
	private readonly _held: LruMap<K, { at: number; value: V }>;

	/** `clock` is read on every call, so a test can move it */
	constructor(
		private readonly wait: number,
		capacity: number,
		private readonly clock: { now(): number } = Date,
	) {
		this._held = new LruMap(capacity);
	}

	/** The value `key` was held with, while its wait lasts; once it is over, `key` is released */
	get(key: K): V | undefined {
		const held = this._held.get(key);
		if (held == null) return undefined;

		// More left to wait than the wait itself is a clock that went back, which would otherwise stretch it
		const remaining = held.at + this.wait - this.clock.now();
		if (remaining > 0 && remaining <= this.wait) return held.value;

		this._held.delete(key);
		return undefined;
	}

	/** Whether `key` is held, see {@link get} */
	isHeld(key: K): boolean {
		return this.get(key) !== undefined;
	}

	/** Holds `key` off from now, for the wait */
	hold(key: K, value: V): void {
		this._held.set(key, { at: this.clock.now(), value: value });
	}

	release(key: K): void {
		this._held.delete(key);
	}
}
