import * as assert from 'assert';
import { gate } from '../gate';
import { memoize } from '../memoize';
import { sequentialize } from '../sequentialize';

suite('Decorator Test Suite', () => {
	suite('sequentialize', () => {
		test('should execute calls sequentially', async () => {
			const executionOrder: number[] = [];
			let counter = 0;

			class TestClass {
				@sequentialize()
				async method(delay: number): Promise<number> {
					const id = ++counter;
					executionOrder.push(id);
					await new Promise(resolve => setTimeout(resolve, delay));
					return id;
				}
			}

			const instance = new TestClass();

			// Start three calls with different delays
			const p1 = instance.method(50); // Should execute first
			const p2 = instance.method(10); // Should execute second (even though faster)
			const p3 = instance.method(5); // Should execute third

			const results = await Promise.all([p1, p2, p3]);

			// All should complete
			assert.deepStrictEqual(results, [1, 2, 3]);
			// Execution order should be sequential
			assert.deepStrictEqual(executionOrder, [1, 2, 3]);
		});

		test('should deduplicate consecutive calls with same arguments', async () => {
			let executionCount = 0;
			const counterMap = new Map<string, number>();

			class TestClass {
				@sequentialize()
				async method(value: string): Promise<string> {
					executionCount++;
					let counter = counterMap.get(value) || 0;
					const id = ++counter;
					counterMap.set(value, counter);
					await new Promise(resolve => setTimeout(resolve, 10));
					return `${value}=${id}`;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method('msg1'); // Call 1 starts immediately
			const p2 = instance.method('msg1'); // Call 2 chains and becomes waiting
			const p3 = instance.method('msg1'); // Call 3 deduplicates with Call 2 (consecutive, same args)
			const p4 = instance.method('msg2'); // Call 4 chains, doesn't deduplicate (different args)
			const p5 = instance.method('msg1'); // Call 5 chains, doesn't deduplicate (not consecutive)

			const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5]);

			// Total executions: 4 (p1, p2 shared by calls 2&3, p4, p5)
			assert.strictEqual(executionCount, 4);

			assert.strictEqual(r1, `msg1=1`);
			// Calls 2 and 3 should share the same result
			assert.strictEqual(r2, `msg1=2`);
			assert.strictEqual(r3, `msg1=2`);
			assert.strictEqual(r4, `msg2=1`);
			assert.strictEqual(r5, `msg1=3`);
		});

		test('should not deduplicate non-consecutive calls', async () => {
			let executionCount = 0;
			const counterMap = new Map<string, number>();

			class TestClass {
				@sequentialize()
				async method(value: string): Promise<string> {
					executionCount++;
					let counter = counterMap.get(value) || 0;
					const id = ++counter;
					counterMap.set(value, counter);
					await new Promise(resolve => setTimeout(resolve, 10));
					return `${value}=${id}`;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method('msg1'); // Call 1 starts immediately
			const p2 = instance.method('msg1'); // Call 2 chains and becomes waiting
			const p3 = instance.method('msg2'); // Call 3 chains, doesn't deduplicate (different args)
			const p4 = instance.method('msg1'); // Call 4 chains, doesn't deduplicate (not consecutive)

			const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);

			// Should execute 4 times (no deduplication)
			assert.strictEqual(executionCount, 4);

			assert.strictEqual(r1, `msg1=1`);
			assert.strictEqual(r2, `msg1=2`);
			assert.strictEqual(r3, `msg2=1`);
			assert.strictEqual(r4, `msg1=3`);
		});

		test('should work with custom resolver', async () => {
			let executionCount = 0;

			class TestClass {
				@sequentialize({ getDedupingKey: (obj: { id: number }) => obj.id.toString() })
				async method(obj: { id: number; data: string }): Promise<string> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return `${obj.id}=${executionCount}`;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method({ id: 1, data: 'a' }); // Call 1 starts immediately
			const p2 = instance.method({ id: 1, data: 'b' }); // Call 2 chains and becomes waiting
			const p3 = instance.method({ id: 1, data: 'c' }); // Call 3 deduplicates with Call 2 (consecutive, same resolved args)
			const p4 = instance.method({ id: 2, data: 'a' }); // Call 4 chains, doesn't deduplicate (not consecutive)
			const p5 = instance.method({ id: 2, data: 'd' }); // Call 5 deduplicates with Call 4 (consecutive, same resolved args)

			const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5]);

			// Should execute 3 times (p1, p2 shared by calls 2&3, p4, p5 shared by calls 4&5)
			assert.strictEqual(executionCount, 3);

			assert.strictEqual(r1, `1=1`);
			assert.strictEqual(r2, `1=2`);
			assert.strictEqual(r3, `1=2`);
			assert.strictEqual(r4, `2=3`);
			assert.strictEqual(r5, `2=3`);
		});

		test('should handle errors correctly', async () => {
			let executionCount = 0;

			class TestClass {
				@sequentialize()
				async method(shouldFail: boolean): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					if (shouldFail) {
						throw new Error('Test error');
					}
					return executionCount;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method(true); // Will fail
			const p2 = instance.method(false); // Should still execute after p1 fails

			await assert.rejects(p1, /Test error/);
			const result = await p2;

			assert.strictEqual(executionCount, 2);
			assert.strictEqual(result, 2);
		});

		test('should clean up state after all calls complete', async () => {
			class TestClass {
				@sequentialize()
				async method(value: string): Promise<string> {
					await new Promise(resolve => setTimeout(resolve, 10));
					return value;
				}
			}

			const instance = new TestClass();
			const stateKey = '$sequentialize$method';

			// Initially no state
			assert.strictEqual((instance as any)[stateKey], undefined);

			const p1 = instance.method('test');
			// State should exist while call is pending
			assert.notStrictEqual((instance as any)[stateKey], undefined);

			await p1;
			// State should be cleaned up after completion
			assert.strictEqual((instance as any)[stateKey], undefined);
		});

		test('should handle empty arguments', async () => {
			let executionCount = 0;

			class TestClass {
				@sequentialize()
				async method(): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return executionCount;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method();
			const p2 = instance.method(); // Should chain and become waiting
			const p3 = instance.method(); // Should dedupe with p2

			const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

			// Should execute 2 times (p1, then p2 shared by calls 2&3)
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(r1, 1);
			assert.strictEqual(r2, 2);
			assert.strictEqual(r3, 2);
		});

		test('should handle error in deduplicated waiting call', async () => {
			let executionCount = 0;

			class TestClass {
				@sequentialize()
				async method(shouldFail: boolean): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					if (shouldFail) {
						throw new Error('Test error');
					}
					return executionCount;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method(false); // Succeeds
			const p2 = instance.method(true); // Becomes waiting, will fail
			const p3 = instance.method(true); // Dedupes with p2, should also fail

			await p1; // Wait for first to complete

			// Both p2 and p3 should reject with the same error
			await assert.rejects(p2, /Test error/);
			await assert.rejects(p3, /Test error/);

			// Should execute 2 times (p1, then p2 shared by p2&p3)
			assert.strictEqual(executionCount, 2);
		});

		test('should handle null and undefined arguments', async () => {
			let executionCount = 0;

			class TestClass {
				@sequentialize()
				async method(value: string | null | undefined): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return executionCount;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method(null); // Execution 1 (runs immediately)
			const p2 = instance.method(null); // Execution 2 (chains, becomes waiting)
			const p3 = instance.method(undefined); // Dedupes with p2 (null and undefined both resolve to '')
			const p4 = instance.method('test'); // Execution 3 (different arg)

			const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);

			// Should execute 3 times (p1, p2 shared by p2&p3, p4)
			assert.strictEqual(executionCount, 3);

			assert.strictEqual(r1, 1);
			assert.strictEqual(r2, 2);
			assert.strictEqual(r3, 2);
			assert.strictEqual(r4, 3);
		});

		test('should support parallel queues with getQueueKey', async () => {
			let executionCount = 0;
			const executionOrder: string[] = [];

			class TestClass {
				@sequentialize({
					getQueueKey: (msg: { channel: string; id: string }) => msg.channel,
					getDedupingKey: (msg: { channel: string; id: string }) => msg.id,
				})
				async method(msg: { channel: string; id: string }): Promise<number> {
					const count = ++executionCount;
					executionOrder.push(`${msg.channel}:${msg.id}:start`);
					await new Promise(resolve => setTimeout(resolve, 10));
					executionOrder.push(`${msg.channel}:${msg.id}:end`);
					return count;
				}
			}

			const instance = new TestClass();

			// Queue A: 3 calls
			const p1 = instance.method({ channel: 'A', id: '1' }); // Queue A, runs immediately
			const p2 = instance.method({ channel: 'A', id: '1' }); // Queue A, chains, becomes waiting
			const p3 = instance.method({ channel: 'A', id: '1' }); // Queue A, dedupes with p2

			// Queue B: 2 calls (runs in parallel with Queue A)
			const p4 = instance.method({ channel: 'B', id: '1' }); // Queue B, runs immediately
			const p5 = instance.method({ channel: 'B', id: '2' }); // Queue B, chains (different id)

			// Queue A: 1 more call
			const p6 = instance.method({ channel: 'A', id: '2' }); // Queue A, chains (different id)

			const results = await Promise.all([p1, p2, p3, p4, p5, p6]);

			// Should execute 5 times total (p1, p2 shared by p2&p3, p4, p5, p6)
			assert.strictEqual(executionCount, 5);

			// p2 and p3 should share the same result (deduplicated)
			assert.strictEqual(results[1], results[2]);

			// Verify execution order shows parallel execution
			// Both queues should start before either finishes (parallel execution)
			const aStartIndex = executionOrder.indexOf('A:1:start');
			const bStartIndex = executionOrder.indexOf('B:1:start');
			const aEndIndex = executionOrder.indexOf('A:1:end');
			assert.ok(
				aStartIndex >= 0 && bStartIndex >= 0 && aEndIndex >= 0,
				`Missing expected execution markers in: ${executionOrder.join(', ')}`,
			);
			assert.ok(
				bStartIndex < aEndIndex,
				`Expected B to start before A ends (parallel), but order was: ${executionOrder.join(', ')}`,
			);

			// Verify sequential execution within each queue
			const a1Start = executionOrder.indexOf('A:1:start');
			const a1End = executionOrder.indexOf('A:1:end');
			const a2Start = executionOrder.indexOf('A:2:start');
			assert.ok(
				a1Start < a1End && a1End < a2Start,
				`Expected A:1 to complete before A:2 starts (sequential in queue), but order was: ${executionOrder.join(', ')}`,
			);

			const b1Start = executionOrder.indexOf('B:1:start');
			const b1End = executionOrder.indexOf('B:1:end');
			const b2Start = executionOrder.indexOf('B:2:start');
			assert.ok(
				b1Start < b1End && b1End < b2Start,
				`Expected B:1 to complete before B:2 starts (sequential in queue), but order was: ${executionOrder.join(', ')}`,
			);
		});

		test('sequentialize should work with multiple instances', async () => {
			let executionCount = 0;

			class TestClass {
				@sequentialize()
				async method(value: string): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return executionCount;
				}
			}

			const instance1 = new TestClass();
			const instance2 = new TestClass();

			// Calls on different instances should not interfere
			const p1 = instance1.method('test');
			const p2 = instance2.method('test');
			const p3 = instance1.method('test');

			await Promise.all([p1, p2, p3]);

			// Should execute 3 times (instance1: 2 sequential, instance2: 1)
			assert.strictEqual(executionCount, 3);
		});
	});

	suite('gate', () => {
		test('should deduplicate concurrent calls with same arguments', async () => {
			let executionCount = 0;

			class TestClass {
				@gate()
				async method(value: string): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 50));
					return executionCount;
				}
			}

			const instance = new TestClass();

			// All three calls happen concurrently with same args
			const p1 = instance.method('test');
			const p2 = instance.method('test');
			const p3 = instance.method('test');

			const results = await Promise.all([p1, p2, p3]);

			// Should only execute once
			assert.strictEqual(executionCount, 1);
			// All should get the same result
			assert.strictEqual(results[0], 1);
			assert.strictEqual(results[1], 1);
			assert.strictEqual(results[2], 1);
		});

		test('should not deduplicate calls with different arguments', async () => {
			let executionCount = 0;

			class TestClass {
				@gate()
				async method(value: string): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return executionCount;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method('a');
			const p2 = instance.method('b');
			const p3 = instance.method('c');

			await Promise.all([p1, p2, p3]);

			// Should execute three times (different args)
			assert.strictEqual(executionCount, 3);
		});

		test('should allow new calls after promise resolves', async () => {
			let executionCount = 0;

			class TestClass {
				@gate()
				async method(value: string): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return executionCount;
				}
			}

			const instance = new TestClass();

			const result1 = await instance.method('test');
			const result2 = await instance.method('test');

			// Should execute twice (sequential, not concurrent)
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 2);
		});

		test('should work with custom resolver', async () => {
			let executionCount = 0;
			const executionOrder: string[] = [];

			class TestClass {
				@gate((obj: { id: number }) => obj.id.toString())
				async method(obj: { id: number; data: string }): Promise<number> {
					const count = ++executionCount;
					executionOrder.push(`${obj.id}:start`);
					await new Promise(resolve => setTimeout(resolve, 10));
					executionOrder.push(`${obj.id}:end`);
					return count;
				}
			}

			const instance = new TestClass();

			// Start all three calls at the same time
			const p1 = instance.method({ id: 1, data: 'a' });
			const p2 = instance.method({ id: 1, data: 'b' }); // Same id, should dedupe
			const p3 = instance.method({ id: 2, data: 'a' }); // Different id, runs in parallel

			const results = await Promise.all([p1, p2, p3]);

			// Should execute twice (p1&p2 share, p3 runs in parallel)
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(results[0], results[1]); // p1 and p2 share result
			assert.notStrictEqual(results[0], results[2]); // p3 has different result

			// Verify parallel execution: both should start before either finishes
			const id1Start = executionOrder.indexOf('1:start');
			const id2Start = executionOrder.indexOf('2:start');
			const id1End = executionOrder.indexOf('1:end');
			assert.ok(
				id1Start >= 0 && id2Start >= 0 && id1End >= 0,
				`Missing expected execution markers in: ${executionOrder.join(', ')}`,
			);
			assert.ok(
				id2Start < id1End,
				`Expected id:2 to start before id:1 ends (parallel), but order was: ${executionOrder.join(', ')}`,
			);
		});

		test('should handle non-promise return values', () => {
			let executionCount = 0;

			class TestClass {
				@gate()
				method(value: string): number {
					executionCount++;
					return executionCount;
				}
			}

			const instance = new TestClass();

			const result1 = instance.method('test');
			const result2 = instance.method('test');

			// Non-promise values should not be gated
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 2);
		});

		test('should handle errors in gated calls', async () => {
			let executionCount = 0;

			class TestClass {
				@gate()
				async method(shouldFail: boolean): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					if (shouldFail) {
						throw new Error('Test error');
					}
					return executionCount;
				}
			}

			const instance = new TestClass();

			const p1 = instance.method(true);
			const p2 = instance.method(true); // Should share the same error

			await assert.rejects(p1, /Test error/);
			await assert.rejects(p2, /Test error/);

			// Should only execute once (both share the same promise)
			assert.strictEqual(executionCount, 1);

			// After error, new calls should work
			const result = await instance.method(false);
			assert.strictEqual(result, 2);
		});

		test('gate should work with multiple instances', async () => {
			let executionCount = 0;

			class TestClass {
				@gate()
				async method(value: string): Promise<number> {
					const count = ++executionCount;
					await new Promise(resolve => setTimeout(resolve, 50));
					return count;
				}
			}

			const instance1 = new TestClass();
			const instance2 = new TestClass();

			// Concurrent calls on different instances should not deduplicate
			const start = Date.now();
			const p1 = instance1.method('test');
			const p2 = instance2.method('test');
			const p3 = instance1.method('test'); // Should dedupe with p1

			const results = await Promise.all([p1, p2, p3]);
			const totalTime = Date.now() - start;

			// Should execute 2 times (instance1: 1, instance2: 1)
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(results[0], results[2]); // p1 and p3 share result
			assert.notStrictEqual(results[0], results[1]); // p1 and p2 different
			// Should run in parallel (total time should be ~50ms, not ~100ms)
			assert.ok(totalTime < 80, `Expected parallel execution (~50ms), but took ${totalTime}ms`);
		});
	});

	suite('memoize', () => {
		test('should cache results for same arguments', () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				method(value: string): number {
					executionCount++;
					return executionCount;
				}
			}

			const instance = new TestClass();

			const result1 = instance.method('test');
			const result2 = instance.method('test');
			const result3 = instance.method('test');

			// Should only execute once
			assert.strictEqual(executionCount, 1);
			// All results should be the same
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 1);
			assert.strictEqual(result3, 1);
		});

		test('should not cache results for different arguments', () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				method(value: string): number {
					executionCount++;
					return executionCount;
				}
			}

			const instance = new TestClass();

			const result1 = instance.method('a');
			const result2 = instance.method('b');
			const result3 = instance.method('c');

			// Should execute three times
			assert.strictEqual(executionCount, 3);
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 2);
			assert.strictEqual(result3, 3);
		});

		test('should work with custom resolver', () => {
			let executionCount = 0;

			class TestClass {
				@memoize((obj: { id: number }) => obj.id.toString())
				method(obj: { id: number; data: string }): number {
					executionCount++;
					return executionCount;
				}
			}

			const instance = new TestClass();

			const result1 = instance.method({ id: 1, data: 'a' });
			const result2 = instance.method({ id: 1, data: 'b' }); // Same id, should use cache
			const result3 = instance.method({ id: 2, data: 'a' }); // Different id, new execution

			// Should execute twice
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 1); // Cached
			assert.strictEqual(result3, 2);
		});

		test('should cache per instance', () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				method(value: string): number {
					executionCount++;
					return executionCount;
				}
			}

			const instance1 = new TestClass();
			const instance2 = new TestClass();

			const result1 = instance1.method('test');
			const result2 = instance2.method('test');
			const result3 = instance1.method('test'); // Should use cache from instance1

			// Should execute twice (once per instance)
			assert.strictEqual(executionCount, 2);
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 2);
			assert.strictEqual(result3, 1); // Cached from instance1
		});

		test('should work with getters', () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				get value(): number {
					executionCount++;
					return executionCount;
				}
			}

			const instance = new TestClass();

			const result1 = instance.value;
			const result2 = instance.value;
			const result3 = instance.value;

			// Should only execute once
			assert.strictEqual(executionCount, 1);
			assert.strictEqual(result1, 1);
			assert.strictEqual(result2, 1);
			assert.strictEqual(result3, 1);
		});

		test('should cache complex return values', () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				method(value: string): { count: number; value: string } {
					executionCount++;
					return { count: executionCount, value: value };
				}
			}

			const instance = new TestClass();

			const result1 = instance.method('test');
			const result2 = instance.method('test');

			// Should only execute once
			assert.strictEqual(executionCount, 1);
			// Should return the exact same object reference
			assert.strictEqual(result1, result2);
			assert.strictEqual(result1.count, 1);
		});

		test('should work with async functions', async () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				async method(value: string): Promise<number> {
					executionCount++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return executionCount;
				}
			}

			const instance = new TestClass();

			// First call creates and caches the promise
			const p1 = instance.method('test');
			// Second call should return the same cached promise
			const p2 = instance.method('test');

			// Should be the same promise reference
			assert.strictEqual(p1, p2);

			const results = await Promise.all([p1, p2]);

			// Should only execute once
			assert.strictEqual(executionCount, 1);
			assert.strictEqual(results[0], 1);
			assert.strictEqual(results[1], 1);
		});

		test('should NOT cache errors', () => {
			let executionCount = 0;

			class TestClass {
				@memoize()
				method(shouldFail: boolean): number {
					executionCount++;
					if (shouldFail) {
						throw new Error('Test error');
					}
					return executionCount;
				}
			}

			const instance = new TestClass();

			// First call throws
			assert.throws(() => instance.method(true), /Test error/);
			assert.strictEqual(executionCount, 1);

			// Second call with same args should execute again (error not cached)
			assert.throws(() => instance.method(true), /Test error/);
			assert.strictEqual(executionCount, 2);

			// Successful call should cache
			const result1 = instance.method(false);
			const result2 = instance.method(false);
			assert.strictEqual(executionCount, 3); // Only one more execution
			assert.strictEqual(result1, result2);
		});
	});
});
