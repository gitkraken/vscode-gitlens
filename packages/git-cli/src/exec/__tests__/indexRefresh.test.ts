import * as assert from 'assert';
import type { GitRunOptions } from '@gitlens/git/run.types.js';
import type { Git } from '../git.js';
import { IndexRefresher, indexRefreshTimeoutMs } from '../indexRefresh.js';

interface Timer {
	fn: () => void;
	ms: number;
	cancelled: boolean;
}

/** A clock that moves only when the test fires a timer, and the timers it was asked for */
function fakeClock(startMs: number) {
	let current = startMs;
	const timers: Timer[] = [];
	return {
		now: () => current,
		setTimer: (fn: () => void, ms: number) => {
			const timer: Timer = { fn: fn, ms: ms, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		timers: timers,
		/** Moves the clock to `atMs` and fires the oldest timer still waiting */
		fire: function (atMs: number) {
			current = atMs;
			timers.find(t => !t.cancelled)?.fn();
			timers.shift();
		},
	};
}

type Run = { options: GitRunOptions; args: readonly string[] };

/** A `git` whose runs are held until the test releases them */
function heldGit(failWith?: Error) {
	const runs: Run[] = [];
	const releases: (() => void)[] = [];
	const git = {
		run: (options: GitRunOptions, ...args: string[]) => {
			runs.push({ options: options, args: args });
			if (failWith != null) return Promise.reject(failWith);

			return new Promise(resolve => {
				releases.push(() => resolve({ stdout: '', exitCode: 0, completion: { status: 'exited', code: 0 } }));
			});
		},
	} as unknown as Pick<Git, 'run'>;
	return { git: git, runs: runs, releases: releases };
}

async function flush(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await Promise.resolve();
	}
}

suite('IndexRefresher', () => {
	/** The clock is past the index file's second, so a refresh starts its status at once */
	const settled = { now: () => 20_000, statIndexMtimeMs: async () => 10_100 };

	test('runs a status that may take the index lock briefly, uncapped, over the inherited environment', async () => {
		const { git, runs, releases } = heldGit();
		const refresher = new IndexRefresher({ git: git, ...settled });

		refresher.schedule('/wt');
		await flush();

		assert.strictEqual(runs.length, 1);
		assert.strictEqual(runs[0].options.cwd, '/wt');
		assert.strictEqual(runs[0].options.timeout, indexRefreshTimeoutMs);
		assert.strictEqual(runs[0].options.errors, 'ignore');
		assert.deepStrictEqual(runs[0].options.env, { GIT_OPTIONAL_LOCKS: '1' });
		assert.deepStrictEqual(runs[0].options.configs, ['-c', 'color.status=false', '-c', 'status.renames=false']);
		assert.deepStrictEqual(runs[0].args, ['status', '--porcelain', '-uno', '--ignore-submodules=all']);

		releases.shift()?.();
		await refresher.pending('/wt');
	});

	test('waits for the second after the index file before running', async () => {
		const { git, runs, releases } = heldGit();
		const clock = fakeClock(10_200);
		const refresher = new IndexRefresher({
			git: git,
			now: clock.now,
			setTimer: clock.setTimer,
			statIndexMtimeMs: async () => 10_100,
		});

		refresher.schedule('/wt');
		await flush();

		assert.deepStrictEqual(
			clock.timers.map(t => t.ms),
			[800],
		);
		assert.strictEqual(runs.length, 0);

		clock.fire(11_000);
		await flush();
		assert.strictEqual(runs.length, 1);

		releases.shift()?.();
		await refresher.pending('/wt');
	});

	test('waits again when the timer fires before the second has begun', async () => {
		const { git, runs, releases } = heldGit();
		const clock = fakeClock(10_200);
		const refresher = new IndexRefresher({
			git: git,
			now: clock.now,
			setTimer: clock.setTimer,
			statIndexMtimeMs: async () => 10_100,
		});

		refresher.schedule('/wt');
		await flush();
		clock.fire(10_999);
		await flush();

		assert.strictEqual(runs.length, 0);
		assert.deepStrictEqual(
			clock.timers.map(t => t.ms),
			[1],
		);

		clock.fire(11_000);
		await flush();
		assert.strictEqual(runs.length, 1);

		releases.shift()?.();
		await refresher.pending('/wt');
	});

	test('waits no longer than the rest of the index second when the index is stamped ahead of the clock', async () => {
		const { git, runs, releases } = heldGit();
		// The file system's clock is 40 seconds ahead of this one
		const clock = fakeClock(10_000);
		const refresher = new IndexRefresher({
			git: git,
			now: clock.now,
			setTimer: clock.setTimer,
			statIndexMtimeMs: async () => 50_100,
		});

		refresher.schedule('/wt');
		await flush();

		assert.deepStrictEqual(
			clock.timers.map(t => t.ms),
			[900],
		);

		clock.fire(10_900);
		await flush();
		assert.strictEqual(runs.length, 1);

		releases.shift()?.();
		await refresher.pending('/wt');
	});

	test('stats and runs in the checkout as it was given, keying it by its normalized path', async () => {
		const { git, runs, releases } = heldGit();
		const stats: string[] = [];
		const refresher = new IndexRefresher({
			git: git,
			now: () => 20_000,
			statIndexMtimeMs: async path => {
				stats.push(path);
				return 10_100;
			},
		});

		refresher.schedule('/wt/');
		refresher.schedule('/wt');
		await flush();

		// Again for the schedule that joined it, which may have rewritten the index after the first stat read it
		assert.deepStrictEqual(stats, ['/wt/', '/wt/']);
		assert.strictEqual(runs.length, 1);
		assert.strictEqual(runs[0].options.cwd, '/wt/');
		assert.ok(refresher.pending('/wt'));

		releases.shift()?.();
		await refresher.pending('/wt');
	});

	test('joins a schedule that arrives while it is still waiting for the clock', async () => {
		const { git, runs, releases } = heldGit();
		const clock = fakeClock(10_200);
		const refresher = new IndexRefresher({
			git: git,
			now: clock.now,
			setTimer: clock.setTimer,
			statIndexMtimeMs: async () => 10_100,
		});

		refresher.schedule('/wt');
		refresher.schedule('/wt');
		await flush();
		clock.fire(11_000);
		await flush();
		releases.shift()?.();
		await refresher.pending('/wt');
		await flush();

		assert.strictEqual(runs.length, 1);
		assert.strictEqual(refresher.pending('/wt'), undefined);
	});

	test('waits again when a write that joined it stamped the index in a later second', async () => {
		const { git, runs, releases } = heldGit();
		const clock = fakeClock(10_200);
		let indexMtimeMs = 10_100;
		const refresher = new IndexRefresher({
			git: git,
			now: clock.now,
			setTimer: clock.setTimer,
			statIndexMtimeMs: async () => indexMtimeMs,
		});

		refresher.schedule('/wt');
		await flush();
		assert.deepStrictEqual(
			clock.timers.map(t => t.ms),
			[800],
		);

		// Another write lands in the second the refresh waited for, before its timer fires
		indexMtimeMs = 11_050;
		refresher.schedule('/wt');
		clock.fire(11_060);
		await flush();
		assert.strictEqual(runs.length, 0, 'a status now would leave that write racy');
		assert.deepStrictEqual(
			clock.timers.map(t => t.ms),
			[940],
		);

		clock.fire(12_000);
		await flush();
		assert.strictEqual(runs.length, 1);

		releases.shift()?.();
		await refresher.pending('/wt');
		await flush();
		assert.strictEqual(runs.length, 1);
	});

	test('runs exactly one more after the running one, however many schedules arrive meanwhile', async () => {
		const { git, runs, releases } = heldGit();
		const refresher = new IndexRefresher({ git: git, ...settled });

		refresher.schedule('/wt');
		await flush();
		assert.strictEqual(runs.length, 1);

		refresher.schedule('/wt');
		refresher.schedule('/wt');
		refresher.schedule('/wt');
		await flush();
		assert.strictEqual(runs.length, 1);

		releases.shift()?.();
		await flush();
		assert.strictEqual(runs.length, 2);
		assert.ok(refresher.pending('/wt'));

		releases.shift()?.();
		await refresher.pending('/wt');
		await flush();
		assert.strictEqual(runs.length, 2);
		assert.strictEqual(refresher.pending('/wt'), undefined);
	});

	test('keeps separate checkouts apart', async () => {
		const { git, runs, releases } = heldGit();
		const refresher = new IndexRefresher({ git: git, ...settled });

		refresher.schedule('/a');
		refresher.schedule('/b');
		await flush();

		assert.deepStrictEqual(runs.map(r => r.options.cwd).sort(), ['/a', '/b']);
		releases.splice(0).forEach(release => release());
		await refresher.pending('/a');
		await refresher.pending('/b');
	});

	test('does nothing for a checkout whose index cannot be read', async () => {
		const { git, runs } = heldGit();
		const refresher = new IndexRefresher({ git: git, now: () => 20_000, statIndexMtimeMs: async () => undefined });

		refresher.schedule('/gone');
		await refresher.pending('/gone');

		assert.strictEqual(runs.length, 0);
		assert.strictEqual(refresher.pending('/gone'), undefined);
	});

	test('never throws, and clears the entry, when the status fails or the stat throws', async () => {
		const failing = heldGit(new Error('spawn failed'));
		const a = new IndexRefresher({ git: failing.git, ...settled });
		assert.doesNotThrow(() => a.schedule('/wt'));
		await a.pending('/wt');
		assert.strictEqual(a.pending('/wt'), undefined);

		const b = new IndexRefresher({
			git: heldGit().git,
			now: () => 20_000,
			statIndexMtimeMs: () => Promise.reject(new Error('stat failed')),
		});
		assert.doesNotThrow(() => b.schedule('/wt'));
		await b.pending('/wt');
		assert.strictEqual(b.pending('/wt'), undefined);
	});

	suite('dispose', () => {
		test('cancels a wait for the clock and spawns nothing', async () => {
			const { git, runs } = heldGit();
			const clock = fakeClock(10_200);
			const refresher = new IndexRefresher({
				git: git,
				now: clock.now,
				setTimer: clock.setTimer,
				statIndexMtimeMs: async () => 10_100,
			});

			refresher.schedule('/wt');
			await flush();
			const task = refresher.pending('/wt');
			assert.ok(task);

			refresher.dispose();
			await task;

			assert.ok(clock.timers[0].cancelled);
			assert.strictEqual(runs.length, 0);
			assert.strictEqual(refresher.pending('/wt'), undefined);
		});

		test('ignores a schedule that arrives afterwards', async () => {
			const { git, runs } = heldGit();
			const refresher = new IndexRefresher({ git: git, ...settled });

			refresher.dispose();
			refresher.schedule('/wt');
			await flush();

			assert.strictEqual(runs.length, 0);
			assert.strictEqual(refresher.pending('/wt'), undefined);
		});

		test('does not run the extra refresh a running one was owed', async () => {
			const { git, runs, releases } = heldGit();
			const refresher = new IndexRefresher({ git: git, ...settled });

			refresher.schedule('/wt');
			await flush();
			refresher.schedule('/wt');
			refresher.dispose();
			releases.shift()?.();
			await flush();

			assert.strictEqual(runs.length, 1);
		});
	});

	suite('refreshAfter', () => {
		/** The write began at 10_200 (second 10), so an index stamped at 10_100 predates it and one at 10_900 doesn't */
		function refresherWithIndexAt(indexMtimeMs: number | undefined) {
			const held = heldGit();
			const refresher = new IndexRefresher({
				git: held.git,
				afterWrites: true,
				now: () => 10_200,
				setTimer: () => () => {},
				statIndexMtimeMs: async () => indexMtimeMs,
			});
			return { refresher: refresher, ...held };
		}

		test('schedules once the write rewrote the index, and hands back its result', async () => {
			const { refresher } = refresherWithIndexAt(10_900);

			const result = await refresher.refreshAfter('/wt', async () => 'done');
			await flush();

			assert.strictEqual(result, 'done');
			assert.ok(refresher.pending('/wt'));
			refresher.dispose();
		});

		test('treats an index written earlier in the second the write began in as rewritten', async () => {
			const { refresher } = refresherWithIndexAt(10_000);

			await refresher.refreshAfter('/wt', async () => undefined);
			await flush();

			assert.ok(refresher.pending('/wt'));
			refresher.dispose();
		});

		test('schedules nothing when the write left the index as it was', async () => {
			const { refresher, runs } = refresherWithIndexAt(9_900);

			await refresher.refreshAfter('/wt', async () => undefined);
			await flush();

			assert.strictEqual(refresher.pending('/wt'), undefined);
			assert.strictEqual(runs.length, 0);
		});

		test('schedules nothing when there is no index', async () => {
			const { refresher } = refresherWithIndexAt(undefined);

			await refresher.refreshAfter('/wt', async () => undefined);
			await flush();

			assert.strictEqual(refresher.pending('/wt'), undefined);
		});

		test('only runs the write, without reading the index, unless refreshing after writes is on', async () => {
			const held = heldGit();
			let stats = 0;
			const refresher = new IndexRefresher({
				git: held.git,
				now: () => 10_200,
				setTimer: () => () => {},
				statIndexMtimeMs: async () => {
					stats++;
					return 10_900;
				},
			});

			const result = await refresher.refreshAfter('/wt', async () => 'done');
			await flush();

			assert.strictEqual(result, 'done');
			assert.strictEqual(stats, 0);
			assert.strictEqual(refresher.pending('/wt'), undefined);
			assert.strictEqual(held.runs.length, 0);
		});

		test('schedules once a write that failed had rewritten the index, and rethrows its error', async () => {
			const { refresher } = refresherWithIndexAt(10_900);
			const failure = new Error('merge stopped on conflicts');

			await assert.rejects(
				refresher.refreshAfter('/wt', async () => {
					throw failure;
				}),
				ex => ex === failure,
			);
			await flush();

			assert.ok(refresher.pending('/wt'));
			refresher.dispose();
		});

		test('schedules nothing and rethrows when the write fails and left the index as it was', async () => {
			const { refresher } = refresherWithIndexAt(9_900);

			await assert.rejects(
				refresher.refreshAfter('/wt', async () => {
					throw new Error('merge refused');
				}),
				/merge refused/,
			);
			await flush();

			assert.strictEqual(refresher.pending('/wt'), undefined);
		});

		test("rethrows the write's error when reading the index throws", async () => {
			const refresher = new IndexRefresher({
				git: heldGit().git,
				afterWrites: true,
				now: () => 10_200,
				setTimer: () => () => {},
				statIndexMtimeMs: () => Promise.reject(new Error('stat failed')),
			});

			await assert.rejects(
				refresher.refreshAfter('/wt', async () => {
					throw new Error('merge refused');
				}),
				/merge refused/,
			);
		});
	});
});
