import * as assert from 'assert';
import type { Storage } from '../../../../../system/-webview/storage.js';
import { storeRefusedTrialReactivation } from '../subscription.utils.js';

suite('Subscription Utils (host) Test Suite', () => {
	suite('storeRefusedTrialReactivation', () => {
		const key = 'plus:trialReactivation:acct:refused';
		const optInDate = '2026-01-01T00:00:00.000Z';

		/** Storage whose first `dropWrites` writes resolve without landing */
		function createStorage(dropWrites: number) {
			const stored = new Map<string, unknown>();
			const writes: unknown[] = [];
			const storage = {
				get: (k: string) => stored.get(k),
				store: (k: string, value: unknown) => {
					writes.push(value);
					if (writes.length > dropWrites) {
						stored.set(k, value);
					}
					return Promise.resolve();
				},
			} as unknown as Storage;
			return { storage: storage, stored: stored, writes: writes };
		}

		test('writes once when the write lands', async () => {
			const { storage, stored, writes } = createStorage(0);
			await storeRefusedTrialReactivation(storage, 'acct', optInDate);
			assert.strictEqual(writes.length, 1);
			assert.deepStrictEqual(stored.get(key), { nextTrialOptInDate: optInDate });
		});

		test('repeats a write that resolved without landing', async () => {
			const { storage, stored, writes } = createStorage(1);
			await storeRefusedTrialReactivation(storage, 'acct', optInDate);
			assert.strictEqual(writes.length, 2);
			assert.deepStrictEqual(stored.get(key), { nextTrialOptInDate: optInDate });
		});

		test('gives up after one repeat', async () => {
			const { storage, writes } = createStorage(2);
			await storeRefusedTrialReactivation(storage, 'acct', optInDate);
			assert.strictEqual(writes.length, 2);
		});

		test('accepts a marker already stored for the same opt-in window without repeating', async () => {
			const { storage, stored, writes } = createStorage(1);
			stored.set(key, { nextTrialOptInDate: optInDate });
			await storeRefusedTrialReactivation(storage, 'acct', optInDate);
			assert.strictEqual(writes.length, 1);
		});

		test('replaces a marker for another opt-in window', async () => {
			const { storage, stored, writes } = createStorage(0);
			stored.set(key, { nextTrialOptInDate: '2025-01-01T00:00:00.000Z' });
			await storeRefusedTrialReactivation(storage, 'acct', optInDate);
			assert.strictEqual(writes.length, 1);
			assert.deepStrictEqual(stored.get(key), { nextTrialOptInDate: optInDate });
		});
	});
});
