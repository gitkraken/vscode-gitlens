import * as assert from 'assert';
import type { HostStorage } from '../../host/storage.js';
import { InMemoryStorage } from '../../host/storage.js';
import { createStateGroup } from '../signals.js';

suite('createStateGroup Test Suite', () => {
	suite('signal()', () => {
		test('should create a writable signal with initial value', () => {
			const group = createStateGroup();
			const s = group.signal(42);

			assert.strictEqual(s.get(), 42);
		});

		test('should allow setting new values', () => {
			const group = createStateGroup();
			const s = group.signal('hello');

			s.set('world');
			assert.strictEqual(s.get(), 'world');
		});
	});

	suite('resetAll()', () => {
		test('should reset all signals to their initial values', () => {
			const group = createStateGroup();
			const a = group.signal(1);
			const b = group.signal('foo');

			a.set(99);
			b.set('bar');
			group.resetAll();

			assert.strictEqual(a.get(), 1, 'numeric signal should reset');
			assert.strictEqual(b.get(), 'foo', 'string signal should reset');
		});

		test('should reset persisted signals from storage', () => {
			const storage = new InMemoryStorage();
			storage.set({ key: 10 });
			const group = createStateGroup({ storage: storage });
			const p = group.persisted('key', 0);

			p.set(999);
			group.resetAll();

			assert.strictEqual(p.get(), 10, 'persisted signal should restore from storage');
		});

		test('should re-read the latest stored value for persisted signals on reset', () => {
			const storage = new InMemoryStorage();
			storage.set({ key: 10 });
			const group = createStateGroup({ storage: storage });
			const p = group.persisted('key', 0);

			storage.set({ key: 20 });
			p.set(999);
			group.resetAll();

			assert.strictEqual(p.get(), 20, 'persisted signal should use the latest stored value');
		});
	});

	suite('persisted()', () => {
		test('should create a signal with initial value when no storage data', () => {
			const group = createStateGroup({ storage: new InMemoryStorage() });
			const p = group.persisted('count', 0);

			assert.strictEqual(p.get(), 0);
		});

		test('should restore from storage checkpoint', () => {
			const storage = new InMemoryStorage();
			storage.set({ count: 42 });

			const group = createStateGroup({ storage: storage });
			const p = group.persisted('count', 0);

			assert.strictEqual(p.get(), 42, 'should restore persisted value from checkpoint');
		});

		test('should use deserialize option when restoring', () => {
			const storage = new InMemoryStorage();
			storage.set({ items: [1, 2, 3] });

			const group = createStateGroup({ storage: storage });
			const p = group.persisted<Set<number>>('items', new Set(), {
				deserialize: raw => (Array.isArray(raw) ? new Set(raw as number[]) : undefined),
				serialize: value => [...value],
			});

			assert.ok(p.get() instanceof Set, 'should deserialize to Set');
			assert.strictEqual(p.get().size, 3, 'should have 3 items');
			assert.ok(p.get().has(2), 'should contain value 2');
		});

		test('should fall back to initial value when deserialize returns undefined', () => {
			const storage = new InMemoryStorage();
			storage.set({ val: 'invalid' });

			const group = createStateGroup({ storage: storage });
			const p = group.persisted('val', 'default', {
				deserialize: () => undefined,
			});

			assert.strictEqual(p.get(), 'default', 'should use initial when deserialize returns undefined');
		});

		test('should throw on reserved keys', () => {
			const group = createStateGroup({ storage: new InMemoryStorage() });

			assert.throws(() => group.persisted('__v', 0), /reserved key/);
			assert.throws(() => group.persisted('__rk', ''), /reserved key/);
			assert.throws(() => group.persisted('__ts', 0), /reserved key/);
		});
	});

	suite('version and restoreKey', () => {
		test('should discard checkpoint when restoreKey does not match', () => {
			const storage = new InMemoryStorage();
			storage.set({ __rk: 'old-key', count: 42 });

			const group = createStateGroup({ storage: storage, restoreKey: 'new-key' });
			const p = group.persisted('count', 0);

			assert.strictEqual(p.get(), 0, 'should not restore when restoreKey mismatches');
		});

		test('should restore checkpoint when restoreKey matches', () => {
			const storage = new InMemoryStorage();
			storage.set({ __rk: 'same-key', count: 42 });

			const group = createStateGroup({ storage: storage, restoreKey: 'same-key' });
			const p = group.persisted('count', 0);

			assert.strictEqual(p.get(), 42, 'should restore when restoreKey matches');
		});

		test('should run migrate on version mismatch', () => {
			const storage = new InMemoryStorage();
			storage.set({ __v: 1, count: 10 });

			const group = createStateGroup({
				storage: storage,
				version: 2,
				migrate: (raw, fromVersion) => {
					assert.strictEqual(fromVersion, 1, 'migrate should receive stored version');
					return { ...raw, count: (raw['count'] as number) * 2 };
				},
			});
			const p = group.persisted('count', 0);

			assert.strictEqual(p.get(), 20, 'should use migrated value');
		});

		test('should discard checkpoint when migrate returns undefined', () => {
			const storage = new InMemoryStorage();
			storage.set({ __v: 1, count: 10 });

			const group = createStateGroup({
				storage: storage,
				version: 2,
				migrate: () => undefined,
			});
			const p = group.persisted('count', 0);

			assert.strictEqual(p.get(), 0, 'should use initial when migrate returns undefined');
		});
	});

	suite('startAutoPersist()', () => {
		test('should persist signals to storage via microtask', async () => {
			const storage = new InMemoryStorage();
			const group = createStateGroup({ storage: storage, version: 1 });
			const count = group.persisted('count', 0);
			const stop = group.startAutoPersist();

			count.set(42);

			// Wait for microtask to flush
			await new Promise<void>(resolve => queueMicrotask(resolve));

			const stored = storage.get();
			assert.strictEqual(stored?.['count'], 42, 'should persist updated value');
			assert.strictEqual(stored?.['__v'], 1, 'should include version');

			stop();
		});

		test('should batch multiple changes into one persist', async () => {
			let persistCount = 0;
			let stored: Record<string, unknown> | undefined;
			const trackingStorage: HostStorage = {
				get: function () {
					return stored;
				},
				set: function (state: Record<string, unknown>) {
					stored = state;
					persistCount++;
				},
			};

			const group = createStateGroup({ storage: trackingStorage });
			const a = group.persisted('a', 0);
			const b = group.persisted('b', 0);
			const stop = group.startAutoPersist();

			a.set(1);
			b.set(2);

			await new Promise<void>(resolve => queueMicrotask(resolve));

			assert.strictEqual(persistCount, 1, 'should batch into a single persist');
			assert.strictEqual(stored?.['a'], 1);
			assert.strictEqual(stored?.['b'], 2);

			stop();
		});

		test('should keep persisting after the first flush', async () => {
			let persistCount = 0;
			const storage = new InMemoryStorage();
			const originalSet = storage.set.bind(storage);
			storage.set = function (state: Record<string, unknown>) {
				persistCount++;
				originalSet(state);
			};

			const group = createStateGroup({ storage: storage });
			const count = group.persisted('count', 0);
			const stop = group.startAutoPersist();

			count.set(1);
			await new Promise<void>(resolve => queueMicrotask(resolve));

			assert.strictEqual(storage.get()?.['count'], 1, 'should persist the first change');

			count.set(2);
			await new Promise<void>(resolve => queueMicrotask(resolve));

			assert.strictEqual(storage.get()?.['count'], 2, 'should persist subsequent changes');
			assert.strictEqual(persistCount, 2, 'should persist once per flushed change cycle');

			stop();
		});

		test('should replace a previous auto-persist watcher safely', async () => {
			let persistCount = 0;
			const storage = new InMemoryStorage();
			const originalSet = storage.set.bind(storage);
			storage.set = function (state: Record<string, unknown>) {
				persistCount++;
				originalSet(state);
			};

			const group = createStateGroup({ storage: storage });
			const count = group.persisted('count', 0);
			const firstStop = group.startAutoPersist();

			count.set(1);
			await new Promise<void>(resolve => queueMicrotask(resolve));
			assert.strictEqual(storage.get()?.['count'], 1, 'first watcher should persist changes');

			const secondStop = group.startAutoPersist();

			count.set(2);
			await new Promise<void>(resolve => queueMicrotask(resolve));
			assert.strictEqual(storage.get()?.['count'], 2, 'replacement watcher should persist changes');

			firstStop();

			count.set(3);
			await new Promise<void>(resolve => queueMicrotask(resolve));
			assert.strictEqual(storage.get()?.['count'], 3, 'stale cleanup should not stop the replacement watcher');

			secondStop();

			count.set(4);
			await new Promise<void>(resolve => queueMicrotask(resolve));
			assert.strictEqual(storage.get()?.['count'], 3, 'active cleanup should stop future persistence');
			assert.strictEqual(persistCount, 3, 'should persist exactly once per active flush cycle');
		});

		test('should flush on stop', () => {
			const storage = new InMemoryStorage();
			const group = createStateGroup({ storage: storage });
			const count = group.persisted('count', 0);
			const stop = group.startAutoPersist();

			count.set(99);
			stop(); // Should flush synchronously

			assert.strictEqual(storage.get()?.['count'], 99, 'should flush pending changes on stop');
		});
	});

	suite('dispose()', () => {
		test('should clear all registrations', () => {
			const storage = new InMemoryStorage();
			const group = createStateGroup({ storage: storage });
			group.persisted('x', 1);
			group.startAutoPersist();

			group.dispose();

			// After dispose, resetAll should be a no-op (no signals registered)
			// and startAutoPersist should return a no-op cleanup
			const cleanup = group.startAutoPersist();
			cleanup();
		});
	});
});
