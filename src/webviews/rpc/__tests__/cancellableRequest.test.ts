import * as assert from 'assert';
import { CancellableRequest } from '../../apps/shared/cancellableRequest.js';

suite('CancellableRequest Test Suite', () => {
	test('should return { value } on normal completion', async () => {
		const request = new CancellableRequest();
		const result = await request.run(_signal => Promise.resolve('hello'));
		assert.deepStrictEqual(result, { value: 'hello' });
	});

	test('should return undefined when a new request supersedes the previous', async () => {
		const request = new CancellableRequest();

		// Start first request that blocks until signaled
		let resolveFirst: ((value: string) => void) | undefined;
		const first = request.run(
			_signal =>
				new Promise<string>(resolve => {
					resolveFirst = resolve;
				}),
		);

		// Start second request immediately — this aborts the first
		const second = request.run(_signal => Promise.resolve('second-result'));

		// Resolve the first promise (after abort)
		resolveFirst!('first-result');

		const [firstResult, secondResult] = await Promise.all([first, second]);
		assert.strictEqual(firstResult, undefined, 'first request should be cancelled');
		assert.deepStrictEqual(secondResult, { value: 'second-result' });
	});

	test('should propagate non-cancellation errors', async () => {
		const request = new CancellableRequest();

		await assert.rejects(() => request.run(_signal => Promise.reject(new Error('network failure'))), {
			message: 'network failure',
		});
	});

	test('should return undefined when error occurs after abort', async () => {
		const request = new CancellableRequest();

		let rejectFirst: ((reason: Error) => void) | undefined;
		const first = request.run(
			_signal =>
				new Promise<string>((_resolve, reject) => {
					rejectFirst = reject;
				}),
		);

		// Start second request — aborts the first
		const second = request.run(_signal => Promise.resolve('ok'));

		// First rejects after abort — should be swallowed (returns undefined, not thrown)
		rejectFirst!(new Error('late error'));

		const [firstResult, secondResult] = await Promise.all([first, second]);
		assert.strictEqual(firstResult, undefined, 'aborted request error should be swallowed');
		assert.deepStrictEqual(secondResult, { value: 'ok' });
	});

	test('should abort controller with "completed" after normal completion', async () => {
		const request = new CancellableRequest();
		let capturedSignal: AbortSignal | undefined;

		await request.run(signal => {
			capturedSignal = signal;
			return Promise.resolve('done');
		});

		assert.ok(capturedSignal, 'signal should have been captured');
		assert.strictEqual(capturedSignal.aborted, true, 'signal should be aborted after completion');
		assert.strictEqual(capturedSignal.reason, 'completed', 'abort reason should be "completed"');
	});

	test('cancel() should be safe to call when no request is in flight', () => {
		const request = new CancellableRequest();
		// Should not throw
		request.cancel();
	});

	test('cancel() should abort the current request', async () => {
		const request = new CancellableRequest();
		let capturedSignal: AbortSignal | undefined;

		const resultPromise = request.run(
			signal =>
				new Promise<string>(resolve => {
					capturedSignal = signal;
					signal.addEventListener('abort', () => resolve('aborted'));
				}),
		);

		request.cancel();
		const result = await resultPromise;

		assert.ok(capturedSignal?.aborted, 'signal should be aborted');
		assert.strictEqual(result, undefined, 'cancelled request should return undefined');
	});

	test('should handle rapid sequential runs', async () => {
		const request = new CancellableRequest();
		const blockers: Array<(value: string) => void> = [];

		// Start 5 requests in rapid succession
		const promises = [];
		for (let i = 0; i < 5; i++) {
			promises.push(
				request.run(
					_signal =>
						new Promise<string>(resolve => {
							blockers.push(resolve);
						}),
				),
			);
		}

		// Resolve all (only the last should not be aborted)
		for (let i = 0; i < blockers.length; i++) {
			blockers[i](`result-${i}`);
		}

		const results = await Promise.all(promises);
		// First 4 should be undefined (aborted), last should have the value
		for (let i = 0; i < 4; i++) {
			assert.strictEqual(results[i], undefined, `request ${i} should be cancelled`);
		}
		assert.deepStrictEqual(results[4], { value: 'result-4' });
	});
});
