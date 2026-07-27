import * as assert from 'assert';
import { mapBounded } from '../promise.js';

/** A task whose completion is controlled by the test, so in-flight counts can be observed deterministically. */
function createGatedTask() {
	const releases: (() => void)[] = [];
	let inFlight = 0;
	let peakInFlight = 0;

	const task = async (item: number): Promise<number> => {
		inFlight++;
		peakInFlight = Math.max(peakInFlight, inFlight);
		await new Promise<void>(resolve => releases.push(resolve));
		inFlight--;
		return item * 2;
	};

	return {
		task: task,
		get peakInFlight() {
			return peakInFlight;
		},
		get started() {
			return releases.length;
		},
		releaseAll: () => {
			// Release everything queued so far; workers started by those completions queue their own release.
			while (releases.length) {
				releases.shift()!();
			}
		},
	};
}

suite('mapBounded', () => {
	test('never runs more than `concurrency` tasks at once', async () => {
		const gated = createGatedTask();
		const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

		const pending = mapBounded(items, 3, gated.task);
		// Let the initial workers start before releasing anything.
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.strictEqual(gated.started, 3, 'only `concurrency` tasks start up front');

		for (let i = 0; i < items.length + 2; i++) {
			gated.releaseAll();
			await new Promise<void>(resolve => setTimeout(resolve, 0));
		}

		await pending;
		assert.strictEqual(gated.peakInFlight, 3);
	});

	test('returns results in input order regardless of completion order', async () => {
		const results = await mapBounded([5, 1, 4, 2, 3], 2, async item => {
			await new Promise<void>(resolve => setTimeout(resolve, item));
			return item;
		});

		assert.deepStrictEqual(results, [5, 1, 4, 2, 3]);
	});

	test('handles fewer items than the cap, and an empty list', async () => {
		assert.deepStrictEqual(await mapBounded([1, 2], 10, item => Promise.resolve(item * 2)), [2, 4]);
		assert.deepStrictEqual(await mapBounded([], 4, () => Promise.reject(new Error('never called'))), []);
	});

	test('propagates the first rejection, like Promise.all', async () => {
		await assert.rejects(
			mapBounded([1, 2, 3], 2, async item => {
				if (item === 2) throw new Error('boom');
				return item;
			}),
			/boom/,
		);
	});

	test('treats a non-positive concurrency as 1 rather than stalling', async () => {
		const results = await mapBounded([1, 2, 3], 0, item => Promise.resolve(item + 1));
		assert.deepStrictEqual(results, [2, 3, 4]);
	});
});
