import assert from 'node:assert';
import { afterEach, describe, it, mock } from 'node:test';
import { normalizePath } from '@gitlens/utils/path.js';
import type { GitDirProbe, PollTarget } from '../gitDirPoller.js';
import { GitDirPoller, GitDirProbeTarget } from '../gitDirPoller.js';
import type { FileWatchEvent } from '../provider.js';
import type { WatchPollingOptions } from '../watchService.js';

/** A filesystem of `mtime:size` readings keyed by POSIX path; a path set to `'throw'` fails its stat */
function createFakeStat(): {
	stat: WatchPollingOptions['stat'];
	files: Map<string, { mtime: number; size: number } | 'throw'>;
	reads: string[];
} {
	const files = new Map<string, { mtime: number; size: number } | 'throw'>();
	const reads: string[] = [];
	return {
		files: files,
		reads: reads,
		stat: function (path: string): Promise<{ mtime: number; size: number } | undefined> {
			const p = normalizePath(path);
			reads.push(p);
			const file = files.get(p);
			if (file === 'throw') return Promise.reject(new Error('EIO'));

			return Promise.resolve(file);
		},
	};
}

function createTarget(
	probes: () => Iterable<GitDirProbe>,
	probesByEmittedPath: ReadonlyMap<string, readonly string[]> = new Map(),
): {
	target: GitDirProbeTarget;
	fs: ReturnType<typeof createFakeStat>;
	moved: string[];
} {
	const fs = createFakeStat();
	const moved: string[] = [];
	const target = new GitDirProbeTarget(
		'/repo/.git',
		{ stat: fs.stat, invalidate: () => {} },
		probes,
		probesByEmittedPath,
		(event: FileWatchEvent) => moved.push(`${event.reason}:${normalizePath(event.path)}`),
	);
	return { target: target, fs: fs, moved: moved };
}

/** A poller gated by a host's `isActive` (always active unless given), whose timer never fires within a test */
function createPoller(options?: Partial<WatchPollingOptions>): GitDirPoller {
	return new GitDirPoller({
		stat: () => Promise.resolve(undefined),
		intervalMs: 60_000,
		activeCheckMs: 60_000,
		isActive: () => true,
		...options,
	});
}

describe('GitDirProbeTarget', () => {
	it('only records on the first poll', async () => {
		const { target, fs, moved } = createTarget(() => [{ path: 'HEAD' }, { path: 'index' }]);
		fs.files.set('/repo/.git/HEAD', { mtime: 1, size: 10 });
		fs.files.set('/repo/.git/index', { mtime: 1, size: 100 });

		await target.poll();

		assert.deepStrictEqual(moved, []);
		assert.deepStrictEqual(fs.reads.sort(), ['/repo/.git/HEAD', '/repo/.git/index']);
	});

	it('reports a probe whose mtime or size moved as a change of its path', async () => {
		const { target, fs, moved } = createTarget(() => [{ path: 'HEAD' }, { path: 'index' }, { path: 'config' }]);
		fs.files.set('/repo/.git/HEAD', { mtime: 1, size: 10 });
		fs.files.set('/repo/.git/index', { mtime: 1, size: 100 });
		fs.files.set('/repo/.git/config', { mtime: 1, size: 50 });
		await target.poll();

		fs.files.set('/repo/.git/HEAD', { mtime: 2, size: 10 });
		fs.files.set('/repo/.git/index', { mtime: 1, size: 101 });
		await target.poll();

		assert.deepStrictEqual(moved, ['change:/repo/.git/HEAD', 'change:/repo/.git/index']);

		moved.length = 0;
		await target.poll();
		assert.deepStrictEqual(moved, [], 'an unchanged reading is not reported again');
	});

	it('reports a move as each path the probe is emitted as', async () => {
		const { target, fs, moved } = createTarget(() => [
			{ path: 'FETCH_HEAD', emitAs: ['FETCH_HEAD', 'refs/remotes'] },
		]);
		fs.files.set('/repo/.git/FETCH_HEAD', { mtime: 1, size: 10 });
		await target.poll();

		fs.files.set('/repo/.git/FETCH_HEAD', { mtime: 2, size: 10 });
		await target.poll();

		assert.deepStrictEqual(moved, ['change:/repo/.git/FETCH_HEAD', 'change:/repo/.git/refs/remotes']);
	});

	it('reports a probe that was missing and is now present, and one that went missing', async () => {
		const { target, fs, moved } = createTarget(() => [{ path: 'MERGE_HEAD' }, { path: 'ORIG_HEAD' }]);
		fs.files.set('/repo/.git/ORIG_HEAD', { mtime: 1, size: 41 });
		await target.poll();

		fs.files.set('/repo/.git/MERGE_HEAD', { mtime: 2, size: 41 });
		fs.files.delete('/repo/.git/ORIG_HEAD');
		await target.poll();

		assert.deepStrictEqual(moved, ['change:/repo/.git/MERGE_HEAD', 'change:/repo/.git/ORIG_HEAD']);
	});

	it('only records a probe new to the set, and starts over for one that left it and came back', async () => {
		let probes: GitDirProbe[] = [{ path: 'refs/heads/main' }];
		const { target, fs, moved } = createTarget(() => probes);
		fs.files.set('/repo/.git/refs/heads/main', { mtime: 1, size: 41 });
		fs.files.set('/repo/.git/refs/heads/feature', { mtime: 1, size: 41 });
		await target.poll();

		probes = [{ path: 'refs/heads/feature' }];
		fs.files.set('/repo/.git/refs/heads/main', { mtime: 2, size: 41 });
		await target.poll();
		assert.deepStrictEqual(moved, [], 'a new probe only records');

		probes = [{ path: 'refs/heads/main' }];
		await target.poll();
		assert.deepStrictEqual(moved, [], 'a probe that left the set has no baseline to compare');
	});

	it('keeps the last reading when a stat throws, so it never counts as a move', async () => {
		const { target, fs, moved } = createTarget(() => [{ path: 'HEAD' }]);
		fs.files.set('/repo/.git/HEAD', { mtime: 1, size: 10 });
		await target.poll();

		fs.files.set('/repo/.git/HEAD', 'throw');
		await target.poll();
		assert.deepStrictEqual(moved, []);

		fs.files.set('/repo/.git/HEAD', { mtime: 1, size: 10 });
		await target.poll();
		assert.deepStrictEqual(moved, [], 'the reading before the failure still stands');

		fs.files.set('/repo/.git/HEAD', { mtime: 2, size: 10 });
		await target.poll();
		assert.deepStrictEqual(moved, ['change:/repo/.git/HEAD']);
	});

	it('records a path the watcher reported (and the directories above it) without reporting it again', async () => {
		const { target, fs, moved } = createTarget(() => [
			{ path: 'refs/heads/feature/x' },
			{ path: 'refs/heads/feature' },
			{ path: 'index' },
		]);
		fs.files.set('/repo/.git/refs/heads/feature/x', { mtime: 1, size: 41 });
		fs.files.set('/repo/.git/refs/heads/feature', { mtime: 1, size: 0 });
		fs.files.set('/repo/.git/index', { mtime: 1, size: 100 });
		await target.poll();

		fs.files.set('/repo/.git/refs/heads/feature/x', { mtime: 2, size: 41 });
		fs.files.set('/repo/.git/refs/heads/feature', { mtime: 2, size: 0 });
		fs.files.set('/repo/.git/index', { mtime: 2, size: 100 });
		target.forget('/repo/.git/refs/heads/feature/x.lock');
		await target.poll();

		assert.deepStrictEqual(moved, ['change:/repo/.git/index']);
	});

	it('records the probes emitted as a path the watcher reported, which the watcher itself never sees', async () => {
		let probeLists = 0;
		const { target, fs, moved } = createTarget(
			() => {
				probeLists++;
				return [{ path: 'logs/HEAD', emitAs: ['HEAD'] }, { path: 'index' }];
			},
			new Map([['HEAD', ['logs/HEAD']]]),
		);
		fs.files.set('/repo/.git/logs/HEAD', { mtime: 1, size: 10 });
		fs.files.set('/repo/.git/index', { mtime: 1, size: 100 });
		await target.poll();

		fs.files.set('/repo/.git/logs/HEAD', { mtime: 2, size: 20 });
		fs.files.set('/repo/.git/index', { mtime: 2, size: 100 });
		target.forget('/repo/.git/HEAD');
		target.forget('/repo/.git/refs/heads/main');
		assert.strictEqual(probeLists, 1, 'forgetting never lists the probes');
		await target.poll();

		assert.deepStrictEqual(moved, ['change:/repo/.git/index']);
	});

	it('records nothing the watcher reported while a poll was reading it, so the next poll does not report it', async () => {
		const { target, fs, moved } = createTarget(() => [{ path: 'refs/heads/main' }, { path: 'index' }]);
		fs.files.set('/repo/.git/refs/heads/main', { mtime: 1, size: 41 });
		fs.files.set('/repo/.git/index', { mtime: 1, size: 100 });
		await target.poll();

		// The poll reads the ref before the write lands; the watcher reports the write before the poll records
		const polling = target.poll();
		fs.files.set('/repo/.git/refs/heads/main', { mtime: 2, size: 41 });
		target.forget('/repo/.git/refs/heads/main');
		await polling;

		await target.poll();
		assert.deepStrictEqual(moved, []);

		fs.files.set('/repo/.git/refs/heads/main', { mtime: 3, size: 41 });
		await target.poll();
		assert.deepStrictEqual(moved, ['change:/repo/.git/refs/heads/main'], 'it is recorded again from the next poll');
	});
});

describe('GitDirPoller', () => {
	afterEach(() => {
		mock.restoreAll();
		mock.timers.reset();
	});

	function settle(): Promise<void> {
		return new Promise(resolve => setImmediate(resolve));
	}

	function countingTarget(): PollTarget & { polls: number } {
		const target = {
			polls: 0,
			poll: function (): Promise<void> {
				target.polls++;
				return Promise.resolve();
			},
		};
		return target;
	}

	it('reads a target soon after it is added, even while inactive', async () => {
		const poller = createPoller({ intervalMs: 60_000, isActive: () => false });
		const target = countingTarget();
		poller.add(target);
		assert.strictEqual(target.polls, 0, 'targets added together are read together');

		await settle();
		assert.strictEqual(target.polls, 1);
		poller.dispose();
	});

	it('reads at most 4 targets at once across first readings and a pass', async () => {
		const poller = createPoller({ intervalMs: 0 });
		const releases: (() => void)[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		let polls = 0;
		function poll(): Promise<void> {
			polls++;
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return new Promise(resolve =>
				releases.push(() => {
					inFlight--;
					resolve();
				}),
			);
		}
		for (let i = 0; i < 10; i++) {
			poller.add({ poll: poll });
		}
		await settle();
		assert.strictEqual(inFlight, 4, 'the first readings fill every slot');

		const pass = poller.tick();
		const busy = (): boolean => polls < 20 || inFlight > 0;
		while (busy()) {
			assert.ok(releases.length > 0, 'a read is in flight');
			for (const release of releases.splice(0)) {
				release();
			}
			await settle();
		}
		await pass;

		assert.strictEqual(maxInFlight, 4);
		assert.strictEqual(polls, 20, 'each first reading, then the pass');
		poller.dispose();
	});

	it('stats a path once per pass, however many targets probe it', async () => {
		const fs = createFakeStat();
		fs.files.set('/repo/.git/HEAD', { mtime: 1, size: 10 });
		fs.files.set('/repo/.git/config', { mtime: 1, size: 10 });
		const poller = createPoller({ stat: fs.stat, intervalMs: 0 });
		const moved: string[] = [];
		poller.add(
			new GitDirProbeTarget(
				'/repo/.git',
				poller,
				() => [{ path: 'HEAD' }, { path: 'config' }],
				new Map(),
				event => moved.push(`a:${normalizePath(event.path)}`),
			),
		);
		poller.add(
			new GitDirProbeTarget(
				'/repo/.git',
				poller,
				() => [{ path: 'config' }],
				new Map(),
				event => moved.push(`b:${normalizePath(event.path)}`),
			),
		);
		await settle();
		assert.deepStrictEqual(fs.reads.sort(), ['/repo/.git/HEAD', '/repo/.git/config']);

		fs.reads.length = 0;
		fs.files.set('/repo/.git/config', { mtime: 2, size: 10 });
		await poller.tick();
		assert.deepStrictEqual(fs.reads.sort(), ['/repo/.git/HEAD', '/repo/.git/config']);
		assert.deepStrictEqual(moved, ['a:/repo/.git/config', 'b:/repo/.git/config']);

		fs.reads.length = 0;
		await poller.tick();
		assert.deepStrictEqual(fs.reads.sort(), ['/repo/.git/HEAD', '/repo/.git/config'], 'each pass stats afresh');
		poller.dispose();
	});

	it('stats a path again for a target whose watcher reported it after another target statted it', async () => {
		const fs = createFakeStat();
		fs.files.set('/repo/.git/config', { mtime: 1, size: 10 });
		const poller = createPoller({ stat: fs.stat });
		let blocked = false;
		const releases: (() => void)[] = [];
		const block = (): Promise<void> =>
			blocked ? new Promise(resolve => releases.push(resolve)) : Promise.resolve();
		for (let i = 0; i < 3; i++) {
			poller.add({ poll: block });
		}
		const moved: string[] = [];
		const probes = (): GitDirProbe[] => [{ path: 'config' }];
		const a: GitDirProbeTarget = new GitDirProbeTarget('/repo/.git', poller, probes, new Map(), event =>
			moved.push(`a:${normalizePath(event.path)}`),
		);
		const b = new GitDirProbeTarget('/repo/.git', poller, probes, new Map(), event => {
			moved.push(`b:${normalizePath(event.path)}`);
			// Another write lands after `b` statted, and `a`'s watcher reports it before `a` (waiting for a slot) reads
			fs.files.set('/repo/.git/config', { mtime: 3, size: 10 });
			a.forget('/repo/.git/config');
		});
		poller.add(b);
		poller.add(a);
		await settle();

		blocked = true;
		fs.reads.length = 0;
		fs.files.set('/repo/.git/config', { mtime: 2, size: 10 });
		const pass = poller.tick();
		await settle();
		assert.strictEqual(fs.reads.length, 2, 'statted for `b`, then again for `a`');
		for (const release of releases.splice(0)) {
			release();
		}
		await pass;

		blocked = false;
		await poller.tick();
		assert.deepStrictEqual(moved, ['b:/repo/.git/config'], '`a` records the reading its watcher reported');
		poller.dispose();
	});

	it('never reads a target twice at once, reading it again once the read in flight ends', async () => {
		const poller = createPoller({ intervalMs: 0 });
		const releases: (() => void)[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		const target: PollTarget = {
			poll: function (): Promise<void> {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				return new Promise(resolve =>
					releases.push(() => {
						inFlight--;
						resolve();
					}),
				);
			},
		};
		poller.add(target);
		await settle();

		const pass = poller.tick();
		assert.strictEqual(releases.length, 1, 'the pass waits for the read of the add');

		releases[0]();
		await settle();
		assert.strictEqual(releases.length, 2);

		releases[1]();
		await pass;
		assert.strictEqual(maxInFlight, 1);

		poller.dispose();
	});

	it('runs a pass at the first look, then not again until the interval has gone by', async () => {
		const poller = createPoller({ intervalMs: 60_000 });
		const target = countingTarget();
		poller.add(target);
		await settle();

		await poller.tick();
		await poller.tick();
		assert.strictEqual(target.polls, 2, 'the read of the add, then one pass');

		poller.dispose();
	});

	it('runs a pass at every look once the interval has gone by', async () => {
		const poller = createPoller({ intervalMs: 0 });
		const target = countingTarget();
		poller.add(target);
		await settle();

		await poller.tick();
		await poller.tick();
		assert.strictEqual(target.polls, 3);

		poller.dispose();
	});

	it('skips while inactive, and runs a pass at the first look after becoming active', async () => {
		let active = false;
		const poller = createPoller({ intervalMs: 60_000, isActive: () => active });
		const target = countingTarget();
		poller.add(target);
		await settle();

		await poller.tick();
		assert.strictEqual(target.polls, 1, 'only the read of the add');

		active = true;
		await poller.tick();
		assert.strictEqual(target.polls, 2);

		active = false;
		await poller.tick();
		active = true;
		await poller.tick();
		assert.strictEqual(target.polls, 3, 'reactivating mid-interval runs a pass');

		poller.dispose();
	});

	it('runs a pass on a nudge, mid-interval', async () => {
		const poller = createPoller({ intervalMs: 60_000 });
		const target = countingTarget();
		poller.add(target);
		await settle();
		await poller.tick();

		poller.nudge();
		await poller.tick();
		assert.strictEqual(target.polls, 3);

		poller.dispose();
	});

	it('runs one pass at a time, and a nudge during one runs another after it', async () => {
		const poller = createPoller({ intervalMs: 0 });
		let release: (() => void) | undefined;
		let polls = 0;
		const target: PollTarget = {
			poll: function (): Promise<void> {
				polls++;
				return new Promise(resolve => (release = resolve));
			},
		};
		poller.add(target);
		await settle();
		release?.();
		await settle();

		const first = poller.tick();
		const second = poller.tick();
		assert.strictEqual(second, first, 'a look during a pass joins it');
		await settle();
		assert.strictEqual(polls, 2);

		poller.nudge();
		release?.();
		await first;
		await settle();
		assert.strictEqual(polls, 3);

		release?.();
		poller.dispose();
	});

	it('polls at most 4 targets at once in a pass', async () => {
		const poller = createPoller();
		let inFlight = 0;
		let maxInFlight = 0;
		async function poll(): Promise<void> {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await settle();
			inFlight--;
		}
		for (let i = 0; i < 6; i++) {
			poller.add({ poll: poll });
		}
		for (let i = 0; i < 4; i++) {
			await settle();
		}
		maxInFlight = 0;

		await poller.tick();

		assert.strictEqual(maxInFlight, 4);
		poller.dispose();
	});

	it('keeps polling the other targets when one rejects', async () => {
		const poller = createPoller();
		const target = countingTarget();
		poller.add({ poll: () => Promise.reject(new Error('EIO')) });
		poller.add(target);
		await settle();

		await poller.tick();

		assert.strictEqual(target.polls, 2);
		poller.dispose();
	});

	it("starts a host's gate timer with the first target and clears it when the last one is removed", () => {
		const set = mock.method(globalThis, 'setInterval');
		const clear = mock.method(globalThis, 'clearInterval');
		const poller = createPoller();
		const a = countingTarget();
		const b = countingTarget();

		poller.add(a);
		poller.add(b);
		assert.strictEqual(set.mock.callCount(), 1);
		assert.strictEqual(poller.size, 2);

		poller.delete(a);
		assert.strictEqual(clear.mock.callCount(), 0);

		poller.delete(b);
		assert.strictEqual(clear.mock.callCount(), 1);
		assert.strictEqual(poller.size, 0);

		poller.add(a);
		assert.strictEqual(set.mock.callCount(), 2);

		poller.dispose();
		assert.strictEqual(clear.mock.callCount(), 2);
	});

	it('polls nothing once disposed', async () => {
		const poller = createPoller();
		const target = countingTarget();
		poller.add(target);
		await settle();
		poller.dispose();

		await poller.tick();
		poller.add(target);
		await poller.tick();

		assert.strictEqual(target.polls, 1, 'only the read of the first add');
	});

	describe('its timer', () => {
		function createDefaultGatePoller(): GitDirPoller {
			mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
			return new GitDirPoller({ stat: () => Promise.resolve(undefined), intervalMs: 60_000 });
		}

		it('wakes only to run a pass, once every intervalMs, under the default gate', async () => {
			const poller = createDefaultGatePoller();
			const target = countingTarget();
			poller.add(target);
			await settle();
			const tick = mock.method(poller, 'tick');

			mock.timers.tick(59_999);
			assert.strictEqual(tick.mock.callCount(), 0, 'nothing looks between passes');

			mock.timers.tick(1);
			await settle();
			assert.strictEqual(tick.mock.callCount(), 1);
			assert.strictEqual(target.polls, 2);

			mock.timers.tick(60_000);
			await settle();
			assert.strictEqual(tick.mock.callCount(), 2);
			assert.strictEqual(target.polls, 3);
			poller.dispose();
		});

		it('counts the interval from a nudged pass', async () => {
			const poller = createDefaultGatePoller();
			const target = countingTarget();
			poller.add(target);
			await settle();

			mock.timers.tick(30_000);
			poller.nudge();
			await settle();
			assert.strictEqual(target.polls, 2);

			mock.timers.tick(59_999);
			await settle();
			assert.strictEqual(target.polls, 2);

			mock.timers.tick(1);
			await settle();
			assert.strictEqual(target.polls, 3);
			poller.dispose();
		});

		it('stops its timer while suspended, and runs a pass at once on resume', async () => {
			const poller = createDefaultGatePoller();
			const target = countingTarget();
			poller.add(target);
			await settle();
			const tick = mock.method(poller, 'tick');

			poller.suspend();
			mock.timers.tick(600_000);
			await settle();
			assert.strictEqual(tick.mock.callCount(), 0, 'no wakeup while suspended');
			assert.strictEqual(target.polls, 1);

			poller.nudge();
			await settle();
			assert.strictEqual(target.polls, 1, 'no pass while suspended');

			poller.resume();
			await settle();
			assert.strictEqual(target.polls, 2);

			mock.timers.tick(60_000);
			await settle();
			assert.strictEqual(target.polls, 3, 'the timer runs again from the resumed pass');
			poller.dispose();
		});

		it("still looks at a host's isActive every activeCheckMs, whether suspended or not", async () => {
			mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
			let looks = 0;
			const poller = new GitDirPoller({
				stat: () => Promise.resolve(undefined),
				intervalMs: 60_000,
				activeCheckMs: 5_000,
				isActive: () => {
					looks++;
					return false;
				},
			});
			poller.add(countingTarget());
			await settle();

			poller.suspend();
			mock.timers.tick(15_000);
			assert.strictEqual(looks, 3);
			poller.dispose();
		});
	});
});
