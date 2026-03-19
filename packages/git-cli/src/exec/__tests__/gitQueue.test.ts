import * as assert from 'assert';
import { GitQueue, inferGitCommandPriority } from '../gitQueue.js';

function deferred() {
	let resolve!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

suite('GitQueue Test Suite', () => {
	suite('execute()', () => {
		test('runs a function and returns its result', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			const result = await queue.execute('normal', async () => 42);
			assert.strictEqual(result, 42);
		});

		test('propagates errors from the executed function', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			await assert.rejects(
				queue.execute('normal', async () => {
					throw new Error('boom');
				}),
				(err: Error) => {
					assert.strictEqual(err.message, 'boom');
					return true;
				},
			);
		});

		test('rejects immediately when disposed', async () => {
			const queue = new GitQueue();
			queue.dispose();
			await assert.rejects(
				queue.execute('normal', async () => 'should not run'),
				(err: Error) => {
					assert.ok(err.message.includes('disposed'));
					return true;
				},
			);
		});
	});

	suite('concurrency limit', () => {
		test('limits concurrent execution to maxConcurrent', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			let running = 0;
			let maxRunning = 0;

			const tasks = Array.from({ length: 5 }, () => {
				const d = deferred();
				const task = queue.execute('normal', async () => {
					running++;
					maxRunning = Math.max(maxRunning, running);
					await d.promise;
					running--;
				});
				return { task: task, d: d };
			});

			// Let microtasks settle so all tasks are queued
			await new Promise(r => setTimeout(r, 10));

			assert.strictEqual(maxRunning, 2, 'At most 2 tasks should run concurrently');

			// Resolve all tasks
			for (const { d } of tasks) {
				d.resolve();
			}
			await Promise.all(tasks.map(t => t.task));
		});

		test('uses default maxConcurrent of 7 when not configured', () => {
			const queue = new GitQueue();
			const stats = queue.getStats();
			assert.strictEqual(stats.maxConcurrent, 7);
		});
	});

	suite('priority ordering', () => {
		test('interactive priority runs before normal and background', async () => {
			const queue = new GitQueue({ maxConcurrent: 1 });
			const order: string[] = [];

			// Fill the single slot
			const blocker = deferred();
			const blockerTask = queue.execute('normal', async () => {
				await blocker.promise;
			});

			// Wait for the blocker to start
			await new Promise(r => setTimeout(r, 10));

			// Queue tasks at different priorities (they'll all wait)
			const bgTask = queue.execute('background', async () => {
				order.push('background');
			});
			const normalTask = queue.execute('normal', async () => {
				order.push('normal');
			});
			const interactiveTask = queue.execute('interactive', async () => {
				order.push('interactive');
			});

			// Release the blocker
			blocker.resolve();
			await Promise.all([blockerTask, bgTask, normalTask, interactiveTask]);

			assert.strictEqual(order[0], 'interactive', 'Interactive should run first');
			assert.strictEqual(order[1], 'normal', 'Normal should run second');
			assert.strictEqual(order[2], 'background', 'Background should run last');
		});
	});

	suite('interactive burst capacity', () => {
		test('interactive can exceed maxConcurrent by burst capacity', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			const deferreds: ReturnType<typeof deferred>[] = [];

			// Fill both normal slots
			for (let i = 0; i < 2; i++) {
				const d = deferred();
				deferreds.push(d);
				void queue.execute('normal', () => d.promise);
			}

			await new Promise(r => setTimeout(r, 10));

			// At capacity: interactive should still be able to burst
			let interactiveRan = false;
			const interactiveDeferred = deferred();
			const interactiveTask = queue.execute('interactive', async () => {
				interactiveRan = true;
				await interactiveDeferred.promise;
			});

			await new Promise(r => setTimeout(r, 10));
			assert.ok(interactiveRan, 'Interactive task should have started despite being at maxConcurrent');

			// A second interactive burst slot should also work (burst capacity = 2)
			let secondInteractiveRan = false;
			const secondDeferred = deferred();
			const secondTask = queue.execute('interactive', async () => {
				secondInteractiveRan = true;
				await secondDeferred.promise;
			});

			await new Promise(r => setTimeout(r, 10));
			assert.ok(secondInteractiveRan, 'Second interactive burst should have started');

			// But normal should be queued (not running)
			let normalRan = false;
			const normalTask = queue.execute('normal', async () => {
				normalRan = true;
			});

			await new Promise(r => setTimeout(r, 10));
			assert.ok(!normalRan, 'Normal task should be queued when at burst capacity');

			// Clean up
			for (const d of deferreds) d.resolve();
			interactiveDeferred.resolve();
			secondDeferred.resolve();
			await Promise.all([interactiveTask, secondTask, normalTask]);
		});
	});

	suite('queue depth limit', () => {
		test('rejects when queue is full', async () => {
			const queue = new GitQueue({ maxConcurrent: 1, maxQueueDepth: 2 });

			// Fill the active slot
			const blocker = deferred();
			void queue.execute('normal', () => blocker.promise);

			await new Promise(r => setTimeout(r, 10));

			// Fill the queue to its depth limit
			void queue.execute('normal', async () => {});
			void queue.execute('normal', async () => {});

			// The next one should be rejected
			await assert.rejects(
				queue.execute('normal', async () => {}),
				(err: Error) => {
					assert.ok(err.message.includes('queue is full'));
					return true;
				},
			);

			blocker.resolve();
			await new Promise(r => setTimeout(r, 50));
		});
	});

	suite('dispose()', () => {
		test('rejects all queued commands', async () => {
			const queue = new GitQueue({ maxConcurrent: 1 });

			// Fill the active slot
			const blocker = deferred();
			void queue.execute('normal', () => blocker.promise);

			await new Promise(r => setTimeout(r, 10));

			// Queue some tasks
			const task1 = queue.execute('normal', async () => 'task1');
			const task2 = queue.execute('background', async () => 'task2');

			// Dispose should reject queued tasks
			queue.dispose();

			await assert.rejects(task1, (err: Error) => {
				assert.ok(err.message.includes('disposed'));
				return true;
			});

			await assert.rejects(task2, (err: Error) => {
				assert.ok(err.message.includes('disposed'));
				return true;
			});

			// Resolve the blocker so the active task completes
			blocker.resolve();
		});
	});

	suite('getStats()', () => {
		test('returns correct active and queued counts', async () => {
			const queue = new GitQueue({ maxConcurrent: 1 });

			// Fill the single slot with a blocking normal task
			const blocker = deferred();
			void queue.execute('normal', () => blocker.promise);

			await new Promise(r => setTimeout(r, 10));

			// Queue normal and background tasks (they must wait)
			void queue.execute('normal', async () => {});
			void queue.execute('background', async () => {});

			const stats = queue.getStats();
			// Only the blocker is active; normal and background are queued.
			// (interactive would burst, so we omit it to keep counts predictable.)
			assert.strictEqual(stats.active, 1);
			assert.strictEqual(stats.queued.interactive, 0);
			assert.strictEqual(stats.queued.normal, 1);
			assert.strictEqual(stats.queued.background, 1);
			assert.strictEqual(stats.maxConcurrent, 1);

			blocker.resolve();
			await new Promise(r => setTimeout(r, 50));
		});

		test('returns zeroes for an idle queue', () => {
			const queue = new GitQueue({ maxConcurrent: 3 });
			const stats = queue.getStats();
			assert.strictEqual(stats.active, 0);
			assert.strictEqual(stats.queued.interactive, 0);
			assert.strictEqual(stats.queued.normal, 0);
			assert.strictEqual(stats.queued.background, 0);
		});
	});

	suite('updateConfig()', () => {
		test('updates maxConcurrent', () => {
			const queue = new GitQueue({ maxConcurrent: 3 });
			assert.strictEqual(queue.getStats().maxConcurrent, 3);

			queue.updateConfig({ maxConcurrent: 10 });
			assert.strictEqual(queue.getStats().maxConcurrent, 10);
		});
	});
});

suite('inferGitCommandPriority() Test Suite', () => {
	test('log is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['log', '--oneline']), 'background');
	});

	test('rev-list is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['rev-list', '--count', 'HEAD']), 'background');
	});

	test('for-each-ref is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['for-each-ref', '--sort=-creatordate']), 'background');
	});

	test('shortlog is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['shortlog', '-sn']), 'background');
	});

	test('reflog is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['reflog', 'show']), 'background');
	});

	test('commit is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['commit', '-m', 'msg']), 'normal');
	});

	test('push is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['push', 'origin', 'main']), 'normal');
	});

	test('status is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['status', '--porcelain']), 'normal');
	});

	test('skips -c flag and its value arg to find the real command', () => {
		// -c key=value is a git global option; the value arg must be skipped
		assert.strictEqual(inferGitCommandPriority(['-c', 'gc.auto=0', 'log', '--oneline']), 'background');
		assert.strictEqual(
			inferGitCommandPriority(['-c', 'color.ui=false', '-c', 'core.quotepath=false', 'for-each-ref']),
			'background',
		);
		assert.strictEqual(inferGitCommandPriority(['-c', 'merge.autoStash=true', 'push', 'origin']), 'normal');
	});

	test('skips -C flag and its value arg to find the real command', () => {
		// -C <path> changes the working directory
		assert.strictEqual(inferGitCommandPriority(['-C', '/some/path', 'log', '--oneline']), 'background');
	});

	test('skips flag-only leading args', () => {
		// '--no-pager' starts with '-' so is skipped, 'log' is the command
		assert.strictEqual(inferGitCommandPriority(['--no-pager', 'log', '--oneline']), 'background');
	});

	test('skips undefined args', () => {
		assert.strictEqual(inferGitCommandPriority([undefined, 'log']), 'background');
	});

	test('returns normal for empty args', () => {
		assert.strictEqual(inferGitCommandPriority([]), 'normal');
	});
});
