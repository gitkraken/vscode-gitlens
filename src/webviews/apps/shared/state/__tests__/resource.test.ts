import * as assert from 'assert';
import { createResource } from '../resource.js';

suite('createResource Test Suite', () => {
	suite('initial state', () => {
		test('should start with idle status and default values', () => {
			const resource = createResource(async () => 42);

			assert.strictEqual(resource.value.get(), undefined);
			assert.strictEqual(resource.loading.get(), false);
			assert.strictEqual(resource.error.get(), undefined);
			assert.strictEqual(resource.status.get(), 'idle');
		});

		test('should use initialValue when provided', () => {
			const resource = createResource(async () => 42, { initialValue: 0 });

			assert.strictEqual(resource.value.get(), 0);
			assert.strictEqual(resource.status.get(), 'idle');
		});
	});

	suite('fetch()', () => {
		test('should transition to loading then success', async () => {
			let resolve!: (value: number) => void;
			const resource = createResource<number>(async () => new Promise<number>(r => (resolve = r)));

			const fetchPromise = resource.fetch();

			assert.strictEqual(resource.loading.get(), true, 'should be loading during fetch');
			assert.strictEqual(resource.status.get(), 'loading');

			resolve(42);
			await fetchPromise;

			assert.strictEqual(resource.value.get(), 42, 'should have fetched value');
			assert.strictEqual(resource.loading.get(), false, 'should not be loading after fetch');
			assert.strictEqual(resource.error.get(), undefined, 'should have no error');
			assert.strictEqual(resource.status.get(), 'success');
		});

		test('should transition to success even when the fetched value is undefined', async () => {
			const resource = createResource<undefined>(async () => undefined);

			await resource.fetch();

			assert.strictEqual(resource.value.get(), undefined);
			assert.strictEqual(resource.status.get(), 'success');
		});

		test('should transition to error on failure', async () => {
			const resource = createResource<number>(async () => {
				throw new Error('fetch failed');
			});

			await resource.fetch();

			assert.strictEqual(resource.loading.get(), false, 'should not be loading after error');
			assert.strictEqual(resource.error.get(), 'fetch failed', 'should capture error message');
			assert.strictEqual(resource.status.get(), 'error');
		});

		test('should clear previous error on new fetch', async () => {
			let shouldFail = true;
			const resource = createResource<number>(async () => {
				if (shouldFail) {
					throw new Error('fail');
				}
				return 42;
			});

			await resource.fetch();
			assert.strictEqual(resource.error.get(), 'fail');

			shouldFail = false;
			await resource.fetch();
			assert.strictEqual(resource.error.get(), undefined, 'error should be cleared on success');
			assert.strictEqual(resource.value.get(), 42);
		});
	});

	suite('cancel previous', () => {
		test('should cancel previous fetch by default', async () => {
			let callCount = 0;
			const resource = createResource<number>(async signal => {
				callCount++;
				await new Promise(r => setTimeout(r, 10));
				if (signal.aborted) return 0;
				return callCount;
			});

			const first = resource.fetch();
			const second = resource.fetch();

			await Promise.all([first, second]);

			assert.strictEqual(resource.value.get(), 2, 'should have value from second fetch');
		});

		test('should not cancel previous when cancelPrevious is false', async () => {
			let completedCount = 0;
			const resource = createResource<number>(
				async signal => {
					await new Promise(r => setTimeout(r, 10));
					if (!signal.aborted) {
						completedCount++;
					}
					return completedCount;
				},
				{ cancelPrevious: false },
			);

			await Promise.all([resource.fetch(), resource.fetch()]);

			assert.strictEqual(completedCount, 2, 'both fetches should complete without cancellation');
		});
	});

	suite('refetch()', () => {
		test('should re-run with same args', async () => {
			const calls: number[][] = [];
			const resource = createResource<number, [number]>(async (_signal, n) => {
				calls.push([n]);
				return n * 2;
			});

			await resource.fetch(5);
			assert.strictEqual(resource.value.get(), 10);

			await resource.refetch();
			assert.strictEqual(resource.value.get(), 10, 'refetch should produce same result');
			assert.strictEqual(calls.length, 2, 'fetcher should be called twice');
			assert.deepStrictEqual(calls[1], [5], 'refetch should use same args');
		});

		test('should no-op when never fetched', async () => {
			const resource = createResource<number>(async () => 42);

			await resource.refetch();

			assert.strictEqual(resource.value.get(), undefined, 'should not fetch without prior args');
		});
	});

	suite('mutate()', () => {
		test('should update value without fetching', () => {
			const resource = createResource<number>(async () => 42, { initialValue: 0 });

			resource.mutate(99);

			assert.strictEqual(resource.value.get(), 99, 'should have mutated value');
			assert.strictEqual(resource.loading.get(), false, 'should not be loading');
		});

		test('should clear a previous error', async () => {
			const resource = createResource<number>(async () => {
				throw new Error('fail');
			});

			await resource.fetch();
			resource.mutate(99);

			assert.strictEqual(resource.error.get(), undefined, 'mutate should clear stale errors');
			assert.strictEqual(resource.status.get(), 'success');
		});
	});

	suite('cancel()', () => {
		test('should abort in-flight fetch', async () => {
			let aborted = false;
			const resource = createResource<number>(async signal => {
				signal.addEventListener('abort', () => (aborted = true));
				await new Promise(r => setTimeout(r, 100));
				return 42;
			});

			const fetchPromise = resource.fetch();
			resource.cancel();

			await fetchPromise;

			assert.ok(aborted, 'abort signal should have fired');
		});

		test('should clear loading state when cancelled', async () => {
			const resource = createResource<number>(async signal => {
				await new Promise(r => setTimeout(r, 100));
				if (signal.aborted) return 0;
				return 42;
			});

			const fetchPromise = resource.fetch();
			resource.cancel();

			await fetchPromise;

			assert.strictEqual(resource.loading.get(), false, 'cancel should clear loading state');
			assert.strictEqual(resource.status.get(), 'idle', 'cancelled initial fetch should return to idle');
		});
	});

	suite('dispose()', () => {
		test('should prevent future fetches', async () => {
			let fetchCount = 0;
			const resource = createResource<number>(async () => {
				fetchCount++;
				return 42;
			});

			resource.dispose();
			await resource.fetch();

			assert.strictEqual(fetchCount, 0, 'fetcher should not be called after dispose');
		});

		test('should cancel in-flight fetch', async () => {
			let aborted = false;
			const resource = createResource<number>(async signal => {
				signal.addEventListener('abort', () => (aborted = true));
				await new Promise(r => setTimeout(r, 100));
				return 42;
			});

			const fetchPromise = resource.fetch();
			resource.dispose();
			await fetchPromise;

			assert.ok(aborted, 'dispose should abort in-flight fetch');
		});

		test('should not abort after a successful fetch completes', async () => {
			let aborted = false;
			const resource = createResource<number>(async signal => {
				signal.addEventListener('abort', () => (aborted = true));
				return 42;
			});

			await resource.fetch();

			assert.strictEqual(aborted, false, 'successful fetch should not emit abort');
		});
	});
});
