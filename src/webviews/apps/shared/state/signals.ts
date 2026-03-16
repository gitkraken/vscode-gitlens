import { signal as litSignal, Signal } from '@lit-labs/signals';
import type { HostStorage } from '../host/storage.js';

// ============================================================
// Readable signal interface
// ============================================================

/** Minimal readable signal interface satisfied by Signal.State, Signal.Computed, and RemoteSignal. */
export interface ReadableSignal<T> {
	get(): T;
}

// ============================================================
// Signal group utility
// ============================================================

/**
 * Creates a signal group with automatic reset tracking.
 *
 * Use the returned `signal()` to create writable signals that are
 * automatically registered for bulk reset. `computed()` signals
 * don't need this — they auto-derive from writable signals.
 *
 * ```typescript
 * const { signal, resetAll } = createSignalGroup();
 * export const mode = signal<Mode>('commit');
 * export const pinned = signal(false);
 * export function resetState(): void { resetAll(); }
 * ```
 */
export function createSignalGroup() {
	const resets: Array<() => void> = [];

	return {
		signal: function <T>(initialValue: T) {
			const s = litSignal(initialValue);
			resets.push(() => s.set(initialValue));
			return s;
		},
		resetAll: function () {
			for (const reset of resets) {
				reset();
			}
		},
	};
}

// ============================================================
// State group with persistence
// ============================================================

export interface PersistedOptions<T> {
	serialize?: (value: T) => unknown;
	deserialize?: (raw: unknown) => T | undefined;
}

export interface StateGroup {
	signal<T>(initialValue: T): Signal.State<T>;
	persisted<T>(key: string, initialValue: T, options?: PersistedOptions<T>): Signal.State<T>;
	resetAll(): void;
	startAutoPersist(): () => void;
	dispose(): void;
}

interface PersistedEntry {
	key: string;
	signal: Signal.State<unknown>;
	serialize: (value: unknown) => unknown;
	reset: (checkpoint: Record<string, unknown> | undefined) => void;
}

const checkpointVersionKey = '__v';
const checkpointRestoreKey = '__rk';
const checkpointTimestampKey = '__ts';
const reservedKeys = new Set([checkpointVersionKey, checkpointRestoreKey, checkpointTimestampKey]);

/**
 * Creates a state group with optional persistence support.
 *
 * Extends `createSignalGroup()` with:
 * - `persisted()` signals that restore from and auto-save to storage
 * - `startAutoPersist()` using `Signal.subtle.Watcher` with microtask batching
 * - Version migration and `restoreKey` continuity control
 */
export function createStateGroup(options?: {
	storage?: HostStorage;
	version?: number;
	restoreKey?: string;
	migrate?: (raw: Record<string, unknown>, fromVersion: number | undefined) => Record<string, unknown> | undefined;
}): StateGroup {
	const storage = options?.storage;
	const version = options?.version;
	const restoreKey = options?.restoreKey;

	function loadCheckpoint(): Record<string, unknown> | undefined {
		if (storage == null) return undefined;

		let raw = storage.get();
		if (raw == null) return undefined;

		const storedVersion = raw[checkpointVersionKey] as number | undefined;
		const storedRestoreKey = raw[checkpointRestoreKey] as string | undefined;

		if (restoreKey != null && storedRestoreKey !== restoreKey) {
			return undefined;
		}

		if (version != null && storedVersion !== version) {
			raw = options?.migrate?.(raw, storedVersion) ?? undefined;
		}

		return raw;
	}

	const checkpoint = loadCheckpoint();

	const ephemeralResets: Array<() => void> = [];
	const persistedEntries: PersistedEntry[] = [];
	let watcher: Signal.subtle.Watcher | undefined;
	let persistScheduled = false;

	function flushPersist(): void {
		persistScheduled = false;
		// Re-arm the watcher after a notify callback. The polyfill requires both
		// getPending() and watch() before future notifications will fire again.
		watcher?.getPending();
		watcher?.watch();
		if (storage == null || persistedEntries.length === 0) return;

		const state: Record<string, unknown> = {};
		if (version != null) {
			state[checkpointVersionKey] = version;
		}
		if (restoreKey != null) {
			state[checkpointRestoreKey] = restoreKey;
		}
		state[checkpointTimestampKey] = Date.now();

		for (const entry of persistedEntries) {
			state[entry.key] = entry.serialize(entry.signal.get());
		}
		storage.set(state);
	}

	function schedulePersist(): void {
		if (!persistScheduled) {
			persistScheduled = true;
			queueMicrotask(flushPersist);
		}
	}

	function stopAutoPersistWatcher(activeWatcher?: Signal.subtle.Watcher): void {
		if (activeWatcher == null) return;

		if (watcher === activeWatcher && persistScheduled) {
			flushPersist();
		}

		for (const entry of persistedEntries) {
			activeWatcher.unwatch(entry.signal);
		}

		if (watcher === activeWatcher) {
			watcher = undefined;
		}
	}

	return {
		signal: function <T>(initialValue: T): Signal.State<T> {
			const s = litSignal(initialValue);
			ephemeralResets.push(() => s.set(initialValue));
			return s;
		},

		persisted: function <T>(key: string, initialValue: T, opts?: PersistedOptions<T>): Signal.State<T> {
			if (reservedKeys.has(key)) {
				throw new Error(`Cannot use reserved key '${key}' for persisted signal`);
			}

			const deserialize = opts?.deserialize;
			const serialize = (opts?.serialize as ((value: unknown) => unknown) | undefined) ?? ((v: unknown) => v);

			const restore = (source: Record<string, unknown> | undefined): T => {
				if (source == null || !(key in source)) {
					return initialValue;
				}

				const raw = source[key];
				if (deserialize != null) {
					const deserialized = deserialize(raw);
					return deserialized !== undefined ? deserialized : initialValue;
				}

				return raw as T;
			};

			const s = litSignal(restore(checkpoint));
			persistedEntries.push({
				key: key,
				signal: s as Signal.State<unknown>,
				serialize: serialize,
				reset: (latestCheckpoint: Record<string, unknown> | undefined) => {
					s.set(restore(latestCheckpoint));
				},
			});

			// If watcher is already running, add this signal to it
			if (watcher != null) {
				watcher.watch(s);
			}

			return s;
		},

		resetAll: function (): void {
			// resetAll() is for reconnect/reset flows. Keep registrations intact so the same
			// state group instance can restore persisted signals and continue being reused.
			for (const reset of ephemeralResets) {
				reset();
			}
			const latestCheckpoint = loadCheckpoint();
			for (const entry of persistedEntries) {
				entry.reset(latestCheckpoint);
			}
		},

		startAutoPersist: function (): () => void {
			if (storage == null) return () => {};

			stopAutoPersistWatcher(watcher);

			const currentWatcher = new Signal.subtle.Watcher(() => {
				schedulePersist();
			});
			watcher = currentWatcher;

			// Watch all already-registered persisted signals
			for (const entry of persistedEntries) {
				currentWatcher.watch(entry.signal);
			}

			return () => {
				stopAutoPersistWatcher(currentWatcher);
			};
		},

		dispose: function (): void {
			// dispose() is permanent teardown. Clear watchers and registrations so this
			// state group instance won't be reused after disconnect.
			stopAutoPersistWatcher(watcher);
			ephemeralResets.length = 0;
			persistedEntries.length = 0;
		},
	};
}
