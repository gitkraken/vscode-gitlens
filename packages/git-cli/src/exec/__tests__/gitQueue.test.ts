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
			const result = await queue.run('normal', async () => 42);
			assert.strictEqual(result, 42);
		});

		test('propagates errors from the executed function', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			await assert.rejects(
				queue.run('normal', async () => {
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
				queue.run('normal', async () => 'should not run'),
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
				const task = queue.run('normal', async () => {
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
			const blockerTask = queue.run('normal', async () => {
				await blocker.promise;
			});

			// Wait for the blocker to start
			await new Promise(r => setTimeout(r, 10));

			// Queue tasks at different priorities (they'll all wait)
			const bgTask = queue.run('background', async () => {
				order.push('background');
			});
			const normalTask = queue.run('normal', async () => {
				order.push('normal');
			});
			const interactiveTask = queue.run('interactive', async () => {
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
				void queue.run('normal', () => d.promise);
			}

			await new Promise(r => setTimeout(r, 10));

			// At capacity: interactive should still be able to burst
			let interactiveRan = false;
			const interactiveDeferred = deferred();
			const interactiveTask = queue.run('interactive', async () => {
				interactiveRan = true;
				await interactiveDeferred.promise;
			});

			await new Promise(r => setTimeout(r, 10));
			assert.ok(interactiveRan, 'Interactive task should have started despite being at maxConcurrent');

			// A second interactive burst slot should also work (burst capacity = 2)
			let secondInteractiveRan = false;
			const secondDeferred = deferred();
			const secondTask = queue.run('interactive', async () => {
				secondInteractiveRan = true;
				await secondDeferred.promise;
			});

			await new Promise(r => setTimeout(r, 10));
			assert.ok(secondInteractiveRan, 'Second interactive burst should have started');

			// But normal should be queued (not running)
			let normalRan = false;
			const normalTask = queue.run('normal', async () => {
				normalRan = true;
			});

			await new Promise(r => setTimeout(r, 10));
			assert.ok(!normalRan, 'Normal task should be queued when at burst capacity');

			// Clean up
			for (const d of deferreds) {
				d.resolve();
			}
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
			void queue.run('normal', () => blocker.promise);

			await new Promise(r => setTimeout(r, 10));

			// Fill the queue to its depth limit
			void queue.run('normal', async () => {});
			void queue.run('normal', async () => {});

			// The next one should be rejected
			await assert.rejects(
				queue.run('normal', async () => {}),
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
			void queue.run('normal', () => blocker.promise);

			await new Promise(r => setTimeout(r, 10));

			// Queue some tasks
			const task1 = queue.run('normal', async () => 'task1');
			const task2 = queue.run('background', async () => 'task2');

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
			void queue.run('normal', () => blocker.promise);

			await new Promise(r => setTimeout(r, 10));

			// Queue normal and background tasks (they must wait)
			void queue.run('normal', async () => {});
			void queue.run('background', async () => {});

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

	suite('cancellation', () => {
		test('rejects immediately when signal is already aborted', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			const controller = new AbortController();
			controller.abort(new Error('pre-aborted'));

			let ran = false;
			await assert.rejects(
				queue.run(
					'normal',
					async () => {
						ran = true;
					},
					controller.signal,
				),
				(err: Error) => {
					assert.strictEqual(err.message, 'pre-aborted');
					return true;
				},
			);
			assert.strictEqual(ran, false, 'fn must not run when signal is pre-aborted');
		});

		test('removes a queued command when its signal aborts before it runs', async () => {
			const queue = new GitQueue({ maxConcurrent: 1 });

			// Saturate the single slot with a blocking task
			const blocker = deferred();
			void queue.run('normal', () => blocker.promise);
			await new Promise(r => setTimeout(r, 10));

			// Queue a task with an abortable signal
			const controller = new AbortController();
			let ran = false;
			const queuedTask = queue.run(
				'normal',
				async () => {
					ran = true;
				},
				controller.signal,
			);

			// Confirm it's queued
			assert.strictEqual(queue.getStats().queued.normal, 1);

			// Abort while still queued
			controller.abort(new Error('cancelled'));

			await assert.rejects(queuedTask, (err: Error) => {
				assert.strictEqual(err.message, 'cancelled');
				return true;
			});
			assert.strictEqual(ran, false, 'aborted queued task must never run');
			assert.strictEqual(queue.getStats().queued.normal, 0, 'aborted task must be removed from queue');

			blocker.resolve();
			await new Promise(r => setTimeout(r, 10));
		});

		test('does not interrupt a running task when its signal aborts mid-flight', async () => {
			const queue = new GitQueue({ maxConcurrent: 2 });
			const controller = new AbortController();

			// Task starts running immediately (capacity available)
			const taskDeferred = deferred();
			let ran = false;
			let aborted = false;
			const task = queue.run(
				'normal',
				async () => {
					ran = true;
					await taskDeferred.promise;
					return 'done';
				},
				controller.signal,
			);

			// Wait for task to start
			await new Promise(r => setTimeout(r, 10));
			assert.strictEqual(ran, true);

			// Abort once the task is running — the queue must not interrupt it
			// (in-flight cancellation is the running operation's responsibility).
			controller.abort();
			try {
				taskDeferred.resolve();
				const result = await task;
				assert.strictEqual(result, 'done');
			} catch {
				aborted = true;
			}
			assert.strictEqual(aborted, false, 'queue must not abort a task that is already running');
		});

		test('aborting one queued command does not affect siblings', async () => {
			const queue = new GitQueue({ maxConcurrent: 1 });

			const blocker = deferred();
			void queue.run('normal', () => blocker.promise);
			await new Promise(r => setTimeout(r, 10));

			const controllerA = new AbortController();
			const controllerB = new AbortController();
			let aRan = false;
			let bRan = false;

			const taskA = queue.run(
				'normal',
				async () => {
					aRan = true;
				},
				controllerA.signal,
			);
			const taskB = queue.run(
				'normal',
				async () => {
					bRan = true;
				},
				controllerB.signal,
			);

			assert.strictEqual(queue.getStats().queued.normal, 2);

			// Abort only A
			controllerA.abort(new Error('only A'));
			await assert.rejects(taskA);
			assert.strictEqual(queue.getStats().queued.normal, 1, 'B must remain queued');

			blocker.resolve();
			await taskB;
			assert.strictEqual(aRan, false);
			assert.strictEqual(bRan, true);
		});

		test('abort listener is detached when a task starts running', async () => {
			// Sanity check: aborting *after* a task has already dequeued and started running
			// must not throw or interfere with completion.
			const queue = new GitQueue({ maxConcurrent: 2 });
			const controller = new AbortController();
			const taskDeferred = deferred();

			const task = queue.run(
				'normal',
				async () => {
					await taskDeferred.promise;
					return 'completed';
				},
				controller.signal,
			);

			// Wait for it to start
			await new Promise(r => setTimeout(r, 10));

			// Abort after it has dequeued — the listener must already be removed,
			// so the queue takes no action; the task completes normally.
			controller.abort();
			taskDeferred.resolve();

			const result = await task;
			assert.strictEqual(result, 'completed');
		});
	});
});

suite('inferGitCommandPriority() Test Suite', () => {
	test('log is normal priority (polymorphic — heavy callers must tag explicitly)', () => {
		assert.strictEqual(inferGitCommandPriority(['log', '--oneline']), 'normal');
		assert.strictEqual(inferGitCommandPriority(['log']), 'normal');
		assert.strictEqual(inferGitCommandPriority(['log', '-1']), 'normal');
		assert.strictEqual(inferGitCommandPriority(['log', '--all', '--graph']), 'normal');
	});

	test('rev-list is normal priority (polymorphic — heavy callers must tag explicitly)', () => {
		assert.strictEqual(inferGitCommandPriority(['rev-list', '--count', 'HEAD']), 'normal');
		assert.strictEqual(inferGitCommandPriority(['rev-list', 'HEAD']), 'normal');
		assert.strictEqual(inferGitCommandPriority(['rev-list', '-1', 'HEAD']), 'normal');
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

	test('name-rev is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['name-rev', '--name-only', 'HEAD']), 'background');
	});

	test('describe is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['describe', '--tags']), 'background');
	});

	test('cherry is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['cherry', 'main']), 'background');
	});

	test('count-objects is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['count-objects', '-v']), 'background');
	});

	test('fsck is background priority', () => {
		assert.strictEqual(inferGitCommandPriority(['fsck']), 'background');
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

	test('merge-base is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['merge-base', 'A', 'B']), 'normal');
	});

	test('blame is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['blame', 'file.ts']), 'normal');
	});

	test('ls-files is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['ls-files']), 'normal');
	});

	test('diff is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['diff', 'HEAD']), 'normal');
	});

	test('show is normal priority', () => {
		assert.strictEqual(inferGitCommandPriority(['show', 'HEAD']), 'normal');
	});

	test('skips -c flag and its value arg to find the real command', () => {
		// -c key=value is a git global option; the value arg must be skipped
		assert.strictEqual(
			inferGitCommandPriority(['-c', 'color.ui=false', '-c', 'core.quotepath=false', 'for-each-ref']),
			'background',
		);
		assert.strictEqual(inferGitCommandPriority(['-c', 'gc.auto=0', 'shortlog']), 'background');
		assert.strictEqual(inferGitCommandPriority(['-c', 'merge.autoStash=true', 'push', 'origin']), 'normal');
	});

	test('skips -C flag and its value arg to find the real command', () => {
		// -C <path> changes the working directory
		assert.strictEqual(inferGitCommandPriority(['-C', '/some/path', 'shortlog']), 'background');
	});

	test('skips --work-tree, --git-dir, --namespace, --super-prefix and their value args', () => {
		// Separated forms of git global options must consume the next positional as their value
		assert.strictEqual(inferGitCommandPriority(['--work-tree', '/x', 'shortlog']), 'background');
		assert.strictEqual(inferGitCommandPriority(['--git-dir', '/x.git', 'reflog']), 'background');
		assert.strictEqual(inferGitCommandPriority(['--namespace', 'foo', 'for-each-ref']), 'background');
		assert.strictEqual(inferGitCommandPriority(['--super-prefix', 'sub/', 'name-rev', 'HEAD']), 'background');
	});

	test('handles =-form global options without consuming an extra arg', () => {
		// --name=value is a single token; the leading-dash skip covers it
		assert.strictEqual(inferGitCommandPriority(['--exec-path=/usr/libexec', 'fsck']), 'background');
		assert.strictEqual(inferGitCommandPriority(['--git-dir=/x.git', 'reflog']), 'background');
	});

	test('does not consume a value-taking option’s value if it looks like another flag', () => {
		// peek rule: only consume next arg if it doesn't start with '-'
		// Here '--foo' is treated as a flag of its own, and the next positional ('shortlog') is the command
		assert.strictEqual(inferGitCommandPriority(['-c', '--foo', 'shortlog']), 'background');
	});

	test('skips flag-only leading args', () => {
		// '--no-pager' starts with '-' so is skipped, 'shortlog' is the command
		assert.strictEqual(inferGitCommandPriority(['--no-pager', 'shortlog', '-sn']), 'background');
	});

	test('skips undefined args', () => {
		assert.strictEqual(inferGitCommandPriority([undefined, 'shortlog']), 'background');
	});

	test('handles dangling value-taking option at end of args', () => {
		// The command was found before the dangling '-c'; result is still its priority
		assert.strictEqual(inferGitCommandPriority(['shortlog', '-c']), 'background');
	});

	test('returns normal for empty args', () => {
		assert.strictEqual(inferGitCommandPriority([]), 'normal');
	});
});
