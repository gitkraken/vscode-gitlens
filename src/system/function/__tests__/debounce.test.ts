import * as assert from 'assert';
import * as sinon from 'sinon';
import { debounce } from '../debounce';

suite('Debounce Test Suite', () => {
	test('should debounce function calls', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;
			const debounced = debounce(spy, wait);

			// Call immediately, should not execute spy yet
			debounced();
			assert.strictEqual(spy.callCount, 0);

			// Advance timer by half the wait time, should not execute yet
			clock.tick(wait / 2);
			assert.strictEqual(spy.callCount, 0);

			// Advance timer past wait time, should execute once
			clock.tick(wait);
			assert.strictEqual(spy.callCount, 1);

			// Call again to restart timer
			debounced();
			assert.strictEqual(spy.callCount, 1);

			// Call multiple times in quick succession
			debounced();
			debounced();
			debounced();
			assert.strictEqual(spy.callCount, 1);

			// Advance past wait time, should execute one more time
			clock.tick(wait);
			assert.strictEqual(spy.callCount, 2);
		} finally {
			clock.restore();
		}
	});

	test('should pass the correct arguments to the debounced function', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;
			const debounced = debounce(spy, wait);

			// Call with arguments
			const arg1 = { value: 'test' };
			const arg2 = 42;
			debounced(arg1, arg2);

			// Advance time
			clock.tick(wait);

			// Verify spy was called with the correct arguments
			assert.strictEqual(spy.callCount, 1);
			assert.strictEqual(spy.firstCall.args[0], arg1);
			assert.strictEqual(spy.firstCall.args[1], arg2);
		} finally {
			clock.restore();
		}
	});

	test('should handle maxWait parameter', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;
			const maxWait = 250;
			const debounced = debounce(spy, wait, { maxWait: maxWait });

			// First call
			debounced();
			assert.strictEqual(spy.callCount, 0);

			// Multiple calls before wait time
			clock.tick(wait - 10);
			debounced();
			clock.tick(wait - 10);
			debounced();

			// We've reset the wait timer multiple times, but haven't hit maxWait yet
			assert.strictEqual(spy.callCount, 0);

			// Continue calling but hit maxWait
			clock.tick(maxWait - (wait * 2 - 20));
			assert.strictEqual(spy.callCount, 1);

			// Calling after execution doesn't immediately run
			debounced();
			assert.strictEqual(spy.callCount, 1);

			// Wait for normal wait time
			clock.tick(wait);
			assert.strictEqual(spy.callCount, 2);
		} finally {
			clock.restore();
		}
	});

	test('should use aggregator function when provided', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;

			// Aggregator that sums the first argument of each call
			const aggregator = (prevArgs: unknown[], nextArgs: unknown[]): unknown[] => {
				return [(prevArgs[0] as number) + (nextArgs[0] as number)];
			};

			const debounced = debounce(spy, wait, { aggregator: aggregator });

			// Call with initial value
			debounced(5);

			// Call with more values before timeout
			debounced(10);
			debounced(15);

			// Advance timer
			clock.tick(wait);

			// Verify spy was called with aggregated value (5 + 10 + 15 = 30)
			assert.strictEqual(spy.callCount, 1);
			assert.strictEqual(spy.firstCall.args[0], 30);
		} finally {
			clock.restore();
		}
	});

	test('should support cancel method', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;
			const debounced = debounce(spy, wait);

			// Call function
			debounced();
			assert.strictEqual(spy.callCount, 0);

			// Cancel before wait time
			debounced.cancel();

			// Advance time past wait
			clock.tick(wait);

			// Verify function was not called
			assert.strictEqual(spy.callCount, 0);
		} finally {
			clock.restore();
		}
	});

	test('should support flush method', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;
			const debounced = debounce(spy, wait);

			// Call function
			debounced();
			assert.strictEqual(spy.callCount, 0);

			// Flush immediately
			debounced.flush();

			// Verify function was called immediately without waiting
			assert.strictEqual(spy.callCount, 1);

			// Advancing time should not cause another call
			clock.tick(wait);
			assert.strictEqual(spy.callCount, 1);
		} finally {
			clock.restore();
		}
	});

	test('should support pending method', () => {
		const clock = sinon.useFakeTimers();
		try {
			const spy = sinon.spy();
			const wait = 100;
			const debounced = debounce(spy, wait);

			// Check initial state
			assert.strictEqual(debounced.pending(), false);

			// Call function
			debounced();

			// Should be pending now
			assert.strictEqual(debounced.pending(), true);

			// Advance time past wait
			clock.tick(wait);

			// Should no longer be pending
			assert.strictEqual(debounced.pending(), false);
		} finally {
			clock.restore();
		}
	});

	test('should maintain correct this context', () => {
		const clock = sinon.useFakeTimers();
		try {
			const context = { value: 42 };
			const spy = sinon.spy(function (this: typeof context) {
				assert.strictEqual(this.value, 42);
			});
			const wait = 100;
			const debounced = debounce(spy, wait);

			debounced.call(context);
			clock.tick(wait);
			assert.strictEqual(spy.callCount, 1);
		} finally {
			clock.restore();
		}
	});
});
