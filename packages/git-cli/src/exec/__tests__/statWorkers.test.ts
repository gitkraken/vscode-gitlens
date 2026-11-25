import * as assert from 'assert';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { StatWorkerPoolOptions } from '../statWorkers.js';
import { statLocal, StatWorkerPool } from '../statWorkers.js';

/** A worker that answers each batch with its own thread id, after `delayMs` */
function threadIdSource(delayMs: number): string {
	return `
const { parentPort, threadId } = require('node:worker_threads');
parentPort.on('message', () => setTimeout(() => parentPort.postMessage([threadId]), ${delayMs}));
`;
}

/** A worker that never answers, as one stuck on a hung mount */
const hangingSource = `require('node:worker_threads').parentPort.on('message', () => {});`;

/** A worker that exits as it gets a batch */
const exitingSource = `require('node:worker_threads').parentPort.on('message', () => process.exit(3));`;

/** A worker that fails as it starts */
const failingSource = `throw new Error('cannot start');`;

/** A pool whose workers run `source` in place of the one that stats, and that tells when each started */
class TestStatWorkerPool extends StatWorkerPool {
	/** Each worker started, in order, with when its `online` and `exit` events fired */
	readonly started: { readonly worker: Worker; readonly online: Promise<void>; readonly exited: Promise<void> }[] =
		[];
	/** The batches each worker was handed, by its index in {@link started} */
	readonly handed: number[] = [];

	constructor(
		options: StatWorkerPoolOptions,
		private readonly source?: string | (() => Worker),
	) {
		super(options);
	}

	/** Resolves once the `index`th worker started is running */
	whenOnline(index = this.started.length - 1): Promise<void> {
		return this.started[index].online;
	}

	protected override createWorker(): Worker {
		const worker =
			typeof this.source === 'function'
				? this.source()
				: this.source != null
					? new Worker(this.source, { eval: true, execArgv: [] })
					: super.createWorker();
		const index = this.started.length;
		this.handed.push(0);
		const postMessage = worker.postMessage.bind(worker);
		worker.postMessage = (value: unknown) => {
			this.handed[index]++;
			postMessage(value);
		};
		// Listened for before the pool does, so a test awaiting it resumes once the pool counts the worker as running
		this.started.push({
			worker: worker,
			online: new Promise(resolve => worker.once('online', () => resolve())),
			exited: new Promise(resolve => worker.once('exit', () => resolve())),
		});
		return worker;
	}
}

suite('StatWorkerPool Test Suite', () => {
	let root: string;
	let pool: StatWorkerPool | undefined;

	setup(() => {
		root = mkdtempSync(join(tmpdir(), 'gitlens-stat-workers-'));
	});

	teardown(() => {
		pool?.dispose();
		pool = undefined;
		rmSync(root, { recursive: true, force: true });
	});

	test('reads each path in order, as a found, missing or under-a-file path', async () => {
		writeFileSync(join(root, 'file'), 'hello');
		mkdirSync(join(root, 'dir'));
		const p = new TestStatWorkerPool({ maxWorkers: 1 });
		pool = p;
		const paths = [join(root, 'dir'), join(root, 'missing'), join(root, 'file', 'below'), join(root, 'file')];

		const dir = statSync(join(root, 'dir'));
		const file = statSync(join(root, 'file'));
		const expected = [
			{ mtime: dir.mtimeMs, size: dir.size },
			'missing',
			'missing',
			{ mtime: file.mtimeMs, size: 5 },
		];
		assert.deepStrictEqual(await p.statMany(paths), expected, 'on the calling thread');
		await p.whenOnline();
		assert.deepStrictEqual(await p.statMany(paths), expected, 'on a worker');
		assert.deepStrictEqual(p.handed, [1]);
	});

	test('reads a path alike on a worker and on the calling thread', async function () {
		// Creating a symlink needs a privilege on Windows
		if (process.platform === 'win32') {
			this.skip();
		}

		writeFileSync(join(root, 'file'), 'hello');
		mkdirSync(join(root, 'dir'));
		symlinkSync(join(root, 'file'), join(root, 'link'));
		symlinkSync(join(root, 'gone'), join(root, 'dangling'));
		const paths = [
			join(root, 'file'),
			join(root, 'dir'),
			join(root, 'missing'),
			join(root, 'file', 'below'),
			join(root, 'link'),
			join(root, 'dangling'),
		];
		const expected: unknown[] = [];
		for (const path of paths) {
			expected.push((await statLocal(path)) ?? 'missing');
		}

		// Root reads through any permission
		const locked = join(root, 'locked');
		if (process.getuid?.() !== 0) {
			mkdirSync(locked);
			writeFileSync(join(locked, 'file'), '');
			chmodSync(locked, 0o000);
			paths.push(join(locked, 'file'));
			expected.push('unreadable');
		}

		try {
			const p = new TestStatWorkerPool({ maxWorkers: 1 });
			pool = p;
			const onCallingThread = await p.statMany(paths);
			assert.deepStrictEqual(p.handed, [0], 'served on the calling thread');
			await p.whenOnline();
			const onWorker = await p.statMany(paths);
			assert.deepStrictEqual(p.handed, [1], 'served on the worker');

			assert.deepStrictEqual(onCallingThread, expected);
			assert.deepStrictEqual(onWorker, onCallingThread);
			assert.deepStrictEqual(onWorker[4], onWorker[0], 'a link reads as its target');
		} finally {
			if (process.getuid?.() !== 0) {
				chmodSync(locked, 0o700);
			}
		}
	});

	test('reads a file as an asynchronous stat does', async () => {
		writeFileSync(join(root, 'file'), 'hello');

		const s = await stat(join(root, 'file'));
		assert.deepStrictEqual(await statLocal(join(root, 'file')), { mtime: s.mtimeMs, size: s.size });
		assert.strictEqual(await statLocal(join(root, 'file', 'below')), undefined, 'under a file');
		assert.strictEqual(await statLocal(join(root, 'missing')), undefined);
	});

	test('serves the batches while its first worker starts on the calling thread, then on the worker', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 2 }, threadIdSource(0));
		pool = p;

		const cold = await Promise.all([p.statMany([join(root, 'missing')]), p.statMany([join(root, 'missing')])]);
		assert.deepStrictEqual(cold, [['missing'], ['missing']], 'served on the calling thread');
		assert.strictEqual(p.started.length, 1, 'one worker started, and none more while it starts');

		await p.whenOnline();
		const [first] = await p.statMany(['a']);
		const [second] = await p.statMany(['b']);
		assert.strictEqual(typeof first, 'number', 'served on the worker');
		assert.strictEqual(second, first, 'and again on the same idle worker');
		assert.strictEqual(p.started.length, 1);
	});

	test('runs concurrent batches on separate workers, up to maxWorkers, serving one past it on the calling thread', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 2 }, threadIdSource(50));
		pool = p;
		await p.statMany([]);
		await p.whenOnline(0);
		// The first worker busy, the next batch starts the second
		await Promise.all([p.statMany(['a']), p.statMany([])]);
		await p.whenOnline(1);

		const results = await Promise.all([p.statMany(['a']), p.statMany(['b']), p.statMany([join(root, 'missing')])]);
		assert.strictEqual(typeof results[0][0], 'number');
		assert.strictEqual(typeof results[1][0], 'number');
		assert.notStrictEqual(results[0][0], results[1][0], 'each on a worker of its own');
		assert.deepStrictEqual(results[2], ['missing'], 'served on the calling thread');
		assert.strictEqual(p.started.length, 2);
	});

	test('starts at most 4 workers, whatever maxWorkers asks for', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 16 }, hangingSource);
		pool = p;
		for (let i = 0; i < 6; i++) {
			await p.statMany([]);
			await p.whenOnline();
			void p.statMany(['hang']).catch(() => {});
		}
		assert.strictEqual(p.started.length, 4);
	});

	test('reads a maxWorkers that is no number as the validator reads maxFsThreads', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: Number.NaN }, hangingSource);
		pool = p;
		for (let i = 0; i < 4; i++) {
			await p.statMany([]);
			await p.whenOnline();
			void p.statMany(['hang']).catch(() => {});
		}
		assert.strictEqual(p.started.length, 2);
	});

	test('never hands another batch to a worker whose batch never returned, serving it on the calling thread', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 1 }, hangingSource);
		pool = p;
		await p.statMany([]);
		await p.whenOnline();

		const hung = p.statMany(['a']);
		assert.deepStrictEqual(await p.statMany([join(root, 'missing')]), ['missing']);
		assert.deepStrictEqual(p.handed, [1]);

		p.dispose();
		await assert.rejects(hung, /disposed/);
	});

	test('rejects the batch of a worker that exits, and starts another for the batches after', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 1 }, exitingSource);
		pool = p;
		await p.statMany([]);
		await p.whenOnline();

		await assert.rejects(p.statMany(['a']), /exited with code 3/);
		// Its place in the pool was freed, so the next batch starts a worker
		assert.deepStrictEqual(await p.statMany([join(root, 'missing')]), ['missing']);
		assert.strictEqual(p.started.length, 2);
	});

	test('rejects the next batch once a worker failed without a batch', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 1 }, failingSource);
		pool = p;
		await p.statMany([]);
		await p.started[0].exited;

		await assert.rejects(p.statMany([]), /cannot start/);
		assert.deepStrictEqual(await p.statMany([]), [], 'and starts another for the batch after');
		assert.strictEqual(p.started.length, 2);
	});

	test('rejects a batch, never throwing, when a worker cannot be created', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 1 }, () => {
			throw new Error('no workers here');
		});
		pool = p;

		let batch: Promise<unknown> | undefined;
		assert.doesNotThrow(() => {
			batch = p.statMany(['a']);
		});
		await assert.rejects(batch!, /no workers here/);
	});

	test('stops an idle worker beyond the first once idle long enough', async () => {
		const p = new TestStatWorkerPool({ maxWorkers: 2, idleTimeoutMs: 20 }, threadIdSource(30));
		pool = p;
		await p.statMany([]);
		await p.whenOnline(0);
		await Promise.all([p.statMany(['a']), p.statMany([])]);
		await p.whenOnline(1);
		await new Promise(resolve => setTimeout(resolve, 100));

		// One was stopped and one kept, so of two at once, one is served by the kept worker and one starts another
		const [[third], [fourth]] = await Promise.all([p.statMany(['c']), p.statMany([join(root, 'missing')])]);
		assert.strictEqual(typeof third, 'number', 'the kept worker');
		assert.strictEqual(fourth, 'missing', 'served on the calling thread');
		assert.strictEqual(p.started.length, 3);
	});

	test('rejects every batch once disposed', async () => {
		pool = new StatWorkerPool({ maxWorkers: 1 });
		await pool.statMany([root]);

		pool.dispose();
		await assert.rejects(pool.statMany([root]), /disposed/);
	});
});
