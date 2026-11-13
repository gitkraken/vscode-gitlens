import * as assert from 'assert';
import type { ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { execPath } from 'process';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { spawnProcess } from '@gitlens/utils/env/node/exec.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { ProcessSpawner } from '../../exec/exec.js';
import { defaultGitTimeout, Git } from '../../exec/git.js';
import { StatusGitSubProvider } from '../status.js';

const hangs = 'setTimeout(() => {}, 60000)';
const printsForever =
	"process.stdout.on('error', () => process.exit(0)); setInterval(() => process.stdout.write('x\\n'), 5)";
const printsNothing = '';

const limit = 30_000;

/** The timers set for `limit` while `body` runs, and whether each was cleared before `body` returned */
async function trackLimitTimers(body: () => Promise<void>): Promise<{ set: number; cleared: number }> {
	const realSet = global.setTimeout;
	const realClear = global.clearTimeout;
	const pending = new Set<unknown>();
	let set = 0;
	let cleared = 0;

	global.setTimeout = ((handler: () => void, delay?: number) => {
		const timer = realSet(handler, delay);
		if (delay === limit) {
			set++;
			pending.add(timer);
		}
		return timer;
	}) as unknown as typeof setTimeout;
	global.clearTimeout = timer => {
		if (pending.delete(timer)) {
			cleared++;
		}
		realClear(timer);
	};

	try {
		await body();
		// Closing git's process is what clears its timer, and it follows the answer
		await new Promise(resolve => realSet(resolve, 50));
	} finally {
		global.setTimeout = realSet;
		global.clearTimeout = realClear;
		for (const timer of pending) {
			realClear(timer as Parameters<typeof clearTimeout>[0]);
		}
	}
	return { set: set, cleared: cleared };
}

suite('StatusGitSubProvider streamed presence checks — time limit', () => {
	let cache: Cache;
	let children: ChildProcess[];
	let timeouts: (number | undefined)[];

	setup(() => {
		cache = new Cache();
		children = [];
		timeouts = [];
	});

	teardown(async () => {
		for (const child of children) {
			child.kill();
		}
		cache.dispose();
		// Let the closed processes' timers and listeners settle before the next test counts them
		await new Promise(resolve => setTimeout(resolve, 20));
	});

	function createProvider(script: string, gitTimeout?: number): StatusGitSubProvider {
		const spawner: ProcessSpawner = (_command, _args, options) => {
			timeouts.push(options.timeout);
			const child = spawnProcess(execPath, ['-e', script], options);
			children.push(child);
			return child;
		};
		const git = new Git(async () => ({ path: 'git', version: '2.40.0' }), {
			spawn: spawner,
			...(gitTimeout != null ? { gitTimeout: gitTimeout } : undefined),
		});
		return new StatusGitSubProvider(
			{ config: undefined } as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	}

	const isTimeout = (ex: unknown): boolean => isCancellationError(ex) && ex.reason === 'timeout';

	test('hasConflictingFiles rejects as a timed-out run does when git hangs', async () => {
		const provider = createProvider(hangs, 200);

		await assert.rejects(provider.hasConflictingFiles(tmpdir()), isTimeout);
		assert.deepStrictEqual(timeouts, [200]);
	});

	test('the untracked check rejects as a timed-out run does when git hangs', async () => {
		const provider = createProvider(hangs, 200);

		await assert.rejects(
			provider.hasWorkingChanges(tmpdir(), { staged: false, unstaged: false, untracked: true }),
			isTimeout,
		);
		assert.deepStrictEqual(timeouts, [200]);
	});

	test('the limit is the one a run is given unless the host sets another or disables it', async () => {
		assert.strictEqual(await createProvider(printsNothing).hasConflictingFiles(tmpdir()), false);
		assert.strictEqual(await createProvider(printsNothing, 0).hasConflictingFiles(tmpdir()), false);
		assert.strictEqual(await createProvider(printsNothing, 5000).hasConflictingFiles(tmpdir()), false);

		assert.deepStrictEqual(timeouts, [defaultGitTimeout, undefined, 5000]);
	});

	test('a check answered by the first chunk ends git and clears the limit', async () => {
		const provider = createProvider(printsForever, limit);

		const timers = await trackLimitTimers(async () => {
			assert.strictEqual(await provider.hasConflictingFiles(tmpdir()), true);
		});

		const [child] = children;
		assert.ok(child.exitCode != null || child.signalCode != null, 'git is stopped once the answer is known');
		assert.deepStrictEqual(timers, { set: 1, cleared: 1 }, 'the limit does not outlive the check');
	});

	test('a check that finds nothing clears the limit', async () => {
		const provider = createProvider(printsNothing, limit);

		const timers = await trackLimitTimers(async () => {
			assert.strictEqual(await provider.hasConflictingFiles(tmpdir()), false);
		});

		assert.deepStrictEqual(timers, { set: 1, cleared: 1 });
	});
});
